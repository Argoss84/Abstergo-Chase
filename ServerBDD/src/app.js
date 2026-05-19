import express from 'express';
import { pool } from './db/pool.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { usersRouter } from './modules/users/users.routes.js';
import { socialRouter } from './modules/social/social.routes.js';
import { progressionRouter } from './modules/progression/progression.routes.js';
import { gamesRouter } from './modules/games/games.routes.js';

export const app = express();

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

app.use(express.json({ limit: '1mb' }));

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

app.use(notFoundHandler);
app.use(errorHandler);
