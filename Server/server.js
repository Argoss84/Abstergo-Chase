import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

// Charger les variables d'environnement depuis le fichier .env
dotenv.config();

const PORT = process.env.SIGNALING_PORT || 5174;
const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || '/socket.io';
const SIGNALING_VERSION = process.env.SIGNALING_VERSION || '2026.04.10';
const bddDisabled =
  process.env.DISABLE_BDD === '1' || /^true$/i.test(process.env.DISABLE_BDD || '');
const BDD_URL = bddDisabled ? null : (process.env.BDD_URL || 'http://localhost:5175');

// Helper : persister vers ServerBDD (replay)
const persistToBdd = async (path, method, body) => {
  if (!BDD_URL) return;
  try {
    const res = await fetch(`${BDD_URL}${path}`, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      log(`[BDD] ${method} ${path} erreur: ${res.status}`);
    }
  } catch (err) {
    log(`[BDD] Erreur ${path}:`, err.message);
  }
};

const formatRemainingTime = (seconds) => {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return 'n/a';
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const getRemainingTimeSeconds = (game) => {
  if (!game || typeof game.remainingTimeSeconds !== 'number') {
    return null;
  }
  // Ne décrémenter en temps réel que si le host a démarré le décompte (started + countdown_started).
  // Sinon afficher la valeur exacte du host (ex. durée avant le début de partie).
  if (!game.remainingTimeCountdownActive) {
    return game.remainingTimeSeconds;
  }
  const updatedAt = typeof game.remainingTimeUpdatedAt === 'number'
    ? game.remainingTimeUpdatedAt
    : Date.now();
  const elapsedSeconds = Math.floor((Date.now() - updatedAt) / 1000);
  return Math.max(game.remainingTimeSeconds - elapsedSeconds, 0);
};

// Fonction pour obtenir les statistiques du serveur
const getServerStats = () => ({
  connectedClients: clients.size,
  activeLobbies: lobbies.size,
  activeGames: games.size,
  totalSocketMessages,
  clients: Array.from(clients.entries()).map(([socketId, info]) => {
    const socket = io.sockets.sockets.get(socketId);
    return {
      clientId: info.clientId,
      lobbyCode: info.lobbyCode || 'Aucun',
      gameCode: info.gameCode || 'Aucun',
      connected: Boolean(socket?.connected)
    };
  }),
  lobbies: Array.from(lobbies.entries()).map(([code, lobby]) => {
    const hostDisconnected = disconnectedHosts.has(code);
    const hostAway = awayHosts.has(code);
    const hostInfo = hostDisconnected ? disconnectedHosts.get(code) : null;
    const awayInfo = hostAway ? awayHosts.get(code) : null;
    return {
      code,
      hostId: lobby.hostId,
      playerCount: lobby.players.size,
      socketMessageCount: lobbySocketMessageCounts.get(code) || 0,
      players: Array.from(lobby.players.values()).map(player => {
        const socket = socketsById.get(player.id);
        return {
          ...player,
          socketConnected: Boolean(socket?.connected),
          status: player.status || 'active' // Inclure le statut du joueur
        };
      }),
      hostDisconnected,
      hostAway,
      reconnectionTimeout: hostInfo ? Math.ceil((5 * 60 * 1000 - (Date.now() - hostInfo.disconnectedAt)) / 1000) : null,
      awayTimeout: awayInfo ? Math.ceil((2 * 60 * 1000 - (Date.now() - awayInfo.awayAt)) / 1000) : null
    };
  }),
  games: Array.from(games.entries()).map(([code, game]) => ({
    code,
    hostId: game.hostId,
    playerCount: game.players.size,
    socketMessageCount: gameSocketMessageCounts.get(code) || 0,
    remainingTimeSeconds: getRemainingTimeSeconds(game),
    players: Array.from(game.players.values()).map(player => {
      const socket = socketsById.get(player.id);
      return {
        ...player,
        socketConnected: Boolean(socket?.connected),
        status: player.status || 'active'
      };
    })
  })),
  serverInfo: {
    port: PORT,
    nodeVersion: process.version,
    platform: process.platform,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  },
  logs: logs.slice(-50).reverse() // 50 derniers logs, plus récent en premier
});

// HTTP minimal : handshake Engine.IO / Socket.IO uniquement sur SOCKET_IO_PATH
const server = createServer((req, res) => {
  const url = req.url || '';
  if (
    url === SOCKET_IO_PATH ||
    url.startsWith(`${SOCKET_IO_PATH}/`) ||
    url.startsWith(`${SOCKET_IO_PATH}?`)
  ) {
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});


const io = new SocketIOServer(server, {
  path: SOCKET_IO_PATH,
  transports: ['websocket'],
  perMessageDeflate: false,
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const lobbies = new Map();
const games = new Map();
const clients = new Map();
const socketsById = new Map();
const disconnectedHosts = new Map(); // Stocke temporairement les lobbies dont le host s'est déconnecté
const disconnectedGameHosts = new Map(); // Stocke temporairement les games dont le host s'est déconnecté
const awayHosts = new Map(); // Stocke les lobbies dont le host est absent (away)
const lobbySocketMessageCounts = new Map();
const gameSocketMessageCounts = new Map();
let totalSocketMessages = 0;

// Stockage des logs en mémoire (derniers 100 logs)
const logs = [];
const MAX_LOGS = 100;

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
  const logMessage = `[${timestamp}] ${args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ')}`;
  
  console.log(`[${timestamp}]`, ...args);
  
  // Stocker le log
  logs.push({
    timestamp: new Date().toISOString(),
    message: logMessage
  });
  
  // Garder seulement les MAX_LOGS derniers
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
};

const generateCode = () =>
  Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

const incrementTotalSocketMessages = () => {
  totalSocketMessages += 1;
};

const incrementLobbySocketMessages = (lobbyCode) => {
  if (!lobbyCode) return;
  const current = lobbySocketMessageCounts.get(lobbyCode) || 0;
  lobbySocketMessageCounts.set(lobbyCode, current + 1);
};

const incrementGameSocketMessages = (gameCode) => {
  if (!gameCode) return;
  const current = gameSocketMessageCounts.get(gameCode) || 0;
  gameSocketMessageCounts.set(gameCode, current + 1);
};

const getLobbyCodeFromMessage = (type, payload, clientInfo) => {
  const isLobbyType =
    type?.startsWith('lobby:') ||
    type === 'webrtc:signal' ||
    type === 'action:relay' ||
    type === 'state:sync' ||
    type === 'player:status-update';

  if (!isLobbyType) return null;

  if (type === 'lobby:join' || type === 'lobby:rejoin-host') {
    return payload?.code?.toUpperCase() || null;
  }
  if (type === 'lobby:leave') {
    return payload?.lobbyCode?.toUpperCase() || clientInfo?.lobbyCode || null;
  }
  return clientInfo?.lobbyCode || null;
};

const getGameCodeFromMessage = (type, payload, clientInfo) => {
  const isGameType =
    type?.startsWith('game:') ||
    type === 'player:status-update' ||
    type === 'state:sync';

  if (!isGameType) return null;

  if (type === 'game:join' || type === 'game:rejoin-host') {
    return payload?.code?.toUpperCase() || null;
  }
  if (type === 'game:leave') {
    return payload?.gameCode?.toUpperCase() || clientInfo?.gameCode || null;
  }
  return clientInfo?.gameCode || null;
};

const enrichMessageWithVersion = (message) => {
  const base = message && typeof message === 'object' ? message : {};
  const originalMeta = base.meta && typeof base.meta === 'object' ? base.meta : {};
  return {
    ...base,
    meta: {
      ...originalMeta,
      signalingVersion: SIGNALING_VERSION,
      sentAt: Date.now()
    }
  };
};

const send = (socket, message) => {
  if (socket && socket.connected) {
    incrementTotalSocketMessages();
    const clientInfo = clients.get(socket.id);
    incrementLobbySocketMessages(clientInfo?.lobbyCode || null);
    const recipientId = clientInfo?.clientId || 'unknown';
    const finalMessage = enrichMessageWithVersion(message);
    log(
      `[MESSAGE ENVOYÉ] À: ${recipientId}, Type: ${finalMessage.type}, Version: ${SIGNALING_VERSION}`
    );
    socket.emit('message', finalMessage);
  }
};

const getLobbySnapshot = (lobby) => ({
  code: lobby.code,
  hostId: lobby.hostId,
  config: lobby.config || null,
  players: Array.from(lobby.players.values()).map(({ id, name, isHost, role, status }) => ({
    id,
    name,
    isHost,
    role: role ?? null,
    status: status ?? 'active'
  }))
});

io.on('connection', (socket) => {
  const clientId = randomUUID();
  clients.set(socket.id, {
    clientId,
    lobbyCode: null,
    gameCode: null,
    clientVersion: null
  });
  socketsById.set(clientId, socket);
  
  log(`[CONNEXION] Nouveau client connecté: ${clientId}`);
  send(socket, {
    type: 'server:hello',
    payload: {
      clientId,
      signalingVersion: SIGNALING_VERSION
    }
  });

  socket.on('admin:getStats', (ack) => {
    if (typeof ack === 'function') ack(getServerStats());
  });

  socket.on('admin:getGame', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const code = String(payload?.code ?? '').toUpperCase();
    if (!code) {
      ack({ ok: false, error: 'code requis' });
      return;
    }
    const game = games.get(code);
    if (!game) {
      ack({ ok: false, error: 'Game not found', code });
      return;
    }
    ack({
      ok: true,
      game: {
        code,
        hostId: game.hostId,
        playerCount: game.players.size,
        socketMessageCount: gameSocketMessageCounts.get(code) || 0,
        remainingTimeSeconds: getRemainingTimeSeconds(game),
        remainingTimeUpdatedAt: game.remainingTimeUpdatedAt || null,
        lastHostState: game.lastHostState || null,
        lastHostStateAt: game.lastHostStateAt || null,
        lastHostStateHostId: game.lastHostStateHostId || null,
        reconnectedPlayerIds: game.reconnectedPlayerIds || {},
        players: Array.from(game.players.values()).map((player) => {
          const s = socketsById.get(player.id);
          return {
            ...player,
            socketConnected: Boolean(s?.connected),
            status: player.status || 'active'
          };
        })
      }
    });
  });

  socket.on('admin:notifyPlayer', (payload, ack) => {
    if (typeof ack !== 'function') return;
    try {
      const targetId = payload?.clientId;
      const message = payload?.message != null ? String(payload.message) : '';
      const title = payload?.title != null ? String(payload.title) : undefined;
      if (!targetId) {
        ack({ success: false, error: 'clientId requis' });
        return;
      }
      const targetSocket = socketsById.get(targetId);
      if (!targetSocket || !targetSocket.connected) {
        ack({ success: false, error: 'Joueur introuvable ou déconnecté' });
        return;
      }
      send(targetSocket, { type: 'admin:notification', payload: { message, title, timestamp: Date.now() } });
      log(`[NOTIFICATION] Envoyée au joueur ${targetId.substring(0, 8)}...`);
      ack({ success: true });
    } catch (e) {
      ack({ success: false, error: e.message });
    }
  });

  socket.on('admin:notifyGame', (payload, ack) => {
    if (typeof ack !== 'function') return;
    try {
      const gameCode = payload?.gameCode != null ? String(payload.gameCode).toUpperCase() : '';
      const message = payload?.message != null ? String(payload.message) : '';
      const title = payload?.title != null ? String(payload.title) : undefined;
      if (!gameCode) {
        ack({ success: false, error: 'gameCode requis' });
        return;
      }
      const game = games.get(gameCode);
      if (!game) {
        ack({ success: false, error: 'Partie introuvable' });
        return;
      }
      let count = 0;
      game.players.forEach((p) => {
        const s = socketsById.get(p.id);
        if (s && s.connected) {
          send(s, { type: 'admin:notification', payload: { message, title, timestamp: Date.now() } });
          count++;
        }
      });
      log(`[NOTIFICATION] Envoyée à ${count} joueur(s) de la partie ${gameCode}`);
      ack({ success: true, count });
    } catch (e) {
      ack({ success: false, error: e.message });
    }
  });

  socket.on('message', (raw) => {
    incrementTotalSocketMessages();
    const rawPreview = typeof raw === 'string' ? raw.substring(0, 200) : JSON.stringify(raw).substring(0, 200);
    log(`[MESSAGE BRUT REÇU] ClientId: ${clientId}, Taille: ${rawPreview.length} caractères, Contenu: ${rawPreview}`);
    
    let message = raw;
    if (typeof raw === 'string') {
      try {
        message = JSON.parse(raw);
      } catch (error) {
        log(`[ERREUR PARSING] ClientId: ${clientId}, Erreur: ${error.message}`);
        send(socket, { type: 'error', payload: { message: 'Message JSON invalide.' } });
        return;
      }
    }

    const { type, payload } = message || {};
    const clientVersion =
      (message?.meta && typeof message.meta.clientVersion === 'string'
        ? message.meta.clientVersion
        : null) ||
      (payload && typeof payload.clientVersion === 'string'
        ? payload.clientVersion
        : null);
    const info = clients.get(socket.id);
    if (info && clientVersion && info.clientVersion !== clientVersion) {
      info.clientVersion = clientVersion;
      log(`[VERSION CLIENT] ${clientId}: ${clientVersion}`);
    }
    if (!type) {
      log(`[ERREUR] ClientId: ${clientId}, Message sans type`, message);
      send(socket, { type: 'error', payload: { message: 'Type de message manquant.' } });
      return;
    }

    log(`[MESSAGE REÇU] ClientId: ${clientId}, Type: ${type}, Payload:`, payload);
    const clientInfo = clients.get(socket.id);
    const lobbyCodeForMessage = getLobbyCodeFromMessage(type, payload, clientInfo);
    const gameCodeForMessage = getGameCodeFromMessage(type, payload, clientInfo);
    incrementLobbySocketMessages(lobbyCodeForMessage);
    incrementGameSocketMessages(gameCodeForMessage);

    if (type === 'lobby:create') {
      let code = generateCode();
      while (lobbies.has(code)) {
        code = generateCode();
      }

      const lobby = {
        code,
        hostId: clientId,
        players: new Map(),
        config: payload?.gameConfig || null
      };

      lobby.players.set(clientId, { id: clientId, name: payload?.playerName || 'Host', isHost: true });
      lobbies.set(code, lobby);
      lobbySocketMessageCounts.set(code, lobbySocketMessageCounts.get(code) || 0);
      clients.get(socket.id).lobbyCode = code;

      log(`[LOBBY CRÉÉ] Code: ${code}, Host: ${clientId}, Nom: ${payload?.playerName || 'Host'}`);
      incrementLobbySocketMessages(code);

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
      const oldPlayerId = payload?.oldPlayerId; // Pour reconnexion
      const lobby = lobbies.get(code);
      if (!lobby) {
        log(`[ERREUR LOBBY] Client ${clientId} tente de rejoindre un lobby inexistant: ${code}`);
        send(socket, { type: 'lobby:error', payload: { message: 'Lobby introuvable.' } });
        return;
      }

      // Vérifier si c'est une reconnexion (avec oldPlayerId)
      if (oldPlayerId && lobby.players.has(oldPlayerId)) {
        log(`[RECONNEXION] Client ${oldPlayerId} se reconnecte avec nouveau ID ${clientId} au lobby ${code}`);
        
        // Récupérer les infos de l'ancien joueur
        const existingPlayer = lobby.players.get(oldPlayerId);
        
        // Remplacer l'ancien playerId par le nouveau dans le lobby
        lobby.players.delete(oldPlayerId);
        lobby.players.set(clientId, { 
          id: clientId,
          name: payload?.playerName || existingPlayer?.name || 'Joueur',
          isHost: existingPlayer?.isHost || false
        });
        
        // Si c'était le host, mettre à jour le hostId
        if (lobby.hostId === oldPlayerId) {
          lobby.hostId = clientId;
          log(`[RECONNEXION HOST] Mise à jour du hostId de ${oldPlayerId} vers ${clientId}`);
        }
        
        // Mettre à jour les mappings
        socketsById.delete(oldPlayerId);
        socketsById.set(clientId, socket);
        clients.get(socket.id).lobbyCode = code;
        
        send(socket, {
          type: 'lobby:joined',
          payload: {
            code,
            playerId: clientId,
            hostId: lobby.hostId,
            lobby: getLobbySnapshot(lobby)
          }
        });

        // Notifier le host qu'un peer s'est reconnecté pour rétablir la connexion WebRTC
        if (lobby.hostId !== clientId) {
          const hostSocket = socketsById.get(lobby.hostId);
          if (hostSocket) {
            log(`[RECONNEXION] Notification du host ${lobby.hostId} que ${clientId} (ancien ${oldPlayerId}) s'est reconnecté`);
            send(hostSocket, {
              type: 'lobby:peer-reconnected',
              payload: {
                playerId: clientId,
                playerName: existingPlayer?.name || payload?.playerName || 'Joueur'
              }
            });
          }
        }
        
        return;
      }

      // Vérifier si le joueur est déjà dans le lobby avec le même clientId (rare)
      if (lobby.players.has(clientId)) {
        log(`[RECONNEXION] Client ${clientId} déjà dans le lobby ${code} - mise à jour du socket`);
        
        // Mettre à jour les informations du joueur (notamment le nom s'il a changé)
        const existingPlayer = lobby.players.get(clientId);
        if (existingPlayer && payload?.playerName) {
          existingPlayer.name = payload.playerName;
          lobby.players.set(clientId, existingPlayer);
        }
        
        // Mettre à jour le mapping socket
        clients.get(socket.id).lobbyCode = code;
        socketsById.set(clientId, socket);
        
        send(socket, {
          type: 'lobby:joined',
          payload: {
            code,
            playerId: clientId,
            hostId: lobby.hostId,
            lobby: getLobbySnapshot(lobby)
          }
        });

        // Notifier le host qu'un peer s'est reconnecté pour rétablir la connexion WebRTC
        const hostSocket = socketsById.get(lobby.hostId);
        if (hostSocket && hostSocket.id !== socket.id) {
          log(`[RECONNEXION] Notification du host ${lobby.hostId} que ${clientId} s'est reconnecté`);
          send(hostSocket, {
            type: 'lobby:peer-reconnected',
            payload: {
              playerId: clientId,
              playerName: existingPlayer?.name || payload?.playerName || 'Joueur'
            }
          });
        }
        
        return;
      }

      // Nouveau joueur
      lobby.players.set(clientId, { id: clientId, name: payload?.playerName || 'Joueur', isHost: false });
      clients.get(socket.id).lobbyCode = code;

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

    if (type === 'lobby:rejoin-host') {
      const code = payload?.code?.toUpperCase();
      const oldPlayerId = payload?.playerId;
      const lobby = lobbies.get(code);
      
      if (!lobby) {
        log(`[ERREUR LOBBY] Host ${clientId} tente de rejoindre un lobby inexistant: ${code}`);
        send(socket, { type: 'lobby:error', payload: { message: 'Lobby introuvable.' } });
        return;
      }

      // Vérifier si c'est bien le host qui tente de se reconnecter
      if (lobby.hostId === oldPlayerId) {
        log(`[HOST RECONNEXION] Code: ${code}, Ancien PlayerId: ${oldPlayerId}, Nouveau: ${clientId}`);
        
        // Annuler le timeout de suppression du lobby si il existe
        if (disconnectedHosts.has(code)) {
          const hostInfo = disconnectedHosts.get(code);
          clearTimeout(hostInfo.timeoutId);
          disconnectedHosts.delete(code);
          log(`[HOST RECONNEXION] Timeout annulé pour le lobby ${code}`);
        }
        
        // Mettre à jour le hostId et la map des joueurs
        lobby.hostId = clientId;
        const oldPlayer = lobby.players.get(oldPlayerId);
        if (oldPlayer) {
          lobby.players.delete(oldPlayerId);
          lobby.players.set(clientId, { 
            id: clientId,
            name: payload?.playerName || oldPlayer.name || 'Host',
            isHost: true 
          });
        } else {
          lobby.players.set(clientId, { 
            id: clientId, 
            name: payload?.playerName || 'Host', 
            isHost: true 
          });
        }
        
        // Mettre à jour les maps globales
        socketsById.delete(oldPlayerId);
        socketsById.set(clientId, socket);
        clients.set(socket.id, {
          clientId,
          lobbyCode: code,
          gameCode: null,
          clientVersion: clients.get(socket.id)?.clientVersion || null
        });

        send(socket, {
          type: 'lobby:joined',
          payload: {
            code,
            playerId: clientId,
            hostId: clientId,
            lobby: getLobbySnapshot(lobby)
          }
        });
        
        // Notifier les autres joueurs de la reconnexion du host
        lobby.players.forEach((player) => {
          if (player.id !== clientId) {
            const playerSocket = socketsById.get(player.id);
            if (playerSocket) {
              send(playerSocket, {
                type: 'lobby:host-reconnected',
                payload: { newHostId: clientId }
              });
            }
          }
        });
        return;
      } else {
        log(`[ERREUR LOBBY] Client ${clientId} tente de se reconnecter en tant que host mais n'est pas le host du lobby ${code}`);
        send(socket, { type: 'lobby:error', payload: { message: 'Non autorisé à rejoindre en tant que host.' } });
        return;
      }
    }

    if (type === 'game:create') {
      const code = payload?.code?.toUpperCase();
      const lobby = lobbies.get(code);
      if (!code || !lobby) {
        send(socket, { type: 'game:error', payload: { message: 'Lobby introuvable pour démarrer la partie.' } });
        return;
      }

      if (lobby.hostId !== clientId) {
        send(socket, { type: 'game:error', payload: { message: 'Seul le host peut démarrer la partie.' } });
        return;
      }

      if (games.has(code)) {
        send(socket, {
          type: 'game:created',
          payload: {
            code,
            playerId: clientId,
            hostId: lobby.hostId,
            game: getLobbySnapshot(games.get(code))
          }
        });
        return;
      }

      const game = {
        code,
        hostId: lobby.hostId,
        players: new Map()
      };

      lobby.players.forEach((player) => {
        game.players.set(player.id, { ...player });
      });

      games.set(code, game);
      gameSocketMessageCounts.set(code, gameSocketMessageCounts.get(code) || 0);

      persistToBdd('/api/game-sessions', 'POST', { game_code: code });

      lobby.players.forEach((player) => {
        const playerSocket = socketsById.get(player.id);
        if (playerSocket) {
          const playerClient = clients.get(playerSocket.id);
          if (playerClient) {
            playerClient.lobbyCode = null;
          }
        }
      });

      lobbies.delete(code);
      lobbySocketMessageCounts.delete(code);

      lobby.players.forEach((player) => {
        const playerSocket = socketsById.get(player.id);
        if (playerSocket) {
          send(playerSocket, {
            type: 'game:started',
            payload: { code }
          });
        }
      });

      clients.get(socket.id).gameCode = code;
      clients.get(socket.id).lobbyCode = null;

      send(socket, {
        type: 'game:created',
        payload: {
          code,
          playerId: clientId,
          hostId: lobby.hostId,
          game: getLobbySnapshot(game)
        }
      });
      return;
    }

    if (type === 'game:join') {
      const code = payload?.code?.toUpperCase();
      const oldPlayerId = payload?.oldPlayerId;
      const game = games.get(code);
      if (!game) {
        send(socket, { type: 'game:error', payload: { message: 'Partie introuvable.' } });
        return;
      }

      if (oldPlayerId && game.players.has(oldPlayerId)) {
        const existingPlayer = game.players.get(oldPlayerId);
        game.players.delete(oldPlayerId);
        game.players.set(clientId, {
          id: clientId,
          name: payload?.playerName || existingPlayer?.name || 'Joueur',
          isHost: existingPlayer?.isHost || false,
          status: existingPlayer?.status || 'active',
          role: existingPlayer?.role ?? undefined
        });

        if (game.hostId === oldPlayerId) {
          game.hostId = clientId;
        }

        if (!game.reconnectedPlayerIds) game.reconnectedPlayerIds = {};
        game.reconnectedPlayerIds[oldPlayerId] = clientId;

        socketsById.delete(oldPlayerId);
        socketsById.set(clientId, socket);
        clients.get(socket.id).gameCode = code;
        clients.get(socket.id).lobbyCode = null;

        send(socket, {
          type: 'game:joined',
          payload: {
            code,
            playerId: clientId,
            hostId: game.hostId,
            game: getLobbySnapshot(game)
          }
        });

        if (game.hostId !== clientId) {
          const hostSocket = socketsById.get(game.hostId);
          if (hostSocket) {
            send(hostSocket, {
              type: 'game:peer-reconnected',
              payload: {
                playerId: clientId,
                oldPlayerId,
                playerName: existingPlayer?.name || payload?.playerName || 'Joueur'
              }
            });
          }
        }
        return;
      }

      if (game.players.has(clientId)) {
        const existingPlayer = game.players.get(clientId);
        if (existingPlayer && payload?.playerName) {
          existingPlayer.name = payload.playerName;
          game.players.set(clientId, existingPlayer);
        }

        clients.get(socket.id).gameCode = code;
        clients.get(socket.id).lobbyCode = null;
        socketsById.set(clientId, socket);

        send(socket, {
          type: 'game:joined',
          payload: {
            code,
            playerId: clientId,
            hostId: game.hostId,
            game: getLobbySnapshot(game)
          }
        });

        const hostSocket = socketsById.get(game.hostId);
        if (hostSocket && hostSocket.id !== socket.id) {
          send(hostSocket, {
            type: 'game:peer-reconnected',
            payload: {
              playerId: clientId,
              playerName: existingPlayer?.name || payload?.playerName || 'Joueur'
            }
          });
        }

        return;
      }

      // Si le host est déconnecté et qu'on ajoute un joueur sans oldPlayerId, c'est probablement
      // le host qui se reconnecte après un refresh (session perdue ou game:rejoin-host non envoyé).
      // On remplace l'entrée du host au lieu d'ajouter un doublon.
      const hostSocket = socketsById.get(game.hostId);
      const hostDisconnected = game.hostId && !hostSocket;
      if (hostDisconnected && disconnectedGameHosts.has(code)) {
        const oldHostPlayer = game.players.get(game.hostId);
        if (oldHostPlayer) {
          const oldHostId = game.hostId;
          log(`[RECONNEXION HOST SANS oldPlayerId] Code: ${code}, ancien host: ${oldHostId}, nouveau: ${clientId}`);
          game.players.delete(oldHostId);
          game.players.set(clientId, {
            id: clientId,
            name: payload?.playerName || oldHostPlayer.name || 'Host',
            isHost: true,
            status: oldHostPlayer.status || 'active',
            role: oldHostPlayer.role ?? undefined
          });
          game.hostId = clientId;
          if (!game.reconnectedPlayerIds) game.reconnectedPlayerIds = {};
          game.reconnectedPlayerIds[oldHostId] = clientId;
          const info = disconnectedGameHosts.get(code);
          if (info) {
            clearTimeout(info.timeoutId);
            disconnectedGameHosts.delete(code);
          }
          clients.get(socket.id).gameCode = code;
          clients.get(socket.id).lobbyCode = null;

          send(socket, {
            type: 'game:joined',
            payload: {
              code,
              playerId: clientId,
              hostId: clientId,
              game: getLobbySnapshot(game)
            }
          });

          game.players.forEach((p) => {
            if (p.id !== clientId) {
              const s = socketsById.get(p.id);
              if (s) send(s, { type: 'game:host-reconnected', payload: { newHostId: clientId } });
            }
          });
          return;
        }
      }

      game.players.set(clientId, { id: clientId, name: payload?.playerName || 'Joueur', isHost: false });
      clients.get(socket.id).gameCode = code;
      clients.get(socket.id).lobbyCode = null;

      send(socket, {
        type: 'game:joined',
        payload: {
          code,
          playerId: clientId,
          hostId: game.hostId,
          game: getLobbySnapshot(game)
        }
      });

      const hostSocketForJoin = socketsById.get(game.hostId);
      if (hostSocketForJoin) {
        send(hostSocketForJoin, {
          type: 'game:peer-joined',
          payload: {
            playerId: clientId,
            playerName: payload?.playerName || 'Joueur'
          }
        });
      }
      return;
    }

    if (type === 'game:rejoin-host') {
      const code = payload?.code?.toUpperCase();
      const oldPlayerId = payload?.playerId;
      const game = games.get(code);

      if (!game) {
        send(socket, { type: 'game:error', payload: { message: 'Partie introuvable.' } });
        return;
      }

      if (game.hostId === oldPlayerId) {
        if (disconnectedGameHosts.has(code)) {
          const hostInfo = disconnectedGameHosts.get(code);
          clearTimeout(hostInfo.timeoutId);
          disconnectedGameHosts.delete(code);
        }

        game.hostId = clientId;
        const oldPlayer = game.players.get(oldPlayerId);
        if (oldPlayer) {
          game.players.delete(oldPlayerId);
          game.players.set(clientId, {
            id: clientId,
            name: payload?.playerName || oldPlayer.name || 'Host',
            isHost: true,
            status: oldPlayer.status || 'active',
            role: oldPlayer.role ?? undefined
          });
        } else {
          game.players.set(clientId, {
            id: clientId,
            name: payload?.playerName || 'Host',
            isHost: true,
            status: 'active'
          });
        }

        if (!game.reconnectedPlayerIds) game.reconnectedPlayerIds = {};
        game.reconnectedPlayerIds[oldPlayerId] = clientId;

        socketsById.delete(oldPlayerId);
        socketsById.set(clientId, socket);
        clients.set(socket.id, {
          clientId,
          lobbyCode: null,
          gameCode: code,
          clientVersion: clients.get(socket.id)?.clientVersion || null
        });

        send(socket, {
          type: 'game:joined',
          payload: {
            code,
            playerId: clientId,
            hostId: clientId,
            game: getLobbySnapshot(game)
          }
        });

        game.players.forEach((player) => {
          if (player.id !== clientId) {
            const playerSocket = socketsById.get(player.id);
            if (playerSocket) {
              send(playerSocket, {
                type: 'game:host-reconnected',
                payload: { newHostId: clientId }
              });
            }
          }
        });
        return;
      }

      send(socket, { type: 'game:error', payload: { message: 'Non autorisé à rejoindre en tant que host.' } });
      return;
    }

    if (type === 'game:signal') {
      const targetId = payload?.targetId;
      const targetSocket = socketsById.get(targetId);
      if (!targetSocket) {
        send(socket, {
          type: 'game:error',
          payload: { message: 'Destinataire WebRTC introuvable.' }
        });
        return;
      }

      send(targetSocket, {
        type: 'game:signal',
        payload: {
          fromId: clientId,
          signal: payload?.signal,
          channel: payload?.channel
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
          signal: payload?.signal,
          channel: payload?.channel
        }
      });
      return;
    }

    if (type === 'lobby:request-resync') {
      const { lobbyCode } = clients.get(socket.id) || {};
      if (!lobbyCode || !lobbies.has(lobbyCode)) {
        log(`[ERREUR RESYNC] Client ${clientId} demande resync sans lobby actif`);
        send(socket, { type: 'lobby:error', payload: { message: 'Lobby introuvable pour resync.' } });
        return;
      }
      const lobby = lobbies.get(lobbyCode);
      const hostSocket = socketsById.get(lobby.hostId);
      send(hostSocket, {
        type: 'lobby:request-resync',
        payload: { playerId: clientId }
      });
      return;
    }

    if (type === 'game:request-resync') {
      const { gameCode } = clients.get(socket.id) || {};
      if (!gameCode || !games.has(gameCode)) {
        send(socket, { type: 'game:error', payload: { message: 'Partie introuvable pour resync.' } });
        return;
      }
      const game = games.get(gameCode);
      const hostSocket = socketsById.get(game.hostId);
      send(hostSocket, {
        type: 'game:request-resync',
        payload: { playerId: clientId }
      });
      return;
    }

    if (type === 'game:update-remaining-time') {
      const gameCode = clientInfo?.gameCode;
      const remaining = payload?.remaining_time;
      if (gameCode && games.has(gameCode) && typeof remaining === 'number') {
        const game = games.get(gameCode);
        if (game && clientInfo?.clientId === game.hostId) {
          game.remainingTimeSeconds = Math.max(0, Math.floor(remaining));
          game.remainingTimeUpdatedAt = Date.now();
          if (payload && 'countdown_started' in payload) {
            game.remainingTimeCountdownActive = !!payload.countdown_started;
          }
        }
      }
      return;
    }

    if (type === 'game:persist-snapshot') {
      const gameCode = (payload?.gameCode || clientInfo?.gameCode || '').toString().trim().toUpperCase();
      const state = payload?.state;
      if (!gameCode || !state) return;
      const game = games.get(gameCode);
      if (!game || game.hostId !== clientId) return;
      const gd = state.gameDetails || {};
      const players = state.players || [];
      const props = state.props || [];
      let gamePhase = 'converging';
      if (gd.winner_type) gamePhase = 'ended';
      else if (gd.started && gd.countdown_started) gamePhase = 'running';
      const playersForReplay = players.map((p) => ({
        id_player: p.id_player,
        role: p.role,
        latitude: p.latitude,
        longitude: p.longitude,
        status: p.status,
        displayName: p.displayName || p.name
      }));
      const propsForReplay = props.map((pr) => ({
        id_prop: pr.id_prop,
        state: pr.state,
        visible: pr.visible,
        latitude: pr.latitude,
        longitude: pr.longitude,
        name: pr.name
      }));
      persistToBdd('/api/game-replay/snapshot', 'POST', {
        game_code: gameCode,
        snapshot_timestamp: new Date().toISOString(),
        remaining_time_seconds: gd.remaining_time ?? null,
        game_phase: gamePhase,
        players_json: playersForReplay,
        props_json: propsForReplay
      });
      persistToBdd('/api/game-sessions', 'POST', {
        game_code: gameCode,
        config_json: gd.id_game ? {
          map_center_latitude: gd.map_center_latitude,
          map_center_longitude: gd.map_center_longitude,
          map_radius: gd.map_radius,
          start_zone_latitude: gd.start_zone_latitude,
          start_zone_longitude: gd.start_zone_longitude,
          start_zone_rogue_latitude: gd.start_zone_rogue_latitude,
          start_zone_rogue_longitude: gd.start_zone_rogue_longitude,
          duration: gd.duration,
          victory_condition_nb_objectivs: gd.victory_condition_nb_objectivs,
          objectiv_zone_radius: gd.objectiv_zone_radius,
          rogue_range: gd.rogue_range,
          agent_range: gd.agent_range
        } : null
      });
      return;
    }

    if (type === 'state:sync') {
      const targetId = payload?.targetId;
      const targetSocket = socketsById.get(targetId);
      if (!targetSocket) {
        log(`[ERREUR RESYNC] État sync vers ${targetId} échoué: destinataire introuvable`);
        return;
      }
      const gameCode = clientInfo?.gameCode;
      const inner = payload?.payload;
      const remainingTime = inner?.gameDetails?.remaining_time;
      if (gameCode && games.has(gameCode)) {
        const game = games.get(gameCode);
        if (game && clientInfo?.clientId === game.hostId) {
          if (typeof remainingTime === 'number') {
            game.remainingTimeSeconds = remainingTime;
            game.remainingTimeUpdatedAt = Date.now();
          }
          game.remainingTimeCountdownActive = !!(inner?.gameDetails?.started && inner?.gameDetails?.countdown_started);
          game.lastHostState = inner || null;
          game.lastHostStateAt = Date.now();
          game.lastHostStateHostId = clientInfo.clientId;
        }
      }
      send(targetSocket, {
        type: 'state:sync',
        payload: inner
      });
      return;
    }

    if (type === 'action:relay') {
      const { lobbyCode } = clients.get(socket.id) || {};
      if (!lobbyCode || !lobbies.has(lobbyCode)) {
        log(`[ERREUR ACTION] Client ${clientId} envoie action sans lobby actif`);
        send(socket, { type: 'lobby:error', payload: { message: 'Lobby introuvable pour action.' } });
        return;
      }
      const lobby = lobbies.get(lobbyCode);
      const hostSocket = socketsById.get(lobby.hostId);
      send(hostSocket, {
        type: 'action:relay',
        payload: { fromId: clientId, action: payload?.action }
      });
      return;
    }

    if (type === 'game:action-relay') {
      const { gameCode } = clients.get(socket.id) || {};
      if (!gameCode || !games.has(gameCode)) {
        send(socket, { type: 'game:error', payload: { message: 'Partie introuvable pour action.' } });
        return;
      }
      const game = games.get(gameCode);
      const hostSocket = socketsById.get(game.hostId);
      send(hostSocket, {
        type: 'game:action-relay',
        payload: { fromId: clientId, action: payload?.action }
      });
      return;
    }

    if (type === 'lobby:leave') {
      const code = payload?.lobbyCode;
      const playerId = payload?.playerId || clientId;
      
      if (!code || !lobbies.has(code)) {
        log(`[ERREUR LEAVE] Client ${clientId} tente de quitter un lobby inexistant: ${code}`);
        return;
      }

      const lobby = lobbies.get(code);
      
      // Vérifier que le joueur fait bien partie du lobby
      if (!lobby.players.has(playerId)) {
        log(`[ERREUR LEAVE] Client ${clientId} n'est pas dans le lobby ${code}`);
        return;
      }

      log(`[JOUEUR QUITTE] Lobby: ${code}, Joueur: ${playerId}`);

      // Si c'est le host qui quitte, fermer le lobby
      if (lobby.hostId === playerId) {
        log(`[HOST QUITTE] Code: ${code}, Host: ${playerId} - Fermeture du lobby`);
        
        // Annuler les timers si ils existent
        if (disconnectedHosts.has(code)) {
          const hostInfo = disconnectedHosts.get(code);
          clearTimeout(hostInfo.timeoutId);
          disconnectedHosts.delete(code);
        }
        if (awayHosts.has(code)) {
          const awayInfo = awayHosts.get(code);
          clearTimeout(awayInfo.timeoutId);
          awayHosts.delete(code);
        }
        
        // Notifier tous les joueurs que le lobby est fermé
        lobby.players.forEach((player) => {
          if (player.id !== playerId) {
            const playerSocket = socketsById.get(player.id);
            send(playerSocket, { 
              type: 'lobby:closed', 
              payload: { 
                code, 
                reason: 'Le host a quitté le lobby'
              } 
            });
          }
        });
        
        // Supprimer le lobby
        lobbies.delete(code);
      lobbySocketMessageCounts.delete(code);
      } else {
        // Joueur normal qui quitte
        lobby.players.delete(playerId);
        
        // Notifier le host que le joueur a quitté
        const hostSocket = socketsById.get(lobby.hostId);
        if (hostSocket) {
          send(hostSocket, { 
            type: 'lobby:peer-left', 
            payload: { playerId } 
          });
        }
      }

      // Mettre à jour les infos du client
      const clientInfo = clients.get(socket.id);
      if (clientInfo) {
        clientInfo.lobbyCode = null;
      }
      
      return;
    }

    if (type === 'game:leave') {
      const code = payload?.gameCode;
      const playerId = payload?.playerId || clientId;

      if (!code || !games.has(code)) {
        return;
      }

      const game = games.get(code);
      if (!game.players.has(playerId)) {
        return;
      }

      if (game.hostId === playerId) {
        const lastState = game.lastHostState;
        const winnerType = lastState?.gameDetails?.winner_type || null;
        persistToBdd('/api/game-sessions', 'POST', {
          game_code: code,
          ended_at: new Date().toISOString(),
          winner_type: winnerType
        });
        game.players.forEach((player) => {
          if (player.id !== playerId) {
            const playerSocket = socketsById.get(player.id);
            send(playerSocket, {
              type: 'game:closed',
              payload: { code, reason: 'Le host a quitté la partie' }
            });
          }
        });
        games.delete(code);
        gameSocketMessageCounts.delete(code);
      } else {
        game.players.delete(playerId);
        const hostSocket = socketsById.get(game.hostId);
        if (hostSocket) {
          send(hostSocket, {
            type: 'game:peer-left',
            payload: { playerId }
          });
        }
      }

      const clientInfo = clients.get(socket.id);
      if (clientInfo) {
        clientInfo.gameCode = null;
      }
      return;
    }

    if (type === 'player:status-update') {
      const { lobbyCode, gameCode } = clients.get(socket.id) || {};
      if (gameCode && games.has(gameCode)) {
        const game = games.get(gameCode);
        const player = game.players.get(clientId);
        if (player) {
          player.status = payload?.status || 'active';
        }
        return;
      }

      if (!lobbyCode || !lobbies.has(lobbyCode)) {
        return;
      }
      const lobby = lobbies.get(lobbyCode);
      const player = lobby.players.get(clientId);
      if (player) {
        const oldStatus = player.status;
        player.status = payload?.status || 'active';
        log(`[STATUT JOUEUR] ${clientId} dans lobby ${lobbyCode}: ${player.status}`);
        
        // Si c'est le host qui change de statut
        if (clientId === lobby.hostId) {
          if (player.status === 'away' && oldStatus !== 'away') {
            // Host devient absent - démarrer le timer de 2 minutes
            log(`[HOST ABSENT] Code: ${lobbyCode}, Host: ${clientId} - Timer de 2 minutes démarré`);
            
            // Annuler le timer précédent s'il existe
            if (awayHosts.has(lobbyCode)) {
              const existingInfo = awayHosts.get(lobbyCode);
              clearTimeout(existingInfo.timeoutId);
            }
            
            const timeoutId = setTimeout(() => {
              if (lobbies.has(lobbyCode)) {
                const currentLobby = lobbies.get(lobbyCode);
                const currentHostPlayer = currentLobby.players.get(lobby.hostId);
                
                // Vérifier si le host est toujours absent
                if (currentHostPlayer && currentHostPlayer.status === 'away') {
                  log(`[LOBBY FERMÉ] Code: ${lobbyCode}, Host absent depuis trop longtemps (2 minutes)`);
                  
                  // Notifier tous les joueurs que le lobby est fermé
                  currentLobby.players.forEach((p) => {
                    const playerSocket = socketsById.get(p.id);
                    send(playerSocket, { 
                      type: 'lobby:closed', 
                      payload: { 
                        code: lobbyCode, 
                        reason: 'Host absent depuis trop longtemps'
                      } 
                    });
                  });
                  
                  lobbies.delete(lobbyCode);
                  lobbySocketMessageCounts.delete(lobbyCode);
                  awayHosts.delete(lobbyCode);
                }
              }
            }, 2 * 60 * 1000); // 2 minutes
            
            awayHosts.set(lobbyCode, {
              hostId: clientId,
              timeoutId,
              awayAt: Date.now()
            });
          } else if (player.status === 'active' && oldStatus === 'away') {
            // Host revient - annuler le timer
            if (awayHosts.has(lobbyCode)) {
              const awayInfo = awayHosts.get(lobbyCode);
              clearTimeout(awayInfo.timeoutId);
              awayHosts.delete(lobbyCode);
              log(`[HOST RETOUR] Code: ${lobbyCode}, Host: ${clientId} - Timer annulé`);
            }
          }
        }
      }
      return;
    }

    if (type === 'lobby:chat') {
      const { lobbyCode } = clients.get(socket.id) || {};
      const text = typeof payload?.text === 'string' ? payload.text.trim().substring(0, 500) : '';
      if (!lobbyCode || !lobbies.has(lobbyCode) || !text) return;

      const lobby = lobbies.get(lobbyCode);
      const player = lobby.players.get(clientId);
      if (!player) return;

      const msg = {
        playerId: clientId,
        playerName: player.name || 'Joueur',
        text,
        timestamp: Date.now()
      };

      lobby.players.forEach((p) => {
        const s = socketsById.get(p.id);
        if (s) send(s, { type: 'lobby:chat-message', payload: msg });
      });
      return;
    }

    if (type === 'game:chat:agent') {
      const { gameCode } = clients.get(socket.id) || {};
      const text = typeof payload?.text === 'string' ? payload.text.trim().substring(0, 500) : '';
      if (!gameCode || !games.has(gameCode) || !text) return;

      const game = games.get(gameCode);
      const player = game.players.get(clientId);
      if (!player || (player.role || '').toUpperCase() !== 'AGENT') return;

      const msg = {
        playerId: clientId,
        playerName: player.name || 'Joueur',
        text,
        timestamp: Date.now()
      };

      game.players.forEach((p) => {
        if ((p.role || '').toUpperCase() !== 'AGENT') return;
        const s = socketsById.get(p.id);
        if (s) send(s, { type: 'game:chat-agent-message', payload: msg });
      });
      return;
    }

    if (type === 'game:chat:rogue') {
      const { gameCode } = clients.get(socket.id) || {};
      const text = typeof payload?.text === 'string' ? payload.text.trim().substring(0, 500) : '';
      if (!gameCode || !games.has(gameCode) || !text) return;

      const game = games.get(gameCode);
      const player = game.players.get(clientId);
      if (!player || (player.role || '').toUpperCase() !== 'ROGUE') return;

      const msg = {
        playerId: clientId,
        playerName: player.name || 'Joueur',
        text,
        timestamp: Date.now()
      };

      game.players.forEach((p) => {
        if ((p.role || '').toUpperCase() !== 'ROGUE') return;
        const s = socketsById.get(p.id);
        if (s) send(s, { type: 'game:chat-rogue-message', payload: msg });
      });
      return;
    }

    if (type === 'player:role-update') {
      const { lobbyCode, gameCode } = clients.get(socket.id) || {};
      const targetId = payload?.playerId || clientId;
      const role = payload?.role ?? null;

      if (gameCode && games.has(gameCode)) {
        const game = games.get(gameCode);
        const player = game.players.get(targetId);
        if (player) {
          player.role = role;
        }
        return;
      }

      if (lobbyCode && lobbies.has(lobbyCode)) {
        const lobby = lobbies.get(lobbyCode);
        const player = lobby.players.get(targetId);
        if (player) {
          player.role = role;
          // Diffuser immédiatement la mise à jour de rôle à tous les clients du lobby.
          lobby.players.forEach((p) => {
            const s = socketsById.get(p.id);
            if (s) {
              send(s, {
                type: 'lobby:player-updated',
                payload: {
                  playerId: targetId,
                  changes: { role: role }
                }
              });
            }
          });
        }
      }
      return;
    }

    // Message non reconnu
    log(`[AVERTISSEMENT] ClientId: ${clientId}, Type de message non reconnu: ${type}`);
    send(socket, { 
      type: 'error', 
      payload: { message: `Type de message non reconnu: ${type}` } 
    });
  });

  socket.on('disconnect', () => {
    const clientInfo = clients.get(socket.id);
    if (!clientInfo) return;

    log(`[DÉCONNEXION] Client déconnecté: ${clientInfo.clientId}`);
    
    const { lobbyCode, gameCode } = clientInfo;
    if (gameCode && games.has(gameCode)) {
      const game = games.get(gameCode);
      if (game.hostId === clientInfo.clientId) {
        const timeoutId = setTimeout(() => {
          if (games.has(gameCode) && games.get(gameCode).hostId === clientInfo.clientId) {
            const currentGame = games.get(gameCode);
            if (currentGame) {
              const lastState = currentGame.lastHostState;
              const winnerType = lastState?.gameDetails?.winner_type || null;
              persistToBdd('/api/game-sessions', 'POST', {
                game_code: gameCode,
                ended_at: new Date().toISOString(),
                winner_type: winnerType
              });
              currentGame.players.forEach((player) => {
                const playerSocket = socketsById.get(player.id);
                send(playerSocket, { type: 'game:closed', payload: { code: gameCode } });
              });
            }
            games.delete(gameCode);
            gameSocketMessageCounts.delete(gameCode);
            disconnectedGameHosts.delete(gameCode);
          }
        }, 5 * 60 * 1000);

        disconnectedGameHosts.set(gameCode, {
          hostId: clientInfo.clientId,
          timeoutId,
          disconnectedAt: Date.now()
        });
      } else {
        // Ne pas supprimer le joueur de game.players : on garde rôle, etc. pour la reconnexion.
        // On notifie le host qui marquera le joueur déconnecté ; au game:join avec oldPlayerId
        // on remplacera l'entrée par le nouveau clientId.
        const hostSocket = socketsById.get(game.hostId);
        if (hostSocket) send(hostSocket, { type: 'game:peer-left', payload: { playerId: clientInfo.clientId } });
      }
    }

    if (lobbyCode && lobbies.has(lobbyCode)) {
      const lobby = lobbies.get(lobbyCode);

      if (lobby.hostId === clientInfo.clientId) {
        log(`[HOST DÉCONNECTÉ] Code: ${lobbyCode}, Host: ${clientInfo.clientId} - Lobby conservé pendant 5 minutes`);
        
        // Annuler le timer "away" si le host se déconnecte
        if (awayHosts.has(lobbyCode)) {
          const awayInfo = awayHosts.get(lobbyCode);
          clearTimeout(awayInfo.timeoutId);
          awayHosts.delete(lobbyCode);
          log(`[HOST DÉCONNECTÉ] Timer "away" annulé pour le lobby ${lobbyCode}`);
        }
        
        // NE PAS supprimer le host de lobby.players pour garder ses infos
        // Il sera supprimé seulement si le timeout expire
        
        // Marquer le lobby comme en attente de reconnexion
        const timeoutId = setTimeout(() => {
          if (lobbies.has(lobbyCode) && lobbies.get(lobbyCode).hostId === clientInfo.clientId) {
            log(`[LOBBY FERMÉ] Code: ${lobbyCode}, Timeout de reconnexion dépassé`);
            
            const currentLobby = lobbies.get(lobbyCode);
            if (currentLobby) {
              // Notifier tous les joueurs que le lobby est fermé
              currentLobby.players.forEach((player) => {
                const playerSocket = socketsById.get(player.id);
                send(playerSocket, { type: 'lobby:closed', payload: { code: lobbyCode } });
              });
            }
            
            lobbies.delete(lobbyCode);
            lobbySocketMessageCounts.delete(lobbyCode);
            disconnectedHosts.delete(lobbyCode);
          }
        }, 5 * 60 * 1000); // 5 minutes
        
        disconnectedHosts.set(lobbyCode, {
          hostId: clientInfo.clientId,
          timeoutId,
          disconnectedAt: Date.now()
        });
      } else {
        // Pour les non-hosts, supprimer immédiatement
        lobby.players.delete(clientInfo.clientId);
        log(`[JOUEUR PARTI] Lobby: ${lobbyCode}, Joueur: ${clientInfo.clientId}`);
        const hostSocket = socketsById.get(lobby.hostId);
        send(hostSocket, { type: 'lobby:peer-left', payload: { playerId: clientInfo.clientId } });
      }
    }

    clients.delete(socket.id);
    socketsById.delete(clientInfo.clientId);
  });
});

server.listen(PORT, () => {
  const address = server.address();
  const host = address.address === '::' ? 'localhost' : address.address;
  const port = address.port;
  
  log('========================================');
  log(`🚀 Serveur de signalisation WebRTC démarré`);
  log(`📡 Port: ${port}`);
  log(`🌐 Adresse: ${host}`);
  log(`🔗 URL HTTP: http://${host === '::' ? 'localhost' : host}:${port}`);
  log(`🔗 Socket.io path: ${SOCKET_IO_PATH}`);
  log(`📊 Logs des signaux activés`);
  log('========================================');
});
