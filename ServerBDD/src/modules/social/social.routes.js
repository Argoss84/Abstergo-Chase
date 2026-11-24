import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth-cognito.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { pool, transaction } from '../../db/pool.js';

export const socialRouter = Router();
socialRouter.use('/social', requireAuth);

const publicFields = 'u.public_id, u.username, p.display_name, p.avatar_url, COALESCE(s.level, 1) AS level';
const profileJoins = 'LEFT JOIN player_profiles p ON p.user_id = u.id LEFT JOIN player_stats s ON s.user_id = u.id';
const noBlock = 'NOT EXISTS (SELECT 1 FROM blocked_users b WHERE ' +
  '(b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocked_id = ? AND b.blocker_id = u.id))';
const target = Joi.object({ public_id: Joi.string().uuid().required() });

socialRouter.get('/social/search', validate(Joi.object({
  q: Joi.string().trim().min(2).max(40).required(),
}), 'query'), asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const prefix = req.query.q.replace(/[!%_]/g, '!$&') + '%';
  const [players] = await pool.query(
    'SELECT ' + publicFields + ' FROM users u ' + profileJoins +
    ' WHERE u.status = ? AND u.id <> ? AND ' + noBlock +
    " AND (u.username LIKE ? ESCAPE '!' OR p.display_name LIKE ? ESCAPE '!') ORDER BY u.username, u.id LIMIT 30",
    ['active', userId, userId, userId, prefix, prefix]
  );
  res.json({ players });
}));

socialRouter.get('/social/recent', asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const [players] = await pool.query(
    'SELECT ' + publicFields + ', recent.last_played_at ' +
    'FROM (SELECT other.user_id, MAX(g.ended_at) AS last_played_at FROM game_players mine ' +
    'JOIN game_players other ON other.game_id = mine.game_id AND other.user_id <> mine.user_id ' +
    'JOIN games g ON g.id = mine.game_id WHERE mine.user_id = ? AND g.ended_at IS NOT NULL ' +
    'GROUP BY other.user_id) recent JOIN users u ON u.id = recent.user_id ' + profileJoins +
    ' WHERE u.status = ? AND ' + noBlock + ' ORDER BY recent.last_played_at DESC, u.id LIMIT 50',
    [userId, 'active', userId, userId]
  );
  res.json({ players });
}));

socialRouter.get('/social/friends', asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const [friends] = await pool.query(
    'SELECT ' + publicFields + ', f.id AS friendship_id, f.status, f.addressee_id = ? AS incoming ' +
    'FROM friendships f JOIN users u ON u.id = IF(f.requester_id = ?, f.addressee_id, f.requester_id) ' +
    profileJoins + ' WHERE (f.requester_id = ? OR f.addressee_id = ?) ' +
    "AND f.status IN ('pending', 'accepted') AND u.status = 'active' ORDER BY f.updated_at DESC LIMIT 100",
    [userId, userId, userId, userId]
  );
  res.json({ friends });
}));

async function withTarget(auth, publicId, action) {
  return transaction(async (db) => {
    const [[other]] = await db.query('SELECT id FROM users WHERE public_id = ? AND status = ?', [publicId, 'active']);
    if (!other) throw new HttpError(404, 'Joueur introuvable');
    if (other.id === auth.userId) throw new HttpError(400, 'Choisis un autre joueur');
    const pair = [Number(auth.userId), Number(other.id)].sort((a, b) => a - b);
    const [active] = await db.query('SELECT id FROM users WHERE id IN (?, ?) AND status = ? ORDER BY id FOR UPDATE', [...pair, 'active']);
    if (active.length !== 2) throw new HttpError(404, 'Joueur introuvable');
    return action(db, other.id, pair);
  });
}

socialRouter.post('/social/friends/request', validate(target), asyncHandler(async (req, res) => {
  await withTarget(req.auth, req.body.public_id, async (db, other, pair) => {
    const userId = req.auth.userId;
    const [blocks] = await db.query(
      'SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
      [userId, other, other, userId]
    );
    if (blocks.length) throw new HttpError(404, 'Joueur introuvable');
    const [[friend]] = await db.query('SELECT * FROM friendships WHERE user_low_id = ? AND user_high_id = ?', pair);
    if (!friend) {
      await db.query(
        'INSERT INTO friendships (user_low_id, user_high_id, requester_id, addressee_id) VALUES (?, ?, ?, ?)',
        [...pair, userId, other]
      );
    } else if (friend.status === 'declined') {
      await db.query(
        'UPDATE friendships SET status = ?, requester_id = ?, addressee_id = ?, accepted_at = NULL WHERE id = ?',
        ['pending', userId, other, friend.id]
      );
    } else if (friend.status === 'pending' && friend.addressee_id === userId) {
      await db.query('UPDATE friendships SET status = ?, accepted_at = UTC_TIMESTAMP(3) WHERE id = ?', ['accepted', friend.id]);
    }
  });
  res.sendStatus(204);
}));

socialRouter.post('/social/friends/respond', validate(Joi.object({
  friendship_id: Joi.number().integer().positive().required(),
  accept: Joi.boolean().required(),
})), asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    "UPDATE friendships SET status = ?, accepted_at = IF(?, UTC_TIMESTAMP(3), NULL) WHERE id = ? AND addressee_id = ? AND status = 'pending'",
    [req.body.accept ? 'accepted' : 'declined', req.body.accept, req.body.friendship_id, req.auth.userId]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Demande introuvable');
  res.sendStatus(204);
}));

socialRouter.delete('/social/friends/:id', validate(Joi.object({
  id: Joi.number().integer().positive().required(),
}), 'params'), asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?)',
    [req.params.id, req.auth.userId, req.auth.userId]);
  res.sendStatus(204);
}));

socialRouter.post('/social/block', validate(target), asyncHandler(async (req, res) => {
  await withTarget(req.auth, req.body.public_id, async (db, other, pair) => {
    await db.query(
      'INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE blocked_id = blocked_id',
      [req.auth.userId, other]
    );
    await db.query('DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?', pair);
  });
  res.sendStatus(204);
}));

socialRouter.delete('/social/block/:public_id', validate(target, 'params'), asyncHandler(async (req, res) => {
  await pool.query(
    'DELETE b FROM blocked_users b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? AND u.public_id = ?',
    [req.auth.userId, req.params.public_id]
  );
  res.sendStatus(204);
}));

socialRouter.get('/players/:public_id', requireAuth, validate(target, 'params'), asyncHandler(async (req, res) => {
  const [[profile]] = await pool.query(
    'SELECT ' + publicFields + ', u.status FROM users u ' + profileJoins + ' WHERE u.public_id = ? AND ' + noBlock,
    [req.params.public_id, req.auth.userId, req.auth.userId]
  );
  if (!profile || profile.status === 'suspended') throw new HttpError(404, 'Joueur introuvable');
  res.json({ player: profile.status === 'deleted' ? { status: 'deleted', display_name: 'Agent décommissionné' } : profile });
}));
