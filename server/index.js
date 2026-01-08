import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const PORT = process.env.SIGNALING_PORT || 5174;

const server = createServer();
const wss = new WebSocketServer({ server });

const lobbies = new Map();
const clients = new Map();
const socketsById = new Map();

// Helper pour les logs horodatés
const log = (...args) => {
  const timestamp = new Date().toLocaleString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  console.log(`[${timestamp}]`, ...args);
};

const generateCode = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

const send = (socket, message) => {
  if (socket && socket.readyState === socket.OPEN) {
    const clientInfo = clients.get(socket);
    const recipientId = clientInfo?.clientId || 'unknown';
    log(`[MESSAGE ENVOYÉ] À: ${recipientId}, Type: ${message.type}`);
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
  
  log(`[CONNEXION] Nouveau client connecté: ${clientId}`);

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      send(socket, { type: 'error', payload: { message: 'Message JSON invalide.' } });
      return;
    }

    const { type, payload } = message;
    log(`[MESSAGE REÇU] ClientId: ${clientId}, Type: ${type}, Payload:`, payload);

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

      log(`[LOBBY CRÉÉ] Code: ${code}, Host: ${clientId}, Nom: ${payload?.playerName || 'Host'}`);

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
        log(`[ERREUR LOBBY] Client ${clientId} tente de rejoindre un lobby inexistant: ${code}`);
        send(socket, { type: 'lobby:error', payload: { message: 'Lobby introuvable.' } });
        return;
      }

      // Vérifier si le joueur est déjà dans le lobby
      if (lobby.players.has(clientId)) {
        log(`[AVERTISSEMENT] Client ${clientId} tente de rejoindre le lobby ${code} une seconde fois - ignoré`);
        send(socket, {
          type: 'lobby:joined',
          payload: {
            code,
            playerId: clientId,
            hostId: lobby.hostId,
            lobby: getLobbySnapshot(lobby)
          }
        });
        return;
      }

      lobby.players.set(clientId, { id: clientId, name: payload?.playerName || 'Joueur', isHost: false });
      clients.get(socket).lobbyCode = code;

      log(`[LOBBY REJOINT] Code: ${code}, Joueur: ${clientId}, Nom: ${payload?.playerName || 'Joueur'}`);

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
        log(`[ERREUR WEBRTC] Signal de ${clientId} vers ${targetId} échoué: destinataire introuvable`);
        send(socket, {
          type: 'lobby:error',
          payload: { message: 'Destinataire WebRTC introuvable.' }
        });
        return;
      }

      log(`[SIGNAL WEBRTC] De: ${clientId}, Vers: ${targetId}, Type signal: ${payload?.signal?.type || 'unknown'}`);
      
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

    log(`[DÉCONNEXION] Client déconnecté: ${clientInfo.clientId}`);
    
    const { lobbyCode } = clientInfo;
    if (lobbyCode && lobbies.has(lobbyCode)) {
      const lobby = lobbies.get(lobbyCode);
      lobby.players.delete(clientId);

      if (lobby.hostId === clientId) {
        log(`[LOBBY FERMÉ] Code: ${lobbyCode}, Host déconnecté: ${clientId}`);
        lobbies.delete(lobbyCode);
        lobby.players.forEach((player) => {
          const playerSocket = socketsById.get(player.id);
          send(playerSocket, { type: 'lobby:closed', payload: { code: lobbyCode } });
        });
      } else {
        log(`[JOUEUR PARTI] Lobby: ${lobbyCode}, Joueur: ${clientId}`);
        const hostSocket = socketsById.get(lobby.hostId);
        send(hostSocket, { type: 'lobby:peer-left', payload: { playerId: clientId } });
      }
    }

    clients.delete(socket);
    socketsById.delete(clientId);
  });
});

server.listen(PORT, () => {
  log('========================================');
  log(`🚀 Serveur de signalisation WebRTC démarré`);
  log(`📡 Port: ${PORT}`);
  log(`📊 Logs des signaux activés`);
  log('========================================');
});
