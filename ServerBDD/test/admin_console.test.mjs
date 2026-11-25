import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { createAdminRouter } from '../src/modules/admin/routes.js';
import { adminConfig, digest, hashPassword, verifyPassword } from '../src/modules/admin/security.js';

const password = 'admin-test-password-only';
const passwordHash = await hashPassword(password);
const baseConfig = adminConfig({
  ADMIN_USERNAME: 'operator', ADMIN_PASSWORD_HASH: passwordHash, ADMIN_ORIGIN: 'http://admin.example.test',
});

async function fixture(t, { config = baseConfig, services: overrides = {}, sessions = new Map() } = {}) {
  const writes = [];
  let attempts = 0;
  const repository = {
    async consumeLoginAttempt() { return ++attempts <= 10; },
    async createSession(session) { sessions.set(session.tokenHash, session); },
    async session(key, credentialsHash) {
      const row = sessions.get(key);
      return row && row.credentialsHash === credentialsHash && row.expiresAt > new Date() ? row : null;
    },
    async deleteSession(key) { sessions.delete(key); },
    async overview() { return { counts: { users: 2 }, activity: [] }; },
    async players(query) { return { rows: [], total: 0, ...query }; },
    async setPlayerStatus(...args) { writes.push(args); return { success: true }; },
    async publishSettings(...args) { writes.push(args); return { version: 2, values: args[2] }; },
    async recordAction(...args) { writes.push(args); },
  };
  const services = {
    async signaling() { return { connectedClients: 0, games: [], lobbies: [] }; },
    async diagnostics() { return { total: 0 }; },
    ...overrides,
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use('/admin', createAdminRouter({ config, repository, services }));
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = 'http://127.0.0.1:' + server.address().port + '/admin';
  const request = (path, options = {}) => fetch(url + path, {
    ...options, headers: { Origin: config.origin, 'Content-Type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const login = async () => {
    const response = await request('/api/login', {
      method: 'POST', body: { username: 'operator', password },
      headers: config.production ? { 'X-Forwarded-Proto': 'https' } : {},
    });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], ...await response.json(), response };
  };
  return { request, login, sessions, writes };
}

test('administrator passwords use salted scrypt and configuration requires a complete dedicated account', async () => {
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword('wrong-password', passwordHash), false);
  assert.equal(await verifyPassword(password, 'broken'), false);
  assert.notEqual(await hashPassword(password), passwordHash);
  await assert.rejects(hashPassword('too-short'));
  assert.equal(adminConfig({}).enabled, false);
  assert.throws(() => adminConfig({ ADMIN_USERNAME: 'operator' }));
  assert.throws(() => adminConfig({ NODE_ENV: 'production', ADMIN_USERNAME: 'operator',
    ADMIN_PASSWORD_HASH: passwordHash, ADMIN_ORIGIN: 'http://admin.example.test' }));
});

test('console serves its CSP-protected login while APIs require a durable administrator session', async (t) => {
  const first = await fixture(t);
  const page = await first.request('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await first.request('/api/players')).status, 401);
  const account = await first.login();
  const cookieHeader = account.response.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Strict/i);
  assert.match(cookieHeader, /Path=\/admin/i);
  assert.ok(!JSON.stringify([...first.sessions.values()]).includes(account.cookie.split('=')[1]));
  const restarted = await fixture(t, { sessions: first.sessions });
  const restored = await restarted.request('/api/session', { headers: { Cookie: account.cookie } });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).csrfToken, account.csrfToken);
  const tampered = await first.request('/api/session', {
    headers: { Cookie: 'bvp_admin_session=' + randomBytes(32).toString('hex') },
  });
  assert.equal(tampered.status, 401);
});

test('unsafe requests require both the configured origin and session CSRF token', async (t) => {
  const { request, login, writes } = await fixture(t);
  const account = await login();
  const body = { status: 'suspended', reason: 'Test de modération' };
  const path = '/api/players/12/status';
  assert.equal((await request(path, { method: 'PUT', body, headers: { Cookie: account.cookie } })).status, 403);
  const headers = { Cookie: account.cookie, 'X-CSRF-Token': account.csrfToken };
  assert.equal((await request(path, { method: 'PUT', body,
    headers: { ...headers, Origin: 'https://foreign.example.test' } })).status, 403);
  assert.equal(writes.length, 0);
  assert.equal((await request(path, { method: 'PUT', body, headers })).status, 200);
  assert.deepEqual(writes, [[12, 'suspended', 'Test de modération', 'operator']]);
  assert.equal((await request('/api/players/12/status', {
    method: 'PUT', body: { status: 'deleted', reason: 'Unsupported' }, headers,
  })).status, 400);
  assert.equal((await request('/api/players/-1', { headers })).status, 400);
});

test('logout, password rotation and expiration invalidate stored administrator sessions', async (t) => {
  const { request, login, sessions } = await fixture(t);
  const account = await login();
  const headers = { Cookie: account.cookie, 'X-CSRF-Token': account.csrfToken };
  assert.equal((await request('/api/logout', { method: 'POST', body: {}, headers })).status, 204);
  assert.equal((await request('/api/session', { headers })).status, 401);
  const second = await login();
  const changed = await fixture(t, {
    sessions, config: { ...baseConfig, credentialsHash: digest('changed-password') },
  });
  assert.equal((await changed.request('/api/session', { headers: { Cookie: second.cookie } })).status, 401);
  const row = sessions.values().next().value;
  row.expiresAt = new Date(Date.now() - 1);
  assert.equal((await request('/api/session', { headers: { Cookie: second.cookie } })).status, 401);
});

test('login throttling persists through the repository and rejects excessive attempts', async (t) => {
  const { request } = await fixture(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await request('/api/login', {
      method: 'POST', body: { username: 'operator', password: 'wrong-password' },
    });
    assert.equal(response.status, 401);
  }
  const blocked = await request('/api/login', { method: 'POST', body: { username: 'operator', password } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
});

test('production requires HTTPS and issues secure cookies behind the configured proxy', async (t) => {
  const config = { ...baseConfig, production: true, origin: 'https://admin.example.test' };
  const { request, login } = await fixture(t, { config });
  assert.equal((await request('/api/session')).status, 400);
  const account = await login();
  assert.match(account.response.headers.get('set-cookie'), /;\s*Secure/i);
});

test('progression and hosting settings have separate validated schemas', async (t) => {
  const { request, login, writes } = await fixture(t);
  const account = await login();
  const headers = { Cookie: account.cookie, 'X-CSRF-Token': account.csrfToken };
  assert.equal((await request('/api/settings/progression', {
    method: 'PUT', headers, body: { expected_version: 1, values: { win_xp: 200 } },
  })).status, 200);
  assert.equal((await request('/api/settings/hosting', { method: 'PUT', headers, body: {
    expected_version: 1, values: { free_daily_rounds: 5, premium_daily_rounds: null,
      premium_settings: { map_radius: { free_max: 200 } } },
  } })).status, 200);
  assert.equal(writes.length, 2);
  assert.equal((await request('/api/settings/progression', {
    method: 'PUT', headers, body: { expected_version: 1, values: { win_xp: -1 } },
  })).status, 400);
  assert.equal((await request('/api/settings/hosting', { method: 'PUT', headers, body: {
    expected_version: 1, values: { free_daily_rounds: 5, premium_daily_rounds: null,
      premium_settings: { map_radius: { free_max: 200, free_values: [200] } } },
  } })).status, 400);
});

test('dashboard remains usable when optional signaling and diagnostics services are unavailable', async (t) => {
  const { request, login } = await fixture(t, { services: {
    async signaling() { throw new Error('Private configuration detail'); },
    async diagnostics() { throw new Error('private-token'); },
  } });
  const account = await login();
  const response = await request('/api/overview', { headers: { Cookie: account.cookie } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.counts.users, 2);
  assert.equal(data.signaling.available, false);
  assert.equal(data.voice.available, false);
  assert.ok(!JSON.stringify(data).includes('private'));
});

test('unconfigured console fails closed without affecting the public login page', async (t) => {
  const { request } = await fixture(t, { config: adminConfig({}) });
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/api/session')).status, 503);
});
