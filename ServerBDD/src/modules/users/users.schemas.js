import Joi from 'joi';

const username = Joi.string().trim().min(3).max(32).pattern(/^[\p{L}\p{N}_. -]+$/u);
export const syncUserSchema = Joi.object({ username: Joi.string().trim().max(128).optional() });

export const settingsPatch = Joi.object({
  voiceEnabled: Joi.boolean(),
  voiceMode: Joi.string().valid('pushToTalk', 'voiceActivation'),
  voiceThreshold: Joi.number().min(0.05).max(1),
  ttsEnabled: Joi.boolean(),
  preventScreenLock: Joi.boolean(),
  vibrations: Joi.object().pattern(/^[a-zA-Z0-9_]{1,32}$/, Joi.boolean()).max(32),
}).min(1);

export const updateProfileSchema = Joi.object({
  username,
  display_name: Joi.string().trim().min(2).max(40).allow(null, ''),
  avatar_url: Joi.string().uri({ scheme: ['https'] }).max(1024).allow(null, ''),
  bio: Joi.string().trim().max(280).allow(null, ''),
  region: Joi.string().trim().max(40).allow(null, ''),
  preferences_json: settingsPatch,
}).min(1);
