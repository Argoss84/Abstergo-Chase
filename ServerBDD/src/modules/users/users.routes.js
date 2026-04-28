import { Router } from 'express';
import { requireAuth } from '../../middleware/auth-cognito.js';
import { validate } from '../../middleware/validate.js';
import { HttpError } from '../../utils/http-error.js';
import { syncUserSchema, updateProfileSchema } from './users.schemas.js';
import { getByCognitoSub, upsertFromCognito, upsertProfileByCognitoSub } from './users.repository.js';

export const usersRouter = Router();

usersRouter.post('/auth/sync', requireAuth, validate(syncUserSchema), async (req, res, next) => {
  try {
    const user = await upsertFromCognito({
      cognitoSub: req.auth.sub,
      email: req.auth.email,
      username: req.body.username ?? req.auth.username,
    });
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.get('/users/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getByCognitoSub(req.auth.sub);
    if (!user) {
      throw new HttpError(404, 'Utilisateur introuvable, appelez /api/auth/sync');
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.patch('/users/me', requireAuth, validate(updateProfileSchema), async (req, res, next) => {
  try {
    const user = await upsertProfileByCognitoSub(req.auth.sub, req.body);
    if (!user) {
      throw new HttpError(404, 'Utilisateur introuvable, appelez /api/auth/sync');
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});
