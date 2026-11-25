import { Router, json, static as staticFiles } from 'express';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import Joi from 'joi';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import {
  cookieName, cookieOptions, digest, equalSecrets, readSessionToken,
  sessionLifetimeMs, verifyPassword,
} from './security.js';

const pagination = { page: Joi.number().integer().min(1).max(10000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25) };
const identifier = Joi.object({ id: Joi.number().integer().positive().max(Number.MAX_SAFE_INTEGER).required() });
const reason = Joi.string().trim().min(1).max(280).required();
const freeValue = Joi.alternatives().try(Joi.string().max(160), Joi.number(), Joi.boolean());
const policy = Joi.object({
  feature: Joi.string().valid('advanced_lobby_settings', 'more_hosted_rounds', 'ads_free'),
  free_max: Joi.number().min(0).max(1000000),
  free_values: Joi.array().items(freeValue).min(1).max(100),
}).xor('free_max', 'free_values');
const expectedVersion = Joi.number().integer().min(0).max(2147483646).required();
const settingsSchemas = {
  progression: Joi.object({
    expected_version: expectedVersion,
    values: Joi.object({ win_xp: Joi.number().integer().min(0).max(100000).required() }).required(),
  }),
  hosting: Joi.object({
    expected_version: expectedVersion,
    values: Joi.object({
      free_daily_rounds: Joi.number().integer().min(0).max(10000).allow(null).required(),
      premium_daily_rounds: Joi.number().integer().min(0).max(10000).allow(null).required(),
      premium_settings: Joi.object().pattern(/^[a-z][a-z0-9_]{0,79}$/, policy).required(),
    }).required(),
  }),
};

export function createAdminRouter({ config, repository, services }) {
  const router = Router();
  const publicDirectory = fileURLToPath(new URL('../../../public/admin/', import.meta.url));
  router.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (config.production && !req.secure) return next(new HttpError(400, 'HTTPS requis pour le back-office'));
    if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  router.get('/', (_req, res) => res.sendFile('index.html', { root: publicDirectory }));
  router.use('/assets', staticFiles(publicDirectory, { index: false, redirect: false }));

  router.use('/api', (req, _res, next) => {
    if (!config.enabled) return next(new HttpError(503, 'Compte administrateur à configurer sur le serveur'));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.origin) {
      return next(new HttpError(403, 'Origine de la demande administrateur refusée'));
    }
    next();
  });
  router.use('/api', json({ limit: '32kb', strict: true }));

  router.post('/api/login', validate(Joi.object({
    username: Joi.string().max(80).required(), password: Joi.string().max(256).required(),
  })), asyncHandler(async (req, res) => {
    const attemptKey = digest(req.ip);
    if (!await repository.consumeLoginAttempt(attemptKey)) {
      res.set('Retry-After', '900');
      throw new HttpError(429, 'Trop de tentatives. Réessaie dans 15 minutes.');
    }
    const passwordValid = await verifyPassword(req.body.password, config.passwordHash);
    if (!equalSecrets(req.body.username, config.username) || !passwordValid) {
      throw new HttpError(401, 'Identifiants administrateur incorrects');
    }
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);
    await repository.createSession({
      tokenHash: digest(token), username: config.username,
      credentialsHash: config.credentialsHash, csrfToken, expiresAt,
    }, attemptKey);
    res.cookie(cookieName, token, { ...cookieOptions(config.production), expires: expiresAt });
    res.json({ username: config.username, csrfToken, expiresAt });
  }));

  router.use('/api', asyncHandler(async (req, _res, next) => {
    const token = readSessionToken(req);
    const session = token && await repository.session(digest(token), config.credentialsHash);
    if (!session) throw new HttpError(401, 'Connexion administrateur requise');
    req.admin = { ...session, tokenHash: digest(token) };
    if (!['GET', 'HEAD'].includes(req.method) && !equalSecrets(req.get('x-csrf-token'), session.csrfToken)) {
      throw new HttpError(403, 'La session a changé. Actualise la page.');
    }
    next();
  }));

  router.get('/api/session', (req, res) => {
    res.json({ username: req.admin.username, csrfToken: req.admin.csrfToken, expiresAt: req.admin.expiresAt });
  });
  router.post('/api/logout', asyncHandler(async (req, res) => {
    await repository.deleteSession(req.admin.tokenHash, req.admin.username);
    res.clearCookie(cookieName, cookieOptions(config.production));
    res.sendStatus(204);
  }));
  router.get('/api/overview', asyncHandler(async (_req, res) => {
    const [database, signaling, voice] = await Promise.allSettled([
      repository.overview(), services.signaling(), services.diagnostics('voice'),
    ]);
    if (database.status === 'rejected') throw database.reason;
    const optional = (result) => result.status === 'fulfilled'
      ? { available: true, data: result.value }
      : { available: false, error: result.reason?.status ? result.reason.message : 'Service indisponible' };
    res.json({ ...database.value, signaling: optional(signaling), voice: optional(voice) });
  }));

  router.get('/api/players', validate(Joi.object({
    ...pagination, search: Joi.string().trim().max(100).empty(''),
    status: Joi.string().valid('active', 'suspended', 'deleted').empty(''),
  }), 'query'), asyncHandler(async (req, res) => res.json(await repository.players(req.query))));
  router.get('/api/players/:id', validate(identifier, 'params'),
    asyncHandler(async (req, res) => res.json(await repository.player(req.params.id))));
  router.put('/api/players/:id/status', validate(identifier, 'params'),
    validate(Joi.object({ status: Joi.string().valid('active', 'suspended').required(), reason })),
    asyncHandler(async (req, res) => res.json(await repository.setPlayerStatus(
      req.params.id, req.body.status, req.body.reason, req.admin.username
    ))));
  router.post('/api/players/:id/revoke-sessions', validate(identifier, 'params'), validate(Joi.object({ reason })),
    asyncHandler(async (req, res) => res.json(await repository.revokePlayerSessions(
      req.params.id, req.body.reason, req.admin.username
    ))));

  router.get('/api/games', validate(Joi.object({
    ...pagination, search: Joi.string().trim().uppercase().alphanum().max(16).empty(''),
    status: Joi.string().valid('running', 'ended', 'cancelled').empty(''),
  }), 'query'), asyncHandler(async (req, res) => res.json(await repository.games(req.query))));
  router.get('/api/games/:id', validate(identifier, 'params'),
    validate(Joi.object({ offset: Joi.number().integer().min(0).max(1000000).default(0) }), 'query'),
    asyncHandler(async (req, res) => res.json(await repository.game(req.params.id, req.query.offset))));
  router.get('/api/subscriptions', validate(Joi.object(pagination), 'query'),
    asyncHandler(async (req, res) => res.json(await repository.subscriptions(req.query))));
  router.get('/api/settings', asyncHandler(async (_req, res) => res.json(await repository.settings())));
  router.put('/api/settings/:key', validate(Joi.object({
    key: Joi.string().valid('progression', 'hosting').required(),
  }), 'params'), (req, res, next) => validate(settingsSchemas[req.params.key])(req, res, next), asyncHandler(async (req, res) => {
    res.json(await repository.publishSettings(req.params.key, req.body.expected_version, req.body.values, req.admin.username));
  }));
  router.get('/api/audit', validate(Joi.object(pagination), 'query'),
    asyncHandler(async (req, res) => res.json(await repository.auditLog(req.query))));
  router.get('/api/diagnostics/:section', validate(Joi.object({
    section: Joi.string().valid('errors', 'signatures', 'sessions', 'server', 'voice').required(),
  }), 'params'), validate(Joi.object({
    sessionId: Joi.string().max(128).pattern(/^[\w-]+$/).empty(''),
    limit: Joi.number().integer().min(1).max(100).default(50),
    offset: Joi.number().integer().min(0).max(1000000).default(0),
    environment: Joi.string().pattern(/^[\w-]{1,32}$/).empty(''),
    since: Joi.date().iso().raw(), until: Joi.date().iso().raw(),
  }), 'query'), asyncHandler(async (req, res) => {
    res.json(await services.diagnostics(req.params.section, req.query));
  }));
  router.get('/api/live', asyncHandler(async (_req, res) => res.json(await services.signaling())));
  router.post('/api/notifications', validate(Joi.object({
    gameCode: Joi.string().uppercase().alphanum().length(6).required(),
    title: Joi.string().trim().max(80).required(), message: Joi.string().trim().max(1000).required(),
  })), asyncHandler(async (req, res) => {
    await repository.recordAction(req.admin.username, 'notification_requested', {
      gameCode: req.body.gameCode, title: req.body.title,
    });
    const result = await services.signaling('admin:notifyGame', req.body);
    await repository.recordAction(req.admin.username, 'notification_sent', { gameCode: req.body.gameCode });
    res.json(result);
  }));
  return router;
}
