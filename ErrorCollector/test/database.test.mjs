import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { ErrorRepository } from '../src/repository.js';
import { loadConfig } from '../src/config.js';

test('real MySQL/MariaDB schema, idempotent retry, filtering and atomic rollback',
  { skip: process.env.RUN_MYSQL_TESTS !== '1' }, async () => {
    assert.match(process.env.DATABASE_NAME ?? '', /^codex_platform_test/);
    const pool = mysql.createPool(loadConfig().database);
    const sessionId = randomBytes(16).toString('hex');
    const firstId = randomBytes(16).toString('hex');
    const rollbackId = randomBytes(16).toString('hex');
    const entry = { id: firstId, sessionId, occurredAt: '2026-11-03 12:34:56.123',
      environment: 'test', platform: 'android', buildMode: 'release', appVersion: 'test',
      source: 'integration.gps', message: 'Erreur de test é 🛰️', errorType: 'StateError',
      error: 'offline', stackTrace: '#0 test', route: '/game', appState: 'resumed' };
    try {
      await pool.query(await readFile(new URL('../migrations/001_error_events.sql', import.meta.url), 'utf8'));
      const diagnosticsSql = await readFile(new URL('../migrations/002_diagnostics_and_voice.sql', import.meta.url), 'utf8');
      for (const statement of diagnosticsSql.split(';').map((part) => part.trim()).filter(Boolean)) {
        await pool.query(statement);
      }
      const repository = new ErrorRepository(pool);
      const uploadedBy = 'b'.repeat(64);
      const voiceEnvironment = 'voice-' + sessionId.slice(0, 12);
      const occurredAt = new Date();
      const voice = { id: randomBytes(16).toString('hex'), sessionId, environment: voiceEnvironment, phase: 'game',
        occurredAt, counters: [300, 100, 20, 80, 12, 2] };
      await repository.insertVoice([voice]);
      await repository.insertVoice([voice]);
      const report = await repository.voiceSummary({
        since: new Date(occurredAt.getTime() - 60000), until: new Date(occurredAt.getTime() + 60000),
        environment: voiceEnvironment,
      });
      assert.equal(report.total, 500);
      assert.equal(report.percentage.p2p, 60);
      assert.equal(report.percentage.ownTurn, 20);
      assert.equal(report.percentage.unknown, 16);
      assert.equal(report.phases.game.total, 500);
      assert.deepEqual(await repository.insertBatch([entry], uploadedBy), [firstId]);
      await repository.insertBatch([entry], uploadedBy);
      const rows = await repository.list({ sessionId, limit: 10, offset: 0 });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].message, entry.message);
      assert.equal(rows[0].occurred_at, entry.occurredAt);
      assert.ok((await repository.sessions()).some((row) => row.session_id === sessionId));
      await assert.rejects(repository.insertBatch([
        { ...entry, id: rollbackId }, { ...entry, id: randomBytes(16).toString('hex'), message: null },
      ], uploadedBy));
      assert.equal((await repository.list({ sessionId, limit: 10, offset: 0 })).length, 1);
    } finally {
      await pool.execute('DELETE FROM error_events WHERE session_id = ?', [sessionId]);
      await pool.execute('DELETE FROM voice_route_samples WHERE session_id = ?', [sessionId]);
      await pool.end();
    }
  });
