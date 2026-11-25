import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const passwordPattern = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
export const cookieName = 'bvp_admin_session';
export const sessionLifetimeMs = 8 * 60 * 60 * 1000;
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export function equalSecrets(left, right) {
  return typeof left === 'string' && typeof right === 'string' &&
    timingSafeEqual(Buffer.from(digest(left), 'hex'), Buffer.from(digest(right), 'hex'));
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 256) {
    throw new Error('Le mot de passe administrateur doit contenir entre 14 et 256 caractères.');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const parts = passwordPattern.exec(storedHash ?? '');
  if (!parts || typeof password !== 'string' || password.length > 256) return false;
  const key = await deriveKey(password, parts[1], 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(key, Buffer.from(parts[2], 'hex'));
}

function serviceUrl(value, production, label) {
  if (!value) return null;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !['https:', 'http:'].includes(url.protocol) || (production && url.protocol !== 'https:')) {
    throw new Error('Configuration administrateur invalide pour ' + label);
  }
  return url.origin;
}

export function adminConfig(values = process.env) {
  const production = values.NODE_ENV === 'production';
  const username = values.ADMIN_USERNAME ?? '';
  const passwordHash = values.ADMIN_PASSWORD_HASH ?? '';
  const origin = serviceUrl(values.ADMIN_ORIGIN, production, 'ADMIN_ORIGIN');
  const enabled = Boolean(username && passwordHash && origin);
  if ((username || passwordHash || origin) && !enabled) {
    throw new Error('ADMIN_USERNAME, ADMIN_PASSWORD_HASH et ADMIN_ORIGIN doivent être renseignés ensemble.');
  }
  if (enabled && (!/^[\w.@-]{1,80}$/.test(username) || !passwordPattern.test(passwordHash))) {
    throw new Error('Identifiant ou empreinte du mot de passe administrateur invalide.');
  }
  return {
    enabled, production, username, passwordHash, origin,
    credentialsHash: digest(username + '\0' + passwordHash),
    signalingUrl: serviceUrl(values.ADMIN_SIGNALING_URL, production, 'ADMIN_SIGNALING_URL'),
    signalingToken: values.SIGNALING_ADMIN_TOKEN ?? '',
    socketPath: values.SOCKET_IO_PATH ?? '/socket.io',
    collectorUrl: serviceUrl(values.ADMIN_DIAGNOSTICS_URL, production, 'ADMIN_DIAGNOSTICS_URL'),
    collectorToken: values.ERROR_ADMIN_TOKEN ?? '',
  };
}

export function readSessionToken(req) {
  const cookie = (req.headers.cookie ?? '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(cookieName + '='));
  const token = cookie?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token ?? '') ? token : null;
}

export function cookieOptions(production) {
  return { httpOnly: true, secure: production, sameSite: 'strict', path: '/admin' };
}
