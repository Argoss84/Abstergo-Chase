import { Router } from 'express';
import Joi from 'joi';
import { pool } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth-cognito.js';
import { validate } from '../../middleware/validate.js';
import { HttpError } from '../../utils/http-error.js';
import { blockUserSchema, createFriendRequestSchema } from './social.schemas.js';

const paramsSchema = Joi.object({
  requestId: Joi.number().integer().positive().required(),
});

async function getCurrentUserId(cognitoSub) {
  const result = await pool.query('SELECT id FROM users WHERE cognito_sub = $1', [cognitoSub]);
  return result.rows[0]?.id ?? null;
}

export const socialRouter = Router();

socialRouter.get('/social/search', requireAuth, async (req, res, next) => {
  try {
    const query = String(req.query.q ?? '').trim();
    if (!query) {
      throw new HttpError(400, 'Paramètre q requis');
    }

    const result = await pool.query(
      `
      SELECT u.id, u.username, p.display_name, p.avatar_url
      FROM users u
      LEFT JOIN player_profiles p ON p.user_id = u.id
      WHERE u.username ILIKE $1 OR p.display_name ILIKE $1
      ORDER BY u.username ASC
      LIMIT 20
      `,
      [`%${query}%`]
    );

    res.json({ results: result.rows });
  } catch (error) {
    next(error);
  }
});

socialRouter.post(
  '/social/friend-requests',
  requireAuth,
  validate(createFriendRequestSchema),
  async (req, res, next) => {
    try {
      const requesterId = await getCurrentUserId(req.auth.sub);
      if (!requesterId) {
        throw new HttpError(404, 'Utilisateur introuvable, appelez /api/auth/sync');
      }
      if (requesterId === req.body.to_user_id) {
        throw new HttpError(400, 'Impossible de s’ajouter soi-même');
      }

      const result = await pool.query(
        `
        INSERT INTO friendships (requester_id, addressee_id, status)
        VALUES ($1, $2, 'pending')
        ON CONFLICT (requester_id, addressee_id) DO NOTHING
        RETURNING id, requester_id, addressee_id, status, created_at
        `,
        [requesterId, req.body.to_user_id]
      );

      if (result.rowCount === 0) {
        throw new HttpError(409, 'Demande déjà existante');
      }
      res.status(201).json({ request: result.rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

socialRouter.post(
  '/social/friend-requests/:requestId/accept',
  requireAuth,
  validate(paramsSchema, 'params'),
  async (req, res, next) => {
    try {
      const addresseeId = await getCurrentUserId(req.auth.sub);
      if (!addresseeId) {
        throw new HttpError(404, 'Utilisateur introuvable, appelez /api/auth/sync');
      }

      const result = await pool.query(
        `
        UPDATE friendships
        SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
        RETURNING id, requester_id, addressee_id, status, accepted_at
        `,
        [req.params.requestId, addresseeId]
      );

      if (result.rowCount === 0) {
        throw new HttpError(404, 'Demande introuvable');
      }
      res.json({ request: result.rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

socialRouter.post('/social/block', requireAuth, validate(blockUserSchema), async (req, res, next) => {
  try {
    const blockerId = await getCurrentUserId(req.auth.sub);
    if (!blockerId) {
      throw new HttpError(404, 'Utilisateur introuvable, appelez /api/auth/sync');
    }
    if (blockerId === req.body.user_id) {
      throw new HttpError(400, 'Impossible de se bloquer soi-même');
    }

    const result = await pool.query(
      `
      INSERT INTO blocked_users (blocker_id, blocked_id)
      VALUES ($1, $2)
      ON CONFLICT (blocker_id, blocked_id) DO NOTHING
      RETURNING blocker_id, blocked_id, created_at
      `,
      [blockerId, req.body.user_id]
    );

    if (result.rowCount === 0) {
      return res.status(200).json({ message: 'Utilisateur déjà bloqué' });
    }
    return res.status(201).json({ block: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});
