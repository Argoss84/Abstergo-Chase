import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import test from 'node:test';

test('MySQL round lifecycle, account continuity and ordered events', {
  skip: process.env.RUN_DATABASE_TESTS !== '1',
  timeout: 30_000,
}, async (t) => {
  assert.match(process.env.DATABASE_NAME ?? '', /^codex_platform_test/);
  const { pool, closePool } = await import('../src/db/pool.js');
  const { runMigrations } = await import('../src/db/migrate.js');
  const { signIn, patchSettings, loadProfile, decommission } = await import('../src/modules/users/users.repository.js');
  const { createSignalingTicket, redeemSignalingTicket, hash } = await import('../src/middleware/auth-cognito.js');
  const { transaction } = await import('../src/db/pool.js');
  const {
    acquireRuntime, saveRuntime, reserveLobby, startRound, completeRound, getGameEvents,
    getHistory, appendGameEvent, gameByCode,
  } = await import('../src/modules/games/games.repository.js');
  const { getProgression } = await import('../src/modules/progression/progression.repository.js');
  t.after(closePool);
  await runMigrations();
  await runMigrations();

  const key = randomUUID().slice(0, 8);
  const identity = (sub) => ({
    issuer: 'https://cognito.example.test/pool', sub,
    identityHash: hash(sub), sessionHash: hash('session:' + sub),
    email: null, expiresAt: new Date(Date.now() + 3_600_000),
  });
  const agentAuth = identity('agent-' + key);
  const rogueAuth = identity('rogue-' + key);
  const agent = await signIn(agentAuth, 'Agent-' + key);
  const rogue = await signIn(rogueAuth, 'Rogue-' + key);
  const scope = 'test-' + key;
  const lobbyKey = randomUUID();
  const code = key.toUpperCase();
  const bonus = 'test-bonus-' + key;
  await pool.query(
    "INSERT INTO bonuses (id, label, minimum_level, allowed_role, use_type, initial_charges) VALUES (?, ?, 2, 'AGENT', 'consumable', 3)",
    [bonus, 'Test bonus']
  );

  await t.test('only the current Cognito device can exchange a single-use ticket', async () => {
    const ticket = await createSignalingTicket({ ...agentAuth, userId: agent.id });
    const result = await redeemSignalingTicket(ticket);
    assert.equal(result.user_id, agent.id);
    await assert.rejects(redeemSignalingTicket(ticket), { status: 401 });

    const stale = await createSignalingTicket({ ...agentAuth, userId: agent.id });
    const secondDevice = { ...agentAuth, sessionHash: hash('new-device:' + key) };
    const sameAccount = await signIn(secondDevice, 'Profil différent');
    assert.equal(sameAccount.id, agent.id);
    assert.equal(sameAccount.username, agent.username);
    await assert.rejects(redeemSignalingTicket(stale), { status: 401 });

    const current = await createSignalingTicket({ ...secondDevice, userId: agent.id });
    assert.equal((await redeemSignalingTicket(current)).user_id, agent.id);
  });

  await t.test('Google Play verification binds a purchase to one game account and revocation removes rights', async () => {
    const { env } = await import('../src/config/env.js');
    const { billingStatus, verifySubscription } = await import('../src/modules/billing/billing.repository.js');
    const originalPlay = { ...env.play };
    const originalFetch = globalThis.fetch;
    const token = 'purchase-token-' + key;
    const product = 'premium-' + key;
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let playState = 'SUBSCRIPTION_STATE_ACTIVE';
    let acknowledged = false;
    let verifications = 0;
    Object.assign(env.play, {
      clientEmail: 'test@example.test', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      productId: product, basePlanId: 'monthly',
    });
    globalThis.fetch = async (url, options) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return Response.json({ access_token: 'disposable-play-token', expires_in: 3600 });
      }
      assert.ok(String(url).startsWith('https://androidpublisher.googleapis.com/'));
      assert.equal(options.headers.Authorization, 'Bearer disposable-play-token');
      if (String(url).endsWith(':acknowledge')) {
        acknowledged = true;
        return Response.json({});
      }
      assert.ok(String(url).endsWith(token));
      verifications++;
      return Response.json({
        subscriptionState: playState,
        externalAccountIdentifiers: { obfuscatedExternalAccountId: agent.public_id },
        acknowledgementState: acknowledged ? 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' : 'ACKNOWLEDGEMENT_STATE_PENDING',
        lineItems: [{ productId: product, offerDetails: { basePlanId: 'monthly' },
          expiryTime: new Date(Date.now() + 86_400_000).toISOString() }],
      });
    };
    try {
      await verifySubscription(token, { userId: agent.id });
      assert.equal(acknowledged, true);
      assert.ok((await billingStatus(agent.id, agent.public_id)).features.includes('ads_free'));
      await assert.rejects(verifySubscription(token, { userId: rogue.id }), { status: 409 });
      playState = 'SUBSCRIPTION_STATE_EXPIRED';
      await verifySubscription(token, null, { id: 'rtdn-' + key, type: 13 });
      await verifySubscription(token, null, { id: 'rtdn-' + key, type: 13 });
      assert.equal(verifications, 3);
      assert.deepEqual((await billingStatus(agent.id, agent.public_id)).features, []);
    } finally {
      globalThis.fetch = originalFetch;
      Object.assign(env.play, originalPlay);
    }
  });

  await t.test('settings on the same account are merged and revision conflicts are explicit', async () => {
    await transaction((db) => patchSettings(db, agent.id, { voiceThreshold: 0.65, vibrations: { one: true } }, 0));
    await transaction((db) => patchSettings(db, agent.id, { vibrations: { two: false } }, 1));
    const result = await loadProfile(agent.id);
    assert.deepEqual(result.preferences_json, { voiceThreshold: 0.65, vibrations: { one: true, two: false } });
    assert.equal(result.settings_revision, 2);
    await assert.rejects(transaction((db) => patchSettings(db, agent.id, { voiceThreshold: 0.2 }, 1)), { status: 409 });
  });

  const roster = [
    { user_id: agent.id, player_external_id: 'agent', display_name: 'Agent du test', role: 'AGENT', status: 'active', is_host: true },
    { user_id: rogue.id, player_external_id: 'rogue', display_name: 'Rogue du test', role: 'ROGUE', status: 'active', is_host: false },
  ];
  await reserveLobby({ code, lobby_key: lobbyKey });
  const runtime = await acquireRuntime(scope);
  const round = {
    code, lobby_key: lobbyKey, round_key: randomUUID(), host_user_id: agent.id, host_player_id: 'agent',
    config: { duration: 400, objectives: [{ latitude: 1, longitude: 2 }] }, players: roster,
  };
  const givenState = { lobbies: [], games: [{ roundKey: round.round_key, remainingTime: 200 }] };
  const started = await startRound({
    ...round,
    checkpoint: { scope, owner_key: runtime.owner_key, revision: 1, state: givenState },
  });
  const game = await gameByCode(code);

  await t.test('runtime survives a new server and stale writers cannot overwrite it', async () => {
    const next = await acquireRuntime(scope);
    assert.deepEqual(next.state, givenState);
    await assert.rejects(saveRuntime(pool, { scope, owner_key: runtime.owner_key, revision: 2, state: {} }), { status: 409 });
    await saveRuntime(pool, { scope, owner_key: next.owner_key, revision: 2, state: givenState });
    await saveRuntime(pool, { scope, owner_key: next.owner_key, revision: 1, state: {} });
    assert.deepEqual((await acquireRuntime(scope)).state, givenState);
  });

  await t.test('parallel event writers allocate consecutive sequence numbers and deduplicate retries', async () => {
    await Promise.all(Array.from({ length: 30 }, (_, index) => appendGameEvent({
      gameId: game.id, eventType: 'test', eventKey: 'e' + index, payloadJson: { index },
    })));
    await appendGameEvent({ gameId: game.id, eventType: 'test', eventKey: 'e2' });
    const events = await getGameEvents(game.id);
    assert.deepEqual(events.map((event) => Number(event.sequence_no)), Array.from({ length: 31 }, (_, i) => i + 1));
    assert.deepEqual(events.slice(1).map((event) => event.payload_json.index).sort((a, b) => a - b),
      Array.from({ length: 30 }, (_, index) => index));
  });

  await t.test('the same join code keeps independent rounds and only an eligible win grants XP', async () => {
    const outcome = {
      winner_side: 'AGENT', end_reason: 'TIMEOUT', duration_seconds: 45, summary: {},
      players: [{ user_id: agent.id, status: 'active' }, { user_id: rogue.id, status: 'left' }],
    };
    await Promise.all([completeRound(round.round_key, outcome), completeRound(round.round_key, outcome)]);
    assert.equal(started.round_number, 1);
    assert.equal((await getProgression(agent.id)).xp, 150);
    assert.equal((await getProgression(agent.id)).level, 2);
    assert.equal((await getProgression(rogue.id)).xp, 0);
    const [[unlocked]] = await pool.query(
      'SELECT remaining_charges FROM player_bonus_unlocks WHERE user_id = ? AND bonus_id = ?', [agent.id, bonus]
    );
    assert.equal(unlocked.remaining_charges, 3);

    const nextRound = randomUUID();
    assert.equal((await startRound({ ...round, round_key: nextRound })).round_number, 2);
    await completeRound(nextRound, {
      ...outcome,
      winner_side: 'ROGUE',
      players: [{ user_id: agent.id, status: 'active' }, { user_id: rogue.id, status: 'left' }],
    });
    assert.equal((await getProgression(rogue.id)).xp, 0);
    await decommission(rogue.id);

    const history = await getHistory(agent.id, null, 10);
    assert.deepEqual(history.map((entry) => entry.round_key), [nextRound, round.round_key]);
    assert.ok(history.every((entry) => entry.players.some((player) =>
      player.display_name_snapshot === 'Rogue du test' && player.account_status === 'deleted')));
    assert.equal((await loadProfile(rogue.id)).cognito_sub, null);
  });
});
