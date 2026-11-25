import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

test('administrator MySQL sessions, moderation, versioned settings and round selection', {
  skip: process.env.RUN_DATABASE_TESTS !== '1', timeout: 30000,
}, async (t) => {
  assert.match(process.env.DATABASE_NAME ?? '', /^codex_platform_test/);
  const { pool, closePool } = await import('../src/db/pool.js');
  const { runMigrations } = await import('../src/db/migrate.js');
  const { AdminRepository } = await import('../src/modules/admin/repository.js');
  const { digest } = await import('../src/modules/admin/security.js');
  const { signIn } = await import('../src/modules/users/users.repository.js');
  t.after(closePool);
  await runMigrations();
  await runMigrations();
  const repository = new AdminRepository(pool);
  const key = randomUUID().slice(0, 8);
  const actor = 'test-admin-' + key;
  const attemptKey = digest('test-ip-' + key);
  const auth = {
    issuer: 'https://cognito.example.test/pool', sub: 'admin-player-' + key,
    identityHash: digest('identity-' + key), sessionHash: digest('player-session-' + key),
    expiresAt: new Date(Date.now() + 3600000), email: null,
  };
  const player = await signIn(auth, 'AdminTest-' + key);

  await t.test('rate limits and sessions survive repository recreation', async () => {
    const attempts = await Promise.all(Array.from({ length: 12 }, () => repository.consumeLoginAttempt(attemptKey)));
    assert.equal(attempts.filter(Boolean).length, 10);
    const token = randomBytes(32).toString('hex');
    const credentialsHash = digest('credentials-' + key);
    const csrfToken = randomBytes(32).toString('hex');
    await repository.createSession({
      tokenHash: digest(token), username: actor, credentialsHash, csrfToken,
      expiresAt: new Date(Date.now() + 3600000),
    }, attemptKey);
    const restarted = new AdminRepository(pool);
    const session = await restarted.session(digest(token), credentialsHash);
    assert.equal(session.username, actor);
    assert.equal(session.csrfToken, csrfToken);
    assert.equal(await restarted.session(digest(token), digest('rotated')), null);
    await repository.deleteSession(digest(token), actor);
    assert.equal(await restarted.session(digest(token), credentialsHash), null);
  });

  await t.test('suspending and revoking sessions preserve the account and create audit records', async () => {
    await pool.query(
      'INSERT INTO signaling_tickets (ticket_hash, user_id, session_hash, expires_at) VALUES (?, ?, ?, ?)',
      [digest('ticket-' + key), player.id, auth.sessionHash, auth.expiresAt]
    );
    await repository.setPlayerStatus(player.id, 'suspended', 'Test moderation', actor);
    const [[user]] = await pool.query('SELECT status FROM users WHERE id = ?', [player.id]);
    const [[sessions]] = await pool.query('SELECT COUNT(*) AS total FROM user_active_sessions WHERE user_id = ?', [player.id]);
    const [[tickets]] = await pool.query('SELECT COUNT(*) AS total FROM signaling_tickets WHERE user_id = ?', [player.id]);
    assert.equal(user.status, 'suspended');
    assert.equal(sessions.total, 0);
    assert.equal(tickets.total, 0);
    await assert.rejects(signIn(auth, 'AdminTest-' + key), { status: 403 });
    await repository.setPlayerStatus(player.id, 'active', 'Test reactivation', actor);
    await signIn(auth, 'AdminTest-' + key);
    await repository.revokePlayerSessions(player.id, 'Test revoke', actor);
    const result = await repository.players({ search: key, page: 1, limit: 25 });
    assert.ok(result.rows.some((row) => row.id === player.id && row.status === 'active' && !row.has_session));
    assert.equal((await repository.player(player.id)).player.id, player.id);
    const audit = await repository.auditLog({ page: 1, limit: 100 });
    assert.ok(audit.rows.some((row) => row.action === 'admin.player_status' &&
      row.target_user_id === player.id && row.payload_json.reason === 'Test moderation'));
  });

  await t.test('optimistic versions prevent concurrent overwrites and retain previous settings', async () => {
    const before = await repository.settings();
    const version = before.progression.version;
    await repository.publishSettings('progression', version, { win_xp: 250 }, actor);
    await assert.rejects(
      repository.publishSettings('progression', version, { win_xp: 999 }, actor), { status: 409 }
    );
    const after = await repository.settings();
    assert.equal(after.progression.values.win_xp, 250);
    assert.equal(after.progression.version, version + 1);
    const concurrent = await Promise.allSettled([
      repository.publishSettings('progression', version + 1, { win_xp: 260 }, actor),
      repository.publishSettings('progression', version + 1, { win_xp: 270 }, actor),
    ]);
    assert.equal(concurrent.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find((entry) => entry.status === 'rejected').reason.status, 409);
    const [[old]] = await pool.query(
      "SELECT value_json FROM app_config_versions WHERE config_key = 'progression' AND version = ?", [version]
    );
    assert.ok(old);
  });

  await t.test('each round remains addressable when several rounds share the same room code', async () => {
    const code = key.toUpperCase();
    const [lobby] = await pool.query('INSERT INTO lobbies (lobby_key, code) VALUES (?, ?)', [randomUUID(), code]);
    const ids = [];
    for (const round of [1, 2]) {
      const [game] = await pool.query(
        "INSERT INTO games (round_key, lobby_id, round_number, config_json, started_at) VALUES (?, ?, ?, '{}', UTC_TIMESTAMP(3))",
        [randomUUID(), lobby.insertId, round]
      );
      ids.push(game.insertId);
    }
    assert.equal((await repository.game(ids[0])).game.round_number, 1);
    assert.equal((await repository.game(ids[1])).game.round_number, 2);
    const result = await repository.games({ search: code, page: 1, limit: 25 });
    assert.equal(result.total, 2);
    assert.deepEqual(result.rows.map((row) => row.id), ids.reverse());
    assert.ok((await repository.overview()).counts.users >= 1);
    assert.ok(Array.isArray((await repository.subscriptions({ page: 1, limit: 25 })).rows));
  });

  await t.test('a decommissioned account cannot be reactivated by the administrator', async () => {
    await pool.query("UPDATE users SET status = 'deleted' WHERE id = ?", [player.id]);
    await assert.rejects(repository.setPlayerStatus(player.id, 'active', 'Attempt', actor), { status: 409 });
  });
});
