import { Router } from 'express';
import Joi from 'joi';
import { requireAuth, requireAuthForSync } from '../../middleware/auth-cognito.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { syncUserSchema, updateProfileSchema } from './users.schemas.js';
import {
  activateSessionIfAvailable,
  disconnectSessionByCognitoSub,
  disconnectUserSession,
  getByCognitoSub,
  listConnectedUsers,
  upsertFromCognito,
  upsertProfileByCognitoSub,
} from './users.repository.js';

export const usersRouter = Router();
const connectedUserParamsSchema = Joi.object({
  userId: Joi.number().integer().positive().required(),
});

usersRouter.post(
  '/auth/sync',
  requireAuthForSync,
  validate(syncUserSchema),
  asyncHandler(async (req, res) => {
    const user = await upsertFromCognito({
      cognitoSub: req.auth.sub,
      email: req.auth.email,
      username: req.body.username ?? req.auth.username,
    });

    const sessionActivated = await activateSessionIfAvailable(
      req.auth.sub,
      req.auth.accessTokenHash
    );
    if (!sessionActivated) {
      throw new HttpError(500, 'Impossible d\'activer la session utilisateur');
    }
    res.status(200).json({ user });
  })
);

usersRouter.post(
  '/auth/logout',
  requireAuthForSync,
  asyncHandler(async (req, res) => {
    await disconnectSessionByCognitoSub(req.auth.sub, req.auth.accessTokenHash);
    res.json({ success: true });
  })
);

usersRouter.get(
  '/users/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getByCognitoSub(req.auth.sub);
    if (!user) {
      throw new HttpError(404, 'Utilisateur introuvable, appelez /api/auth/sync');
    }
    res.json({ user });
  })
);

usersRouter.patch('/users/me', requireAuth, validate(updateProfileSchema), async (req, res, next) => {
  try {
    const user = await upsertProfileByCognitoSub(req.auth.sub, req.body);
    if (!user) {
      throw new HttpError(404, 'Utilisateur introuvable, appelez /api/auth/sync');
    }
    res.json({ user });
  } catch (error) {
    if (error?.code === '23505') {
      return next(new HttpError(409, 'Username deja utilise'));
    }
    next(error);
  }
});

usersRouter.get(
  '/admin/connected-users',
  asyncHandler(async (_req, res) => {
    const users = await listConnectedUsers();
    res.json({ users });
  })
);

usersRouter.delete(
  '/admin/connected-users/:userId',
  validate(connectedUserParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const disconnected = await disconnectUserSession(req.params.userId);
    if (!disconnected) {
      throw new HttpError(404, 'Session utilisateur introuvable');
    }
    res.json({ success: true });
  })
);
