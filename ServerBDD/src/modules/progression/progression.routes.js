import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth-cognito.js';
import { validate } from '../../middleware/validate.js';
import { HttpError } from '../../utils/http-error.js';
import { updateProgressionSchema } from './progression.schemas.js';

async function getCurrentUserId(cognitoSub) {
  const result = await pool.query('SELECT id FROM users WHERE cognito_sub = $1', [cognitoSub]);
  return result.rows[0]?.id ?? null;
}

export const progressionRouter = Router();

progressionRouter.get('/progression/me', requireAuth, async (req, res, next) => {
  try {
    const userId = await getCurrentUserId(req.auth.sub);
    if (!userId) {
      throw new HttpError(404, 'Utilisateur introuvable, appelez /api/auth/sync');
    }

    const result = await pool.query(
      `
      INSERT INTO player_stats (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
      `,
      [userId]
    );
    void result;

    const stats = await pool.query(
      'SELECT user_id, level, xp, rank_tier, wins, losses, updated_at FROM player_stats WHERE user_id = $1',
      [userId]
    );
    res.json({ stats: stats.rows[0] });
  } catch (error) {
    next(error);
  }
});

progressionRouter.patch(
  '/progression/me',
  requireAuth,
  validate(updateProgressionSchema),
  async (req, res, next) => {
    try {
      const userId = await getCurrentUserId(req.auth.sub);
      if (!userId) {
        throw new HttpError(404, 'Utilisateur introuvable, appelez /api/auth/sync');
      }

      await pool.query(
        `
        INSERT INTO player_stats (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [userId]
      );

      const updated = await pool.query(
        `
        UPDATE player_stats
        SET
          xp = GREATEST(0, xp + $2),
          wins = GREATEST(0, wins + $3),
          losses = GREATEST(0, losses + $4),
          level = GREATEST(1, ((GREATEST(0, xp + $2) / 1000) + 1)),
          updated_at = NOW()
        WHERE user_id = $1
        RETURNING user_id, level, xp, rank_tier, wins, losses, updated_at
        `,
        [userId, req.body.xp_delta ?? 0, req.body.wins_delta ?? 0, req.body.losses_delta ?? 0]
      );

      res.json({ stats: updated.rows[0] });
    } catch (error) {
      next(error);
    }
  }
);
