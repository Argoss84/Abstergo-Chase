import { io } from 'socket.io-client';
import { HttpError } from '../../utils/http-error.js';

const diagnosticPaths = {
  errors: '/api/errors', signatures: '/api/error-signatures',
  sessions: '/api/error-sessions', server: '/api/diagnostics/server',
  voice: '/api/voice-routes/summary',
};

export class AdminServices {
  constructor(config, fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  async signaling(event = 'admin:getStats', payload) {
    const { signalingUrl, signalingToken, socketPath } = this.config;
    if (!signalingUrl || !signalingToken) throw new HttpError(503, 'Signalisation administrateur à configurer');
    const socket = io(signalingUrl, {
      path: socketPath, transports: ['websocket'], auth: { adminToken: signalingToken },
      forceNew: true, multiplex: false, autoConnect: false, reconnection: false,
    });
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new HttpError(503, 'La signalisation ne répond pas')), 6000);
        const finish = (error, result) => {
          clearTimeout(timer);
          if (error) reject(error); else resolve(result);
        };
        socket.once('connect_error', () => finish(new HttpError(503, 'Connexion à la signalisation indisponible')));
        socket.once('connect', () => {
          const acknowledge = (result) => {
            if (result?.ok === false || result?.success === false) {
              finish(new HttpError(503, 'La signalisation a refusé la demande'));
            } else finish(null, result);
          };
          if (payload === undefined) socket.emit(event, acknowledge);
          else socket.emit(event, payload, acknowledge);
        });
        socket.connect();
      });
    } finally {
      socket.disconnect();
    }
  }

  async diagnostics(section, query = {}) {
    const { collectorUrl, collectorToken } = this.config;
    if (!collectorUrl || !collectorToken) throw new HttpError(503, 'Collecteur de diagnostics à configurer');
    const path = diagnosticPaths[section];
    if (!path) throw new HttpError(404, 'Vue de diagnostic introuvable');
    const url = new URL(path, collectorUrl);
    const allowed = section === 'voice' ? ['environment', 'since', 'until'] :
      section === 'errors' ? ['sessionId', 'limit', 'offset'] : [];
    for (const key of allowed) if (query[key] != null && query[key] !== '') url.searchParams.set(key, query[key]);
    try {
      const response = await this.fetcher(url, {
        headers: { Authorization: 'Bearer ' + collectorToken }, redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error('Collector rejected request');
      return await response.json();
    } catch {
      throw new HttpError(503, 'Collecteur de diagnostics indisponible');
    }
  }
}
