import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

const oauthUrl = 'https://oauth2.googleapis.com/token';
const publisher = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
let authorization;
let authorizing;

export function isPlayConfigured() {
  return Boolean(env.play.clientEmail && env.play.privateKey && env.play.productId && env.play.basePlanId);
}

async function authorize() {
  const key = await importPKCS8(env.play.privateKey, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/androidpublisher' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(env.play.clientEmail)
    .setAudience(oauthUrl)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
  const response = await fetch(oauthUrl, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new HttpError(502, 'Authentification Google Play indisponible');
  const data = await response.json();
  authorization = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

async function request(path, method = 'GET') {
  if (!isPlayConfigured()) throw new HttpError(503, 'Abonnements Google Play à configurer');
  if (!authorization || authorization.expiresAt < Date.now() + 60_000) {
    authorizing ??= authorize().finally(() => { authorizing = null; });
    await authorizing;
  }

  const response = await fetch(publisher + encodeURIComponent(env.play.packageName) + path, {
    method,
    headers: { Authorization: 'Bearer ' + authorization.token, 'Content-Type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 400 || response.status === 404 || response.status === 410) {
    throw new HttpError(422, 'Achat Google Play introuvable ou expiré');
  }
  if (!response.ok) throw new HttpError(502, 'Vérification Google Play indisponible');
  return response.status === 204 ? null : response.json();
}

export function fetchPurchase(token) {
  return request('/purchases/subscriptionsv2/tokens/' + encodeURIComponent(token));
}

export function acknowledgePurchase(productId, token) {
  return request('/purchases/subscriptions/' + encodeURIComponent(productId) +
    '/tokens/' + encodeURIComponent(token) + ':acknowledge', 'POST');
}

export async function verifyPush(req, _res, next) {
  try {
    if (!env.play.pushAudience || !env.play.pushEmail) throw new HttpError(503, 'Notifications Google Play à configurer');
    const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) throw new HttpError(401, 'Authentification Pub/Sub requise');
    const { payload } = await jwtVerify(bearer, googleKeys, {
      algorithms: ['RS256'],
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.play.pushAudience,
    });
    if (payload.email !== env.play.pushEmail || payload.email_verified !== true) {
      throw new HttpError(401, 'Compte de notification Pub/Sub invalide');
    }
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'Notification Pub/Sub invalide'));
  }
}
