import { HttpError } from '../utils/http-error.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route introuvable' });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }

  console.error(error);
  return res.status(500).json({ error: 'Erreur interne du serveur' });
}
