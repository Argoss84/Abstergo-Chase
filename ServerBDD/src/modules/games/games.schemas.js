import Joi from 'joi';

export const scope = Joi.string().pattern(/^[a-zA-Z0-9_-]{1,64}$/);
export const code = Joi.string().trim().uppercase().alphanum().min(3).max(16);
export const uuid = Joi.string().uuid();
export const userId = Joi.number().integer().positive();
const role = Joi.string().valid('AGENT', 'ROGUE');
const status = Joi.string().valid('active', 'left', 'disconnected', 'kicked');

export const checkpoint = Joi.object({
  scope: scope.required(),
  owner_key: uuid.required(),
  revision: Joi.number().integer().positive().required(),
  state: Joi.object().unknown(true).required(),
});

export const rosterPlayer = Joi.object({
  user_id: userId.required(),
  player_external_id: Joi.string().max(128).required(),
  display_name: Joi.string().trim().max(64).required(),
  role: role.required(),
  is_host: Joi.boolean().required(),
  status: status.required(),
});

export const roundStart = Joi.object({
  code: code.required(),
  lobby_key: uuid.required(),
  round_key: uuid.required(),
  host_user_id: userId.required(),
  host_player_id: Joi.string().max(128).required(),
  config: Joi.object().unknown(true).required(),
  players: Joi.array().items(rosterPlayer).min(2).max(100).unique('user_id').required(),
  checkpoint,
});

export const roundEnd = Joi.object({
  winner_side: role.allow(null).required(),
  end_reason: Joi.string().max(255).required(),
  duration_seconds: Joi.number().integer().min(0).max(86400).required(),
  summary: Joi.object().unknown(true).required(),
  runtime_scope: scope.required(),
  runtime_owner: uuid.required(),
  players: Joi.array().items(Joi.object({
    user_id: userId.required(),
    status: status.required(),
    objectives_completed: Joi.number().integer().min(0).max(1000).default(0),
  })).max(100).unique('user_id').required(),
});
