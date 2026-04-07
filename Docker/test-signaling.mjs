#!/usr/bin/env node
/**
 * Test de connexion Socket.IO vers le signaling (ex. conteneur Docker sur :5174).
 *
 *   cd Docker && npm install && node test-signaling.mjs
 *   node test-signaling.mjs --url=http://127.0.0.1:5174
 *   SIGNALING_TEST_URL=http://localhost:5174 node test-signaling.mjs
 */

import { io } from 'socket.io-client';

const argvUrl = process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length);
const url = argvUrl || process.env.SIGNALING_TEST_URL || 'http://localhost:5174';
const socketPath = process.env.SOCKET_IO_PATH || '/socket.io';
const timeoutMs = Number(process.env.SIGNALING_TEST_TIMEOUT_MS || 15000);

console.log(`Connexion vers ${url} (path: ${socketPath}, transport: websocket uniquement)…`);

const socket = io(url, {
  path: socketPath,
  transports: ['websocket'],
  reconnection: false,
  timeout: Math.min(timeoutMs, 20000)
});

const t = setTimeout(() => {
  console.error(`Échec : pas de connexion après ${timeoutMs} ms.`);
  socket.close();
  process.exit(1);
}, timeoutMs);

socket.on('connect', () => {
  clearTimeout(t);
  console.log('OK — connecté, id socket.io :', socket.id);
  socket.disconnect();
  process.exit(0);
});

socket.on('connect_error', (err) => {
  clearTimeout(t);
  console.error('Erreur de connexion :', err.message);
  process.exit(1);
});
