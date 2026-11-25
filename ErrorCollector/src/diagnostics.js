import { createHash } from 'node:crypto';
import { ValidationError } from './validation.js';

const hexId = /^[0-9a-f]{32}$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const code = /^[\w.:-]{1,80}$/;
const anonymous = '0'.repeat(64);

function timestamp(value) {
  const date = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(date.getTime()) ||
      Math.abs(date.getTime() - Date.now()) > 31 * 86_400_000) {
    throw new ValidationError('Invalid diagnostic time');
  }
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function assert(condition) {
  if (!condition) throw new ValidationError('Invalid diagnostic sample');
}

function scrub(value) {
  return value?.replace(/\bBearer\s+\S+/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/((?:password|(?:access|refresh|id|purchase)[_-]?token|authorization)\s*[:=]\s*)[^,;\s]+/gi, '$1[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, '[COORDINATES]') ?? null;
}

export function cleanErrors(events, isAnonymous) {
  return events.map((event) => ({
    ...event,
    source: scrub(event.source),
    message: scrub(event.message),
    errorType: scrub(event.errorType),
    error: isAnonymous ? null : scrub(event.error),
    stackTrace: scrub(event.stackTrace)?.replace(/\bhttps?:\/\/\S+/g, '[URL]') ?? null,
    route: scrub(event.route)?.split(/[?#]/)[0] ?? null,
  }));
}

export function anonymousUploader() {
  return anonymous;
}

function samples(body, project) {
  assert(Array.isArray(body?.samples) && body.samples.length > 0 && body.samples.length <= 50);
  const ids = new Set();
  return body.samples.map((sample) => {
    assert(sample && typeof sample.id === 'string' && hexId.test(sample.id) && !ids.has(sample.id));
    ids.add(sample.id);
    return project(sample, timestamp(sample.occurredAt));
  });
}

export function voiceSamples(body) {
  return samples(body, (sample, occurredAt) => {
    assert(hexId.test(sample.sessionId) && /^[\w-]{1,32}$/.test(sample.environment));
    assert(['lobby', 'game', 'unknown'].includes(sample.phase));
    const counters = ['p2pBytes', 'ownTurnBytes', 'otherTurnBytes', 'unknownBytes',
      'measuredIntervals', 'unmeasurableIntervals'];
    assert(counters.every((key) => Number.isSafeInteger(sample[key]) && sample[key] >= 0 && sample[key] <= 2 ** 32));
    assert(sample.measuredIntervals + sample.unmeasurableIntervals > 0 &&
      sample.measuredIntervals + sample.unmeasurableIntervals <= 10000);
    return { id: sample.id, sessionId: sample.sessionId, environment: sample.environment, phase: sample.phase,
      occurredAt, counters: counters.map((key) => sample[key]) };
  });
}

export function serverSamples(body) {
  return samples(body, (sample, occurredAt) => {
    assert(typeof sample.source === 'string' && code.test(sample.source) && sample.source.length <= 64);
    assert(typeof sample.code === 'string' && code.test(sample.code));
    assert(['info', 'warn', 'error'].includes(sample.severity));
    assert(sample.roundKey == null || (typeof sample.roundKey === 'string' && uuid.test(sample.roundKey)));
    assert(sample.traceId == null || (typeof sample.traceId === 'string' && uuid.test(sample.traceId)));
    return { id: sample.id, source: sample.source, code: sample.code, severity: sample.severity,
      roundKey: sample.roundKey ?? null, traceId: sample.traceId ?? null, occurredAt };
  });
}

export function voiceReportFilters(query) {
  const now = Date.now();
  const until = new Date(query.until ?? now);
  const since = new Date(query.since ?? (until.getTime() - 30 * 86_400_000));
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) ||
      until <= since || until - since > 31 * 86_400_000 ||
      (query.environment != null && !/^[\w-]{1,32}$/.test(query.environment))) {
    throw new ValidationError('Invalid report date range');
  }
  return { since, until, environment: query.environment ?? null };
}

export function voiceReport(row) {
  const bytes = {
    p2p: Number(row.p2p ?? 0),
    ownTurn: Number(row.own_turn ?? 0),
    otherTurn: Number(row.other_turn ?? 0),
    unknown: Number(row.unknown_path ?? 0),
  };
  const total = Object.values(bytes).reduce((sum, count) => sum + count, 0);
  return {
    bytes, total,
    percentage: Object.fromEntries(Object.entries(bytes).map(([key, count]) => [key, total ? 100 * count / total : null])),
    measuredIntervals: Number(row.measured ?? 0),
    unmeasurableIntervals: Number(row.unmeasurable ?? 0),
  };
}

export function fingerprint(event) {
  return createHash('sha256').update([event.source, event.error_type ?? '', event.message].join('\0')).digest('hex');
}
