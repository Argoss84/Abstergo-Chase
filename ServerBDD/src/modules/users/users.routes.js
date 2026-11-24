import { Router } from 'express';
import Joi from 'joi';
import { requireAuth, requireAuthForSync, createSignalingTicket } from '../../middleware/auth-cognito.js';
import { requireAdmin } from '../../middleware/auth-service.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { pool, readJson, transaction } from '../../db/pool.js';
import { syncUserSchema, updateProfileSchema, settingsPatch } from './users.schemas.js';
import { signIn, signOut, loadProfile, saveProfile, patchSettings, decommission } from './users.repository.js';

export const usersRouter = Router();

usersRouter.post('/auth/sync', requireAuthForSync, validate(syncUserSchema), asyncHandler(async (req, res) => {
  res.json({ user: await signIn(req.auth, req.body.username) });
}));

usersRouter.post('/auth/logout', requireAuthForSync, asyncHandler(async (req, res) => {
  await signOut(req.auth);
  res.json({ success: true });
}));

usersRouter.post('/auth/signaling-ticket', requireAuth, asyncHandler(async (req, res) => {
  res.json({ ticket: await createSignalingTicket(req.auth) });
}));

usersRouter.get('/users/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: await loadProfile(req.auth.userId) });
}));

usersRouter.patch('/users/me', requireAuth, validate(updateProfileSchema), asyncHandler(async (req, res) => {
  try {
    res.json({ user: await saveProfile(req.auth.userId, req.body) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Ce pseudo est déjà utilisé');
    throw error;
  }
}));

usersRouter.get('/users/me/settings', requireAuth, asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT preferences_json, revision FROM user_settings WHERE user_id = ?', [req.auth.userId]);
  res.json({ preferences: readJson(row?.preferences_json, {}), revision: Number(row?.revision ?? 0) });
}));

usersRouter.patch('/users/me/settings', requireAuth, validate(Joi.object({
  preferences: settingsPatch.required(),
  revision: Joi.number().integer().min(0),
})), asyncHandler(async (req, res) => {
  const result = await transaction((db) => patchSettings(db, req.auth.userId, req.body.preferences, req.body.revision));
  res.json(result);
}));

const preset = Joi.object({ name: Joi.string().trim().min(1).max(60).required(), config: Joi.object().max(30).required() });
const presetId = Joi.object({ id: Joi.number().integer().positive().required() });

usersRouter.get('/users/me/lobby-presets', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, config_json, updated_at FROM lobby_presets WHERE user_id = ? ORDER BY name',
    [req.auth.userId]
  );
  res.json({ presets: rows.map((row) => ({ ...row, config_json: readJson(row.config_json) })) });
}));

usersRouter.put('/users/me/lobby-presets', requireAuth, validate(preset), asyncHandler(async (req, res) => {
  const config = JSON.stringify(req.body.config);
  if (Buffer.byteLength(config) > 8192) throw new HttpError(413, 'Préréglage trop volumineux');
  await pool.query(
    'INSERT INTO lobby_presets (user_id, name, config_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE config_json = ?',
    [req.auth.userId, req.body.name, config, config]
  );
  res.sendStatus(204);
}));

usersRouter.delete('/users/me/lobby-presets/:id', requireAuth, validate(presetId, 'params'), asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM lobby_presets WHERE id = ? AND user_id = ?', [req.params.id, req.auth.userId]);
  res.sendStatus(204);
}));

usersRouter.delete('/users/me', requireAuth, asyncHandler(async (req, res) => {
  const response = await fetch(new URL(req.auth.issuer).origin, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.DeleteUser',
    },
    body: JSON.stringify({ AccessToken: req.auth.token }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (error.__type?.split('#').pop() !== 'UserNotFoundException') {
      throw new HttpError(502, 'Cognito n’a pas pu supprimer ce compte');
    }
  }
  await decommission(req.auth.userId);
  res.sendStatus(204);
}));

usersRouter.get('/admin/connected-users', requireAdmin, asyncHandler(async (_req, res) => {
  const [users] = await pool.query(
    'SELECT u.id, u.username, s.updated_at AS last_seen_at FROM user_active_sessions s JOIN users u ON u.id = s.user_id ' +
    'WHERE s.expires_at > UTC_TIMESTAMP(3) ORDER BY s.updated_at DESC'
  );
  res.json({ users });
}));

usersRouter.delete('/admin/connected-users/:userId', requireAdmin, validate(
  Joi.object({ userId: Joi.number().integer().positive().required() }), 'params'
), asyncHandler(async (req, res) => {
  const [result] = await pool.query('DELETE FROM user_active_sessions WHERE user_id = ?', [req.params.userId]);
  if (!result.affectedRows) throw new HttpError(404, 'Session utilisateur introuvable');
  res.json({ success: true });
}));
