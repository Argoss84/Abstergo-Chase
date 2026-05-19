import Joi from 'joi';

export const createFriendRequestSchema = Joi.object({
  to_user_id: Joi.number().integer().positive().required(),
});

export const blockUserSchema = Joi.object({
  user_id: Joi.number().integer().positive().required(),
});
