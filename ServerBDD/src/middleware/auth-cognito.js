import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { pool, transaction } from '../db/pool.js';
import { HttpError } from '../utils/http-error.js';

const jwks = createRemoteJWKSet(new URL(env.cognito.issuer + '/.well-known/jwks.json'));

export function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function requireAuthForSync(req, _res, next) {
  try {
    const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) throw new HttpError(401, 'Connexion Cognito requise');

    const { payload } = await jwtVerify(bearer, jwks, { issuer: env.cognito.issuer, algorithms: ['RS256'] });
    const tokenFamily = payload.origin_jti ?? payload.jti;
    if (payload.token_use !== 'access' || payload.client_id !== env.cognito.audience ||
        typeof payload.sub !== 'string' || typeof tokenFamily !== 'string' || !Number.isSafeInteger(payload.exp)) {
      throw new HttpError(401, 'Jeton Cognito invalide');
    }
    req.auth = {
      sub: payload.sub,
      issuer: payload.iss,
      identityHash: hash(payload.iss + '\0' + payload.sub),
      sessionHash: hash(payload.iss + '\0' + payload.sub + '\0' + tokenFamily),
      expiresAt: new Date(payload.exp * 1000),
      email: typeof payload.email === 'string' && payload.email_verified === true ? payload.email : null,
      token: bearer,
    };
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'Jeton Cognito invalide ou expiré'));
  }
}

export const requireAuth = [
  requireAuthForSync,
  async (req, _res, next) => {
    try {
      const [[row]] = await pool.query(
        'SELECT u.id, u.public_id, s.expires_at FROM users u JOIN user_active_sessions s ON s.user_id = u.id ' +
        'WHERE u.identity_hash = ? AND u.status = ? AND s.session_hash = ?',
        [req.auth.identityHash, 'active', req.auth.sessionHash]
      );
      if (!row) throw new HttpError(401, 'Session invalidee. Reconnectez-vous.');
      req.auth.userId = row.id;
      req.auth.publicId = row.public_id;
      if (row.expires_at < req.auth.expiresAt) {
        await pool.query(
          'UPDATE user_active_sessions SET expires_at = GREATEST(expires_at, ?) WHERE user_id = ? AND session_hash = ?',
          [req.auth.expiresAt, row.id, req.auth.sessionHash]
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  },
];

export async function createSignalingTicket(auth) {
  const ticket = randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO signaling_tickets (ticket_hash, user_id, session_hash, expires_at) ' +
    'VALUES (?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL 45 SECOND)',
    [hash(ticket), auth.userId, auth.sessionHash]
  );
  return ticket;
}

export async function redeemSignalingTicket(ticket) {
  return transaction(async (db) => {
    const ticketHash = hash(ticket);
    const [[entry]] = await db.query(
      'SELECT user_id, session_hash FROM signaling_tickets WHERE ticket_hash = ? AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE',
      [ticketHash]
    );
    if (!entry) throw new HttpError(401, 'Ticket de jeu expiré');
    const [[identity]] = await db.query(
      'SELECT u.id AS user_id, u.cognito_sub, u.public_id, u.username, p.display_name, s.session_hash FROM users u ' +
      'JOIN user_active_sessions s ON s.user_id = u.id LEFT JOIN player_profiles p ON p.user_id = u.id ' +
      'WHERE u.id = ? AND u.status = ? AND s.session_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)',
      [entry.user_id, 'active', entry.session_hash]
    );
    if (!identity) throw new HttpError(401, 'Session de jeu expirée');
    await db.query('DELETE FROM signaling_tickets WHERE ticket_hash = ?', [ticketHash]);
    return identity;
  });
}
