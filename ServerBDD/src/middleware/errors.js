import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route introuvable' });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }

  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête JSON invalide' });
  const code = String(error.code ?? error.name ?? 'internal_error').replace(/[^\w.:-]/g, '_').slice(0, 80);
  console.error('ServerBDD request failed:', code, req.traceId);
  if (env.diagnosticsUrl.startsWith('https://') && env.diagnosticsToken) {
    void fetch(env.diagnosticsUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
      headers: { Authorization: 'Bearer ' + env.diagnosticsToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ samples: [{
        id: randomUUID().replaceAll('-', ''), source: 'serverbdd', severity: 'error', code,
        traceId: req.traceId, occurredAt: new Date().toISOString(),
      }] }),
    }).catch(() => {});
  }
  return res.status(500).json({ error: 'Erreur interne du serveur' });
}
