import { HttpError } from '../utils/http-error.js';

export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const { value, error } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return next(new HttpError(400, error.details.map((d) => d.message).join(', ')));
    }

    req[source] = value;
    return next();
  };
}
