import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanErrors, voiceReport, voiceSamples } from '../src/diagnostics.js';

test('the voice report keeps unknown traffic in the denominator and distinguishes missing counters', () => {
  const report = voiceReport({ p2p: '600', own_turn: '200', other_turn: '100', unknown_path: '100',
    measured: '9', unmeasurable: '3' });
  assert.deepEqual(report.percentage, { p2p: 60, ownTurn: 20, otherTurn: 10, unknown: 10 });
  assert.equal(report.total, 1000);
  assert.equal(report.unmeasurableIntervals, 3);
  assert.equal(voiceReport({}).percentage.ownTurn, null);
});

test('voice uploads accept counters and leave candidate details out of the stored report', () => {
  const sample = { id: '1'.repeat(32), sessionId: '2'.repeat(32), environment: 'production',
    phase: 'game', occurredAt: new Date().toISOString(), p2pBytes: 4, ownTurnBytes: 2,
    otherTurnBytes: 0, unknownBytes: 1, measuredIntervals: 2, unmeasurableIntervals: 1,
    candidateAddress: '203.0.113.1' };
  const [parsed] = voiceSamples({ samples: [sample] });
  assert.deepEqual(parsed.counters, [4, 2, 0, 1, 2, 1]);
  assert.equal(parsed.candidateAddress, undefined);
  assert.throws(() => voiceSamples({ samples: [sample, sample] }));
});

test('pre-authentication errors keep a stack and scrub private fields', () => {
  const [event] = cleanErrors([{
    source: 'geo', message: 'user@example.com at 43.5123, 5.1234 Bearer hidden-token',
    error: 'Raw error', stackTrace: '#0 test function', route: '/login?code=secretroute',
  }], true);
  assert.equal(event.message, '[EMAIL] at [COORDINATES] [REDACTED]');
  assert.equal(event.error, null);
  assert.equal(event.stackTrace, '#0 test function');
  assert.equal(event.route, '/login');
});
