const idPattern = /^[a-f0-9]{32}$/;

export class ValidationError extends Error {}

function text(value, name, maximum, optional = false) {
  if (optional && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || value.length > maximum || (!optional && !value.length)) {
    throw new ValidationError(`Invalid ${name}`);
  }
  return value;
}

export function validateBatch(body) {
  if (!Array.isArray(body?.events) || body.events.length < 1 || body.events.length > 50) {
    throw new ValidationError('Expected between 1 and 50 error events');
  }
  const seen = new Set();
  return body.events.map((event) => {
    if (!event || typeof event.id !== 'string' || typeof event.sessionId !== 'string' ||
      !idPattern.test(event.id) || !idPattern.test(event.sessionId) || seen.has(event.id)) {
      throw new ValidationError('Invalid or duplicate event identifier');
    }
    seen.add(event.id);
    const timestamp = text(event.occurredAt, 'occurredAt', 32);
    const date = new Date(timestamp);
    if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(timestamp) || !Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() < 1000) {
      throw new ValidationError('Invalid error timestamp');
    }
    return {
      id: event.id,
      sessionId: event.sessionId,
      occurredAt: date.toISOString().slice(0, 23).replace('T', ' '),
      environment: text(event.environment, 'environment', 32),
      platform: text(event.platform, 'platform', 32),
      buildMode: text(event.buildMode, 'buildMode', 16),
      appVersion: text(event.appVersion, 'appVersion', 64),
      source: text(event.source, 'source', 255),
      message: text(event.message, 'message', 4096),
      errorType: text(event.errorType, 'errorType', 255, true),
      error: text(event.error, 'error', 8192, true),
      stackTrace: text(event.stackTrace, 'stackTrace', 32768, true),
      route: text(event.route, 'route', 255, true),
      appState: text(event.appState, 'appState', 32, true),
    };
  });
}

export function validateFilters(query) {
  const sessionId = query.sessionId;
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !idPattern.test(sessionId))) {
    throw new ValidationError('Invalid sessionId');
  }
  const limit = Number(query.limit ?? 500);
  const offset = Number(query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000 ||
    !Number.isInteger(offset) || offset < 0 || offset > 10000000) {
    throw new ValidationError('Invalid pagination');
  }
  return { sessionId, limit, offset };
}
