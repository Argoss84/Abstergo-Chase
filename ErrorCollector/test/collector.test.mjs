import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../src/app.js';
import { createAuthenticator } from '../src/auth.js';
import { ErrorRepository } from '../src/repository.js';

const adminToken = 'test-administrator-token-with-at-least-32-characters';
const issuer = 'https://cognito-idp.eu-west-3.amazonaws.com/test_pool';
const clientId = 'test-client';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const authenticate = createAuthenticator({ issuer, clientId, jwks: createLocalJWKSet({ keys: [jwk] }) });
async function token(overrides = {}) {
  return new SignJWT({ token_use: 'access', client_id: clientId, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(issuer).setSubject('test-user').setExpirationTime('5m').sign(privateKey);
}
const validToken = await token();
function event(overrides = {}) {
  return { id: randomBytes(16).toString('hex'), sessionId: 'a'.repeat(32),
    occurredAt: new Date().toISOString(), environment: 'test', platform: 'android',
    buildMode: 'release', appVersion: '1.0.7+8', source: 'test.gps', message: 'GPS failed',
    error: 'Location unavailable', stackTrace: '#0 GPS', ...overrides };
}
const servers = [];
async function serve(options = {}) {
  const stored = new Map();
  const repository = {
    async insertBatch(events) {
      for (const entry of events) if (!stored.has(entry.id)) stored.set(entry.id, entry);
      return events.map((entry) => entry.id);
    },
    async list({ sessionId, limit, offset }) {
      return [...stored.values()].filter((entry) => !sessionId || entry.sessionId === sessionId).slice(offset, offset + limit);
    },
    async sessions() { return [...new Set([...stored.values()].map((entry) => entry.sessionId))]; },
  };
  const app = createApp({ repository, authenticate, adminToken, reportError: () => {}, ...options });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { stored, base, post: (body, bearer = validToken) => fetch(`${base}/api/errors`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) };
}
after(async () => Promise.all(servers.map((server) => new Promise((resolve) => {
  server.close(resolve); server.closeAllConnections();
}))));

test('reports are acknowledged and an identical retry does not duplicate them', async () => {
  const app = await serve();
  const entry = event();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.post({ events: [entry] });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { acceptedIds: [entry.id] });
  }
  assert.equal(app.stored.size, 1);
});

test('Cognito signature, expiry, app client and access-token use are checked', async () => {
  const app = await serve();
  const expired = await new SignJWT({ token_use: 'access', client_id: clientId })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(issuer)
    .setSubject('test-user').setExpirationTime(1).sign(privateKey);
  for (const bearer of ['', `${validToken.slice(0, -20)}tampered`, expired,
    await token({ client_id: 'another-app' }), await token({ token_use: 'id' })]) {
    assert.equal((await app.post({ events: [event()] }, bearer)).status, 401);
  }
  assert.equal(app.stored.size, 0);
});

test('a whole malformed batch is rejected, including oversized text and duplicate IDs', async () => {
  const app = await serve();
  const entry = event();
  const invalidBodies = [
    { events: [] }, { events: Array.from({ length: 51 }, () => event()) },
    { events: [entry, entry] }, { events: [event({ message: 'x'.repeat(4097) })] },
    { events: [event({ sessionId: '../../invalid' })] },
    { events: [event({ occurredAt: 'tomorrow' })] }, '{broken json',
    { events: [event(), event({ platform: null })] },
  ];
  for (const body of invalidBodies) assert.equal((await app.post(body)).status, 400);
  assert.equal(app.stored.size, 0);
});

test('only a separate administrator token can read or export error reports', async () => {
  const app = await serve();
  await app.post({ events: [event()] });
  for (const route of ['/api/errors', '/api/error-sessions']) {
    assert.equal((await fetch(app.base + route, { headers: { Authorization: `Bearer ${validToken}` } })).status, 401);
  }
  const response = await fetch(`${app.base}/api/errors?download=1`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /abstergo-errors.json/);
  assert.equal((await response.json()).events.length, 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('production rejects HTTP ingestion', async () => {
  const app = await serve({ production: true });
  assert.equal((await app.post({ events: [event()] })).status, 400);
});

test('Passenger subpath deployment keeps health, ingestion and admin authentication', async () => {
  const app = await serve({ basePath: '/abstergo-errors', production: true, trustProxy: 1 });
  assert.equal((await fetch(`${app.base}/abstergo-errors/health`)).status, 200);
  const entry = event();
  const response = await fetch(`${app.base}/abstergo-errors/api/errors`, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`, 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ events: [entry] }),
  });
  assert.equal(response.status, 202);
  assert.equal(app.stored.size, 1);
  assert.equal((await fetch(`${app.base}/abstergo-errors/api/errors`, {
    headers: { Authorization: `Bearer ${validToken}`, 'X-Forwarded-Proto': 'https' },
  })).status, 401);
});

test('database failure does not acknowledge a batch or expose database details', async () => {
  const app = await serve({ repository: { insertBatch() { throw new Error('secret DB password'); } } });
  const response = await app.post({ events: [event()] });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret/);
});

test('rate limiting bounds repeated requests', async () => {
  const app = await serve({ requestsPerMinute: 1 });
  assert.equal((await app.post({ events: [event()] })).status, 202);
  const response = await app.post({ events: [event()] });
  assert.equal(response.status, 429);
  assert.ok(response.headers.get('retry-after'));
});

test('repository rolls back a partial batch and releases its connection', async () => {
  const actions = [];
  const connection = {
    async beginTransaction() { actions.push('begin'); },
    async execute() { actions.push('insert'); if (actions.length === 3) throw new Error('storage failure'); },
    async commit() { actions.push('commit'); },
    async rollback() { actions.push('rollback'); },
    release() { actions.push('release'); },
  };
  const repository = new ErrorRepository({ async getConnection() { return connection; } });
  await assert.rejects(repository.insertBatch([event(), event()], 'b'.repeat(64)), /storage failure/);
  assert.deepEqual(actions, ['begin', 'insert', 'insert', 'rollback', 'release']);
});
