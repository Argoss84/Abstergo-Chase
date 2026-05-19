import Joi from 'joi';

export const updateProgressionSchema = Joi.object({
  xp_delta: Joi.number().integer().min(-100000).max(100000).default(0),
  wins_delta: Joi.number().integer().min(-1000).max(1000).default(0),
  losses_delta: Joi.number().integer().min(-1000).max(1000).default(0),
}).or('xp_delta', 'wins_delta', 'losses_delta');
