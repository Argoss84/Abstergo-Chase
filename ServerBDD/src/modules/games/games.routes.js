import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import {
  appendEvents,
  createGame,
  endGame,
  fetchGame,
  fetchRecentGames,
  finalizeGameWithResults,
  startGame,
  upsertGameParticipant,
} from './games.service.js';
import {
  appendEventsSchema,
  createGameSchema,
  finalizeGameSchema,
  gameCodeParamsSchema,
  updateGameStatusSchema,
  upsertPlayerSchema,
} from './games.schemas.js';

const listEventsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).optional(),
  offset: Joi.number().integer().min(0).optional(),
});
const listGamesQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(200).optional(),
});

export const gamesRouter = Router();

gamesRouter.post(
  '/games',
  validate(createGameSchema),
  asyncHandler(async (req, res) => {
    const game = await createGame(req.body);
    res.status(201).json({ game });
  })
);

gamesRouter.get(
  '/games',
  validate(listGamesQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit ?? 30);
    const games = await fetchRecentGames(limit);
    res.json({ games });
  })
);

gamesRouter.get(
  '/games/:gameCode',
  validate(gameCodeParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const details = await fetchGame(req.params.gameCode);
    res.json(details);
  })
);

gamesRouter.post(
  '/games/:gameCode/start',
  validate(gameCodeParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const game = await startGame(req.params.gameCode);
    res.json({ game });
  })
);

gamesRouter.post(
  '/games/:gameCode/end',
  validate(gameCodeParamsSchema, 'params'),
  validate(updateGameStatusSchema),
  asyncHandler(async (req, res) => {
    const game = await endGame(req.params.gameCode, req.body);
    res.json({ game });
  })
);

gamesRouter.post(
  '/games/:gameCode/players',
  validate(gameCodeParamsSchema, 'params'),
  validate(upsertPlayerSchema),
  asyncHandler(async (req, res) => {
    const player = await upsertGameParticipant(req.params.gameCode, req.body);
    res.status(201).json({ player });
  })
);

gamesRouter.post(
  '/games/:gameCode/events',
  validate(gameCodeParamsSchema, 'params'),
  validate(appendEventsSchema),
  asyncHandler(async (req, res) => {
    const events = await appendEvents(req.params.gameCode, req.body.events);
    res.status(201).json({ events });
  })
);

gamesRouter.get(
  '/games/:gameCode/events',
  validate(gameCodeParamsSchema, 'params'),
  validate(listEventsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const details = await fetchGame(req.params.gameCode);
    const offset = Number(req.query.offset ?? 0);
    const limit = Number(req.query.limit ?? 200);
    res.json({
      events: details.events.slice(offset, offset + limit),
    });
  })
);

gamesRouter.post(
  '/games/:gameCode/results',
  validate(gameCodeParamsSchema, 'params'),
  validate(finalizeGameSchema),
  asyncHandler(async (req, res) => {
    const result = await finalizeGameWithResults(req.params.gameCode, req.body);
    res.status(201).json(result);
  })
);

gamesRouter.get(
  '/games/:gameCode/results',
  validate(gameCodeParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const details = await fetchGame(req.params.gameCode);
    res.json({
      game: details.game,
      result: details.result,
      player_results: details.playerResults,
    });
  })
);

// Compatibility endpoints used by realtime signaling service.
gamesRouter.post(
  '/game-sessions',
  asyncHandler(async (req, res) => {
    const game = await createGame({
      game_code: req.body.game_code,
      config_json: req.body.config_json ?? null,
      host_player_id: null,
      host_user_id: null,
    });

    if (req.body.started_at != null) {
      await startGame(req.body.game_code);
    }
    if (req.body.ended_at != null || req.body.winner_type != null) {
      await endGame(req.body.game_code, {
        winner_side: req.body.winner_type ?? null,
        end_reason: 'legacy-session-end',
      });
    }
    res.status(200).json({ success: true, game });
  })
);

gamesRouter.post(
  '/game-replay/snapshot',
  asyncHandler(async (req, res) => {
    await createGame({
      game_code: req.body.game_code,
      config_json: null,
    });
    const events = await appendEvents(req.body.game_code, [
      {
        event_type: 'game:snapshot',
        payload_json: {
          snapshot_timestamp: req.body.snapshot_timestamp ?? new Date().toISOString(),
          remaining_time_seconds: req.body.remaining_time_seconds ?? null,
          game_phase: req.body.game_phase ?? null,
          players_json: req.body.players_json ?? [],
          props_json: req.body.props_json ?? [],
        },
      },
    ]);
    res.status(201).json({ success: true, event_id: events[0].id });
  })
);

gamesRouter.get(
  '/game-replay/:gameCode',
  validate(gameCodeParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const details = await fetchGame(req.params.gameCode);
    const snapshots = details.events
      .filter((event) => event.event_type === 'game:snapshot')
      .map((event) => ({
        id: event.id,
        ...event.payload_json,
      }));
    res.json({
      session: details.game,
      snapshots,
    });
  })
);
