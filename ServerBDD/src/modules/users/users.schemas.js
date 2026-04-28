import Joi from 'joi';

export const syncUserSchema = Joi.object({
  username: Joi.string().trim().min(3).max(32).optional(),
});

export const updateProfileSchema = Joi.object({
  display_name: Joi.string().trim().min(2).max(40).optional(),
  avatar_url: Joi.string().uri().optional().allow(null, ''),
  bio: Joi.string().trim().max(280).optional().allow(''),
  region: Joi.string().trim().min(2).max(40).optional().allow(''),
  preferences_json: Joi.object().optional(),
}).min(1);
