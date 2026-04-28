import express from 'express';
import { pool } from './db/pool.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { usersRouter } from './modules/users/users.routes.js';
import { socialRouter } from './modules/social/social.routes.js';
import { progressionRouter } from './modules/progression/progression.routes.js';

export const app = express();

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

app.use(notFoundHandler);
app.use(errorHandler);
