import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { HttpError } from '../utils/http-error.js';

const jwks = createRemoteJWKSet(
  new URL(`${env.cognito.issuer}/.well-known/jwks.json`)
);

function hashAccessToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function verifyAndAttachAuth(req) {
  const rawAuth = req.headers.authorization ?? '';
  if (!rawAuth.startsWith('Bearer ')) {
    throw new HttpError(401, 'Token Bearer requis');
  }

  const token = rawAuth.replace('Bearer ', '').trim();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.cognito.issuer,
  });

  const tokenUse = payload.token_use;
  if (tokenUse === 'id' && payload.aud !== env.cognito.audience) {
    throw new HttpError(401, 'Audience Cognito invalide');
  }
  if (tokenUse === 'access' && payload.client_id !== env.cognito.audience) {
    throw new HttpError(401, 'Client Cognito invalide');
  }

  req.auth = {
    sub: payload.sub,
    email: payload.email ?? null,
    username: payload['cognito:username'] ?? payload.preferred_username ?? null,
    accessTokenHash: hashAccessToken(token),
  };
}

async function enforceSingleDeviceSession(cognitoSub, accessTokenHash) {
  const result = await pool.query(
    `
    SELECT s.access_token_hash
    FROM user_active_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE u.cognito_sub = $1
    `,
    [cognitoSub]
  );

  if (result.rowCount === 0) {
    throw new HttpError(
      401,
      'Session applicative absente. Reconnectez-vous pour initialiser la session.'
    );
  }

  if (result.rows[0].access_token_hash !== accessTokenHash) {
    throw new HttpError(
      401,
      'Session invalidee: ce compte est actif sur un autre appareil.'
    );
  }
}

export async function requireAuth(req, _res, next) {
  try {
    await verifyAndAttachAuth(req);
    await enforceSingleDeviceSession(req.auth.sub, req.auth.accessTokenHash);
    return next();
  } catch (error) {
    if (error instanceof HttpError) {
      return next(error);
    }
    return next(new HttpError(401, 'Token invalide ou expiré'));
  }
}

export async function requireAuthForSync(req, _res, next) {
  try {
    await verifyAndAttachAuth(req);
    return next();
  } catch (error) {
    if (error instanceof HttpError) {
      return next(error);
    }
    return next(new HttpError(401, 'Token invalide ou expiré'));
  }
}
