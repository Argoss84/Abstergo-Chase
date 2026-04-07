import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { io as ioClient } from 'socket.io-client';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8090);
const SIGNALING_URL = process.env.SIGNALING_URL || 'http://localhost:5174';
const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || '/socket.io';
const ACK_MS = Number(process.env.SIGNALING_ACK_TIMEOUT_MS || 10000);

const app = express();
app.use(express.json({ limit: '512kb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

const socket = ioClient(SIGNALING_URL, {
  path: SOCKET_IO_PATH,
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

const log = (...a) => console.log('[monitor]', ...a);

socket.on('connect', () => log('connecté au signaling', SIGNALING_URL, 'id=', socket.id));
socket.on('disconnect', (r) => log('déconnecté du signaling', r));
socket.on('connect_error', (e) => log('connect_error', e.message));

function emitAckTimeout(event, payload, timeoutMs = ACK_MS) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error('Socket non connecté au signaling (vérifiez SIGNALING_URL).'));
      return;
    }
    const t = setTimeout(() => reject(new Error(`Timeout ${event} (${timeoutMs} ms)`)), timeoutMs);
    const done = (result) => {
      clearTimeout(t);
      resolve(result);
    };
    if (payload === undefined) {
      socket.emit(event, done);
    } else {
      socket.emit(event, payload, done);
    }
  });
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    signalingUrl: SIGNALING_URL,
    socketPath: SOCKET_IO_PATH,
    signalingConnected: socket.connected,
    socketId: socket.id || null
  });
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await emitAckTimeout('admin:getStats');
    res.json(stats);
  } catch (e) {
    res.status(503).json({
      error: e.message,
      signalingConnected: socket.connected,
      signalingUrl: SIGNALING_URL
    });
  }
});

app.get('/api/stats/game/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  try {
    const result = await emitAckTimeout('admin:getGame', { code });
    if (!result?.ok) {
      res.status(404).json({ error: result?.error || 'Game not found', code });
      return;
    }
    res.json(result.game);
  } catch (e) {
    res.status(503).json({ error: e.message, code });
  }
});

app.post('/api/notify/player', async (req, res) => {
  try {
    const { clientId, message, title } = req.body || {};
    const result = await emitAckTimeout('admin:notifyPlayer', {
      clientId,
      message,
      title
    });
    if (!result?.success) {
      const err = String(result?.error || '');
      const st = /introuvable|déconnecté/i.test(err) ? 404 : 400;
      res.status(st).json(result);
      return;
    }
    res.json(result);
  } catch (e) {
    res.status(503).json({ success: false, error: e.message });
  }
});

app.post('/api/notify/game', async (req, res) => {
  try {
    const { gameCode, message, title } = req.body || {};
    const result = await emitAckTimeout('admin:notifyGame', {
      gameCode,
      message,
      title
    });
    if (!result?.success) {
      const err = String(result?.error || '');
      const st = /introuvable/i.test(err) ? 404 : 400;
      res.status(st).json(result);
      return;
    }
    res.json(result);
  } catch (e) {
    res.status(503).json({ success: false, error: e.message });
  }
});

app.use(express.static(join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  log(`HTTP monitoring sur http://0.0.0.0:${PORT} → signaling ${SIGNALING_URL}`);
});
