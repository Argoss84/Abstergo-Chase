import { Router } from 'express';
import Joi from 'joi';
import { pool } from '../../db/pool.js';
import { requireAuth, redeemSignalingTicket } from '../../middleware/auth-cognito.js';
import { requireAdmin, requireSignaling } from '../../middleware/auth-service.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { getProgression } from '../progression/progression.repository.js';
import {
  acquireRuntime, appendGameEvent, completeRound, gameByCode, gameDetails, getGameEvents, getHistory,
  reserveLobby, saveRuntime, startRound,
} from './games.repository.js';
import { checkpoint, code, roundEnd, roundStart, scope, userId, uuid } from './games.schemas.js';

export const gamesRouter = Router();
gamesRouter.use('/internal', requireSignaling);

gamesRouter.post('/internal/ticket', validate(Joi.object({
  ticket: Joi.string().hex().length(64).required(),
})), asyncHandler(async (req, res) => {
  res.json(await redeemSignalingTicket(req.body.ticket));
}));

gamesRouter.post('/internal/sessions', validate(Joi.object({
  sessions: Joi.array().items(Joi.object({
    user_id: userId.required(),
    session_hash: Joi.string().hex().length(64).required(),
  })).min(1).max(200).required(),
})), asyncHandler(async (req, res) => {
  const ids = [...new Set(req.body.sessions.map((entry) => entry.user_id))];
  const [rows] = await pool.query(
    "SELECT s.user_id, s.session_hash FROM user_active_sessions s JOIN users u ON u.id = s.user_id " +
    "WHERE s.user_id IN (?) AND s.expires_at > UTC_TIMESTAMP(3) AND u.status = 'active'",
    [ids]
  );
  const active = new Map(rows.map((row) => [row.user_id, row.session_hash]));
  res.json({ active: req.body.sessions.map((entry) => active.get(entry.user_id) === entry.session_hash) });
}));

gamesRouter.post('/internal/runtime/acquire', validate(Joi.object({ scope: scope.required() })), asyncHandler(async (req, res) => {
  res.json(await acquireRuntime(req.body.scope));
}));

gamesRouter.put('/internal/runtime', validate(checkpoint), asyncHandler(async (req, res) => {
  await saveRuntime(pool, req.body);
  res.sendStatus(204);
}));

gamesRouter.post('/internal/lobbies', validate(Joi.object({ code: code.required(), lobby_key: uuid.required() })),
  asyncHandler(async (req, res) => {
    await reserveLobby(req.body);
    res.sendStatus(204);
  })
);

gamesRouter.post('/internal/rounds/start', validate(roundStart), asyncHandler(async (req, res) => {
  res.json(await startRound(req.body));
}));

const roundParams = Joi.object({ round_key: uuid.required() });
gamesRouter.post('/internal/rounds/:round_key/end', validate(roundParams, 'params'), validate(roundEnd),
  asyncHandler(async (req, res) => {
    res.json(await completeRound(req.params.round_key, req.body));
  })
);

gamesRouter.post('/internal/rounds/:round_key/events', validate(roundParams, 'params'), validate(Joi.object({
  event_key: Joi.string().max(96).required(),
  event_type: Joi.string().max(80).required(),
  actor_user_id: userId.allow(null),
  payload: Joi.object().unknown(true),
})), asyncHandler(async (req, res) => {
  const [[game]] = await pool.query('SELECT id FROM games WHERE round_key = ?', [req.params.round_key]);
  if (!game) return res.sendStatus(404);
  await appendGameEvent({
    gameId: game.id, eventKey: req.body.event_key, eventType: req.body.event_type,
    actorUserId: req.body.actor_user_id, payloadJson: req.body.payload,
  });
  return res.sendStatus(204);
}));

gamesRouter.get('/players/me/history', requireAuth, validate(Joi.object({
  before: Joi.number().integer().positive(),
  limit: Joi.number().integer().min(1).max(50).default(20),
}), 'query'), asyncHandler(async (req, res) => {
  const games = await getHistory(req.auth.userId, req.query.before, req.query.limit);
  res.json({
    stats: await getProgression(req.auth.userId),
    games,
    next_before: games.length === req.query.limit ? games.at(-1).id : null,
  });
}));

gamesRouter.get('/games', requireAdmin, validate(Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(30),
}), 'query'), asyncHandler(async (req, res) => {
  const [games] = await pool.query(
    'SELECT g.id, g.round_key, g.round_number, l.code, g.status, g.winner_side, g.started_at, g.ended_at ' +
    'FROM games g JOIN lobbies l ON l.id = g.lobby_id ORDER BY g.id DESC LIMIT ?',
    [req.query.limit]
  );
  res.json({ games });
}));

const gameCode = Joi.object({ code: code.required() });
gamesRouter.get('/games/:code', requireAdmin, validate(gameCode, 'params'), asyncHandler(async (req, res) => {
  res.json(await gameDetails(await gameByCode(req.params.code)));
}));

gamesRouter.get('/games/:code/events', requireAdmin, validate(gameCode, 'params'), validate(Joi.object({
  limit: Joi.number().integer().min(1).max(500).default(200),
  offset: Joi.number().integer().min(0).default(0),
}), 'query'), asyncHandler(async (req, res) => {
  const game = await gameByCode(req.params.code);
  res.json({ events: await getGameEvents(game.id, req.query.limit, req.query.offset) });
}));

gamesRouter.get('/games/:code/results', requireAdmin, validate(gameCode, 'params'), asyncHandler(async (req, res) => {
  const { result, players } = await gameDetails(await gameByCode(req.params.code));
  res.json({ result, player_results: players });
}));

gamesRouter.get('/game-replay/:code', requireAdmin, validate(gameCode, 'params'), asyncHandler(async (req, res) => {
  const game = await gameByCode(req.params.code);
  res.json({ ...await gameDetails(game), events: await getGameEvents(game.id, 500) });
}));
