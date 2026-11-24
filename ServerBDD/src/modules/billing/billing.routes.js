import { Router } from 'express';
import Joi from 'joi';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth-cognito.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { billingStatus, verifySubscription } from './billing.repository.js';
import { verifyPush } from './play-client.js';

export const billingRouter = Router();

billingRouter.get('/billing/me', requireAuth, asyncHandler(async (req, res) => {
  res.json(await billingStatus(req.auth.userId, req.auth.publicId));
}));

const purchaseToken = Joi.string().trim().min(10).max(2048);
billingRouter.post('/billing/play/verify', requireAuth, validate(Joi.object({
  purchase_token: purchaseToken.required(),
})), asyncHandler(async (req, res) => {
  await verifySubscription(req.body.purchase_token, req.auth);
  res.json(await billingStatus(req.auth.userId, req.auth.publicId));
}));

billingRouter.post('/billing/play/notifications', verifyPush, asyncHandler(async (req, res) => {
  const message = req.body.message;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
  } catch {
    throw new HttpError(400, 'Format de notification invalide');
  }
  if (payload.packageName !== env.play.packageName || !payload.subscriptionNotification) return res.sendStatus(204);
  const { purchaseToken: token, notificationType } = payload.subscriptionNotification;
  if (purchaseToken.validate(token).error || !Number.isInteger(notificationType) ||
      typeof message.messageId !== 'string' || !/^[0-9A-Za-z_-]{1,128}$/.test(message.messageId)) {
    throw new HttpError(400, 'Notification d’abonnement invalide');
  }
  await verifySubscription(token, null, { id: message.messageId, type: notificationType });
  return res.sendStatus(204);
}));
