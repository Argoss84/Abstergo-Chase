import Joi from 'joi';

export const createGameSchema = Joi.object({
  game_code: Joi.string().trim().uppercase().min(3).max(16).required(),
  host_player_id: Joi.string().trim().min(1).max(128).optional(),
  host_user_id: Joi.number().integer().positive().optional(),
  config_json: Joi.object().optional(),
});

export const updateGameStatusSchema = Joi.object({
  end_reason: Joi.string().trim().max(280).optional(),
  winner_side: Joi.string().trim().max(40).optional(),
});

export const upsertPlayerSchema = Joi.object({
  player_external_id: Joi.string().trim().min(1).max(128).required(),
  display_name_snapshot: Joi.string().trim().min(1).max(64).required(),
  user_id: Joi.number().integer().positive().optional().allow(null),
  role: Joi.string().trim().max(32).optional().allow(null, ''),
  team: Joi.string().trim().max(32).optional().allow(null, ''),
  is_host: Joi.boolean().optional(),
  status: Joi.string().valid('active', 'left', 'disconnected', 'kicked').optional(),
});

export const appendEventsSchema = Joi.object({
  events: Joi.array()
    .items(
      Joi.object({
        event_type: Joi.string().trim().min(1).max(80).required(),
        actor_user_id: Joi.number().integer().positive().optional().allow(null),
        actor_external_id: Joi.string().trim().max(128).optional().allow(null, ''),
        payload_json: Joi.object().optional().allow(null),
        created_at: Joi.date().iso().optional(),
      })
    )
    .min(1)
    .required(),
});

export const finalizeGameSchema = Joi.object({
  winning_side: Joi.string().trim().max(40).optional().allow(null, ''),
  end_reason: Joi.string().trim().max(280).optional().allow(null, ''),
  duration_seconds: Joi.number().integer().min(0).optional(),
  summary_json: Joi.object().optional(),
  player_results: Joi.array()
    .items(
      Joi.object({
        player_external_id: Joi.string().trim().min(1).max(128).required(),
        display_name_snapshot: Joi.string().trim().min(1).max(64).required(),
        user_id: Joi.number().integer().positive().optional().allow(null),
        role: Joi.string().trim().max(32).optional().allow(null, ''),
        team: Joi.string().trim().max(32).optional().allow(null, ''),
        score: Joi.number().integer().optional(),
        kills: Joi.number().integer().optional(),
        deaths: Joi.number().integer().optional(),
        objectives_completed: Joi.number().integer().optional(),
        reward_xp: Joi.number().integer().optional(),
        is_winner: Joi.boolean().optional(),
      })
    )
    .min(1)
    .required(),
});

export const gameCodeParamsSchema = Joi.object({
  gameCode: Joi.string().trim().uppercase().min(3).max(16).required(),
});
