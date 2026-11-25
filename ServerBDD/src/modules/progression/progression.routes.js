import { Router } from 'express';
import Joi from 'joi';
import { pool, transaction } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth-cognito.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { getProgression, unlockBonuses } from './progression.repository.js';

export const progressionRouter = Router();
progressionRouter.use('/progression', requireAuth);

progressionRouter.get('/progression/me', asyncHandler(async (req, res) => {
  res.json({ stats: await getProgression(req.auth.userId) });
}));

progressionRouter.get('/progression/bonuses', asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  await unlockBonuses(pool, userId);
  const [bonuses] = await pool.query(
    'SELECT b.id, b.label, b.description, b.minimum_level, b.allowed_role, b.use_type, p.remaining_charges, ' +
    'p.user_id IS NOT NULL AS unlocked, COALESCE(p.equipped, 0) AS equipped ' +
    'FROM bonuses b LEFT JOIN player_bonus_unlocks p ON p.bonus_id = b.id AND p.user_id = ? ' +
    'WHERE b.enabled = 1 ORDER BY b.minimum_level, b.id',
    [userId]
  );
  res.json({ bonuses });
}));

progressionRouter.put('/progression/bonuses/:id', validate(Joi.object({
  id: Joi.string().max(48).required(),
}), 'params'), validate(Joi.object({ equipped: Joi.boolean().required() })), asyncHandler(async (req, res) => {
  await transaction(async (db) => {
    const [[bonus]] = await db.query(
      'SELECT p.equipped, p.remaining_charges, b.enabled FROM player_bonus_unlocks p JOIN bonuses b ON b.id = p.bonus_id ' +
      'WHERE p.user_id = ? AND p.bonus_id = ? FOR UPDATE',
      [req.auth.userId, req.params.id]
    );
    if (!bonus || (req.body.equipped && (!bonus.enabled || bonus.remaining_charges === 0))) {
      throw new HttpError(409, 'Ce bonus ne peut pas être équipé');
    }
    await db.query('UPDATE player_bonus_unlocks SET equipped = ? WHERE user_id = ? AND bonus_id = ?',
      [req.body.equipped, req.auth.userId, req.params.id]);
  });
  res.sendStatus(204);
}));
