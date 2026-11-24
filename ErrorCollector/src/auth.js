import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export function createAuthenticator({ issuer, clientId, jwks }) {
  const keySet = jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (authorization = '') => {
    if (!authorization.startsWith('Bearer ')) throw new Error('Authentication required');
    const { payload } = await jwtVerify(authorization.slice(7), keySet, {
      issuer,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'token_use', 'client_id'],
    });
    if (payload.token_use !== 'access' || payload.client_id !== clientId ||
      typeof payload.sub !== 'string' || !payload.sub) {
      throw new Error('Invalid Cognito access token');
    }
    return createHash('sha256').update(`${issuer}:${payload.sub}`).digest('hex');
  };
}

export function isAdmin(authorization, adminToken) {
  if (!authorization?.startsWith('Bearer ')) return false;
  const hash = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(authorization.slice(7)), hash(adminToken));
}
