import express from 'express';
import { isAdmin } from './auth.js';
import { ValidationError, validateBatch, validateFilters } from './validation.js';
import { anonymousUploader, cleanErrors, serverSamples, voiceReportFilters, voiceSamples } from './diagnostics.js';

// Bounded, process-local rate limit; no background timer or external service.
function rateLimiter(maximum, windowMs = 60000) {
  const clients = new Map();
  let nextCleanup = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now >= nextCleanup) {
      for (const [key, entry] of clients) if (entry.resetAt <= now) clients.delete(key);
      nextCleanup = now + windowMs;
    }
    const key = req.ip;
    let entry = clients.get(key);
    if (!entry || entry.resetAt <= now) {
      if (clients.size >= 10000 && !entry) return res.status(429).json({ error: 'Rate limit' });
      entry = { count: 0, resetAt: now + windowMs };
      clients.set(key, entry);
    }
    if (++entry.count > maximum) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ error: 'Rate limit' });
    }
    next();
  };
}

export function createApp({ repository, authenticate, adminToken, production = false,
  trustProxy = 0, basePath = '', serverToken = '', requestsPerMinute = 120, reportError = console.error }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  // Passenger can forward the application mount path or strip it itself.
  if (basePath) app.use((req, _res, next) => {
    if (req.url === basePath || req.url.startsWith(`${basePath}/`)) {
      req.url = req.url.slice(basePath.length) || '/';
    }
    next();
  });
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', (req, res, next) => {
    if (production && !req.secure) return res.status(400).json({ error: 'HTTPS required' });
    next();
  }, rateLimiter(requestsPerMinute));
  const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const requireAdmin = (req, res, next) => {
    if (!isAdmin(req.headers.authorization, adminToken)) {
      return res.status(401).json({ error: 'Administrator authentication required' });
    }
    next();
  };
  app.post('/api/errors', asyncRoute(async (req, res) => {
    try { req.uploadedBy = await authenticate(req.headers.authorization); }
    catch { return res.status(401).json({ error: 'Invalid or expired access token' }); }
    // Parse only after authentication, with a bounded request body.
    await new Promise((resolve, reject) => express.json({ limit: '2mb', strict: true })(req, res,
      (error) => error ? reject(error) : resolve()));
    const events = cleanErrors(validateBatch(req.body), false);
    const acceptedIds = await repository.insertBatch(events, req.uploadedBy);
    res.status(202).json({ acceptedIds });
  }));
  app.post('/api/errors/anonymous', rateLimiter(12), express.json({ limit: '2mb' }),
    asyncRoute(async (req, res) => {
      const events = cleanErrors(validateBatch(req.body), true);
      const acceptedIds = await repository.insertBatch(events, anonymousUploader());
      res.status(202).json({ acceptedIds });
    })
  );
  app.post('/api/voice-routes', asyncRoute(async (req, res) => {
    try { await authenticate(req.headers.authorization); }
    catch { return res.status(401).json({ error: 'Invalid or expired access token' }); }
    return await new Promise((resolve, reject) => express.json({ limit: '64kb' })(req, res, (error) => error ? reject(error) : resolve()))
      .then(async () => res.status(202).json({ acceptedIds: await repository.insertVoice(voiceSamples(req.body)) }));
  }));
  app.post('/api/diagnostics/server', express.json({ limit: '64kb' }), asyncRoute(async (req, res) => {
    if (!serverToken || !isAdmin(req.headers.authorization, serverToken)) return res.sendStatus(401);
    return res.status(202).json({ acceptedIds: await repository.insertServer(serverSamples(req.body)) });
  }));
  app.get('/api/diagnostics/server', requireAdmin, asyncRoute(async (_req, res) => {
    res.json({ events: await repository.serverEvents() });
  }));
  app.get('/api/voice-routes/summary', requireAdmin, asyncRoute(async (req, res) => {
    res.json(await repository.voiceSummary(voiceReportFilters(req.query)));
  }));
  app.get('/api/error-signatures', requireAdmin, asyncRoute(async (_req, res) => {
    res.json({ signatures: await repository.signatures() });
  }));
  app.get('/api/error-sessions', requireAdmin, asyncRoute(async (_req, res) => {
    res.json({ sessions: await repository.sessions() });
  }));
  app.get('/api/errors', requireAdmin, asyncRoute(async (req, res) => {
    const filters = validateFilters(req.query);
    const events = await repository.list(filters);
    if (req.query.download === '1') res.attachment('abstergo-errors.json');
    res.json({ schemaVersion: 1, exportedAt: new Date().toISOString(),
      offset: filters.offset, nextOffset: events.length === filters.limit ? filters.offset + events.length : null,
      events });
  }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, _req, res, _next) => {
    if (error instanceof ValidationError || error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid error report' });
    }
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Report too large' });
    // Never log request headers, bearer tokens or the report contents.
    reportError('Error collector request failed:', error.code ?? error.name);
    res.status(503).json({ error: 'Error storage temporarily unavailable' });
  });
  return app;
}
