import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from './db/pool.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { usersRouter } from './modules/users/users.routes.js';
import { socialRouter } from './modules/social/social.routes.js';
import { progressionRouter } from './modules/progression/progression.routes.js';
import { billingRouter } from './modules/billing/billing.routes.js';
import { gamesRouter } from './modules/games/games.routes.js';
import { env } from './config/env.js';
import { adminConfig } from './modules/admin/security.js';
import { AdminRepository } from './modules/admin/repository.js';
import { AdminServices } from './modules/admin/services.js';
import { createAdminRouter } from './modules/admin/routes.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.trustProxy);
app.use((req, res, next) => {
  req.traceId = randomUUID();
  res.set({ 'Cache-Control': 'no-store', 'X-Request-Id': req.traceId });
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  const allowedOrigins = ['http://localhost:8081', 'http://127.0.0.1:8081'];

  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

const administrator = adminConfig();
app.use('/admin', createAdminRouter({
  config: administrator,
  repository: new AdminRepository(pool),
  services: new AdminServices(administrator),
}));

app.use(express.json({ limit: '4mb' }));

app.get('/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

app.use('/api', usersRouter);
app.use('/api', socialRouter);
app.use('/api', progressionRouter);
app.use('/api', gamesRouter);
app.use('/api', billingRouter);

app.use(notFoundHandler);
app.use(errorHandler);
