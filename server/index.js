import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const PORT = process.env.SIGNALING_PORT || 5174;

const server = createServer();
const wss = new WebSocketServer({ server });

const lobbies = new Map();
const clients = new Map();
const socketsById = new Map();

const generateCode = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

const send = (socket, message) => {
  if (socket && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

const getLobbySnapshot = (lobby) => ({
  code: lobby.code,
  hostId: lobby.hostId,
  players: Array.from(lobby.players.values()).map(({ id, name, isHost }) => ({
    id,
    name,
    isHost
  }))
});

wss.on('connection', (socket) => {
  const clientId = randomUUID();
  clients.set(socket, { clientId, lobbyCode: null });
  socketsById.set(clientId, socket);

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      send(socket, { type: 'error', payload: { message: 'Message JSON invalide.' } });
      return;
    }

    const { type, payload } = message;

    if (type === 'lobby:create') {
      let code = generateCode();
      while (lobbies.has(code)) {
        code = generateCode();
      }

      const lobby = {
        code,
        hostId: clientId,
        players: new Map()
      };

      lobby.players.set(clientId, { id: clientId, name: payload?.playerName || 'Host', isHost: true });
      lobbies.set(code, lobby);
      clients.get(socket).lobbyCode = code;

      send(socket, {
        type: 'lobby:created',
        payload: {
          code,
          playerId: clientId,
          hostId: clientId,
          lobby: getLobbySnapshot(lobby)
        }
      });
      return;
    }

    if (type === 'lobby:join') {
      const code = payload?.code?.toUpperCase();
      const lobby = lobbies.get(code);
      if (!lobby) {
        send(socket, { type: 'lobby:error', payload: { message: 'Lobby introuvable.' } });
        return;
      }

      lobby.players.set(clientId, { id: clientId, name: payload?.playerName || 'Joueur', isHost: false });
      clients.get(socket).lobbyCode = code;

      send(socket, {
        type: 'lobby:joined',
        payload: {
          code,
          playerId: clientId,
          hostId: lobby.hostId,
          lobby: getLobbySnapshot(lobby)
        }
      });

      const hostSocket = socketsById.get(lobby.hostId);
      send(hostSocket, {
        type: 'lobby:peer-joined',
        payload: {
          playerId: clientId,
          playerName: payload?.playerName || 'Joueur'
        }
      });
      return;
    }

    if (type === 'webrtc:signal') {
      const targetId = payload?.targetId;
      const targetSocket = socketsById.get(targetId);
      if (!targetSocket) {
        send(socket, {
          type: 'lobby:error',
          payload: { message: 'Destinataire WebRTC introuvable.' }
        });
        return;
      }

      send(targetSocket, {
        type: 'webrtc:signal',
        payload: {
          fromId: clientId,
          signal: payload?.signal
        }
      });
      return;
    }
  });

  socket.on('close', () => {
    const clientInfo = clients.get(socket);
    if (!clientInfo) return;

    const { lobbyCode } = clientInfo;
    if (lobbyCode && lobbies.has(lobbyCode)) {
      const lobby = lobbies.get(lobbyCode);
      lobby.players.delete(clientId);

      if (lobby.hostId === clientId) {
        lobbies.delete(lobbyCode);
        lobby.players.forEach((player) => {
          const playerSocket = socketsById.get(player.id);
          send(playerSocket, { type: 'lobby:closed', payload: { code: lobbyCode } });
        });
      } else {
        const hostSocket = socketsById.get(lobby.hostId);
        send(hostSocket, { type: 'lobby:peer-left', payload: { playerId: clientId } });
      }
    }

    clients.delete(socket);
    socketsById.delete(clientId);
  });
});

server.listen(PORT, () => {
  console.log(`WebRTC signaling server listening on :${PORT}`);
});
