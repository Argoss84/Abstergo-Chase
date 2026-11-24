import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

function requireKey(getKey) {
  return (req, _res, next) => {
    const expected = getKey();
    if (!expected) return next(new HttpError(503, 'Accès au service indisponible'));
    const supplied = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1] ?? '';
    const digest = (value) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(supplied), digest(expected))) {
      return next(new HttpError(401, 'Authentification du service requise'));
    }
    return next();
  };
}

export const requireSignaling = requireKey(() => env.signalingKey);
export const requireAdmin = requireKey(() => env.adminKey);
