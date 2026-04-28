import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const jwks = createRemoteJWKSet(new URL(`${env.cognito.issuer}/.well-known/jwks.json`));

export async function requireAuth(req, _res, next) {
  try {
    const rawAuth = req.headers.authorization ?? '';
    if (!rawAuth.startsWith('Bearer ')) {
      throw new HttpError(401, 'Token Bearer requis');
    }

    const token = rawAuth.replace('Bearer ', '').trim();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.cognito.issuer,
      audience: env.cognito.audience,
    });

    req.auth = {
      sub: payload.sub,
      email: payload.email ?? null,
      username: payload['cognito:username'] ?? payload.preferred_username ?? null,
    };
    return next();
  } catch (error) {
    if (error instanceof HttpError) {
      return next(error);
    }
    return next(new HttpError(401, 'Token invalide ou expiré'));
  }
}
