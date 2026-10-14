import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Opt in only against a disposable database; never migrate a developer's DB.
const enabled = process.env.RUN_DATABASE_TESTS === '1';
test('Game events serialize concurrent writers per game', { skip: !enabled, timeout: 30000 }, async (t) => {
  assert.match(process.env.DATABASE_NAME ?? '', /^codex_events_test_/);
  const { pool, closePool } = await import('../src/db/pool.js');
  t.after(closePool);
  const { appendGameEvent, createOrUpdateGame, getGameEvents } =
    await import('../src/modules/games/games.repository.js');

  // Create only the prerequisite referenced by the real game schema.
  await pool.query('CREATE TABLE users (id BIGSERIAL PRIMARY KEY)');
  const schema = await readFile(new URL('../migrations/003_games_management.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  const firstGame = await createOrUpdateGame({ gameCode: 'CONCURRENT' });
  const otherGame = await createOrUpdateGame({ gameCode: 'INDEPENDENT' });

  await t.test('64 simultaneous events have unique contiguous sequences and retain their payloads', async () => {
    const writes = Array.from({ length: 64 }, (_, index) => appendGameEvent({
      gameId: firstGame.id,
      eventType: 'test:concurrent',
      actorExternalId: `player-${index % 3}`,
      payloadJson: { index },
    }));
    await Promise.all(writes);
    const events = await getGameEvents(firstGame.id);
    assert.equal(events.length, 64);
    assert.deepEqual(events.map((event) => Number(event.sequence_no)),
      Array.from({ length: 64 }, (_, i) => i + 1));
    assert.deepEqual(events.map((event) => event.payload_json.index).sort((a, b) => a - b),
      Array.from({ length: 64 }, (_, i) => i));
  });

  await t.test('A failed insert releases the lock and leaves no sequence gap', async () => {
    await assert.rejects(appendGameEvent({ gameId: firstGame.id, eventType: null }),
      (error) => error.code === '23502');
    const event = await appendGameEvent({ gameId: firstGame.id, eventType: 'test:after-error' });
    assert.equal(Number(event.sequence_no), 65);
  });

  await t.test('A lock held for one game does not block another game', async () => {
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM games WHERE id = $1 FOR NO KEY UPDATE', [firstGame.id]);
      const event = await appendGameEvent({ gameId: otherGame.id, eventType: 'test:independent' });
      assert.equal(Number(event.sequence_no), 1);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  });
});
