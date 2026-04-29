import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { randomUUID, createHmac } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { inspect } from 'util';

// Charger les variables d'environnement depuis le fichier .env
dotenv.config();

const PORT = process.env.SIGNALING_PORT || 5174;
const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || '/socket.io';
const SIGNALING_VERSION = process.env.SIGNALING_VERSION || '2026.04.10';
const MEMORY_ONLY_MODE =
  process.env.MEMORY_ONLY_MODE === undefined
    ? true
    : process.env.MEMORY_ONLY_MODE === '1' ||
      /^true$/i.test(process.env.MEMORY_ONLY_MODE || '');
const LOBBY_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.LOBBY_TTL_MS || '1800000', 10) || 1_800_000
);
const GAME_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.GAME_TTL_MS || '10800000', 10) || 10_800_000
);
const EMPTY_GAME_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.EMPTY_GAME_TTL_MS || '300000', 10) || 300_000
);
const FINISHED_GAME_TTL_MS = Math.max(
  5_000,
  Number.parseInt(process.env.FINISHED_GAME_TTL_MS || '30000', 10) || 30_000
);
const ENABLE_COST_METRICS =
  process.env.ENABLE_COST_METRICS === undefined
    ? true
    : process.env.ENABLE_COST_METRICS === '1' ||
      /^true$/i.test(process.env.ENABLE_COST_METRICS || '');
const ENABLE_SERVER_LOGS =
  process.env.ENABLE_SERVER_LOGS === '1' ||
  /^true$/i.test(process.env.ENABLE_SERVER_LOGS || '');
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_LEVEL_ORDER = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};
const MESSAGE_DEBUG_SAMPLE_RATE = Math.min(
  1,
  Math.max(
    0,
    Number.parseFloat(process.env.MESSAGE_DEBUG_SAMPLE_RATE || '0.05') || 0.05
  )
);
const TURN_URLS = (process.env.TURN_URLS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const TURN_SECRET = process.env.TURN_SECRET || '';
const TURN_REALM = process.env.TURN_REALM || '';
const TURN_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(process.env.TURN_TTL_SECONDS || '600', 10) || 600
);
const COST_METRICS_INTERVAL_MS = Math.max(
  5_000,
  Number.parseInt(process.env.COST_METRICS_INTERVAL_MS || '60000', 10) || 60_000
);
const COST_METRICS_HISTORY_SIZE = Math.max(
  10,
  Number.parseInt(process.env.COST_METRICS_HISTORY_SIZE || '120', 10) || 120
);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_DATA_DIR = path.join(__dirname, 'data');
const SNAPSHOT_FILE = path.join(RUNTIME_DATA_DIR, 'runtime-state.json');
const EVENT_LOG_FILE = path.join(RUNTIME_DATA_DIR, 'runtime-events.log');
const DISCONNECTED_GAME_PLAYER_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.DISCONNECTED_GAME_PLAYER_TTL_MS || '300000', 10) ||
    300_000
);
const bddDisabled =
  process.env.DISABLE_BDD === '1' || /^true$/i.test(process.env.DISABLE_BDD || '');
const BDD_URL = bddDisabled ? null : (process.env.BDD_URL || 'http://localhost:5175');

// Helper : persister vers ServerBDD (replay)
const persistToBdd = async (path, method, body) => {
  if (MEMORY_ONLY_MODE) return;
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

const persistGamePlayerToBdd = (gameCode, player) => {
  persistToBdd(`/api/games/${gameCode}/players`, 'POST', {
    player_external_id: player.id,
    display_name_snapshot: player.name || 'Joueur',
    role: player.role ?? null,
    team: null,
    is_host: !!player.isHost,
    status: player.status || 'active'
  });
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

const prettyInspect = (value) =>
  inspect(value, {
    depth: 6,
    colors: false,
    compact: false,
    maxArrayLength: 50
  });

const getRemainingTimeSeconds = (game) => {
  if (!game || typeof game.remainingTimeSeconds !== 'number') {
    return null;
  }
  // Mode léger: éviter tout calcul temps réel côté serveur.
  // Le client host reste source de vérité pour le chrono.
  return game.remainingTimeSeconds;
};

const COST_METRICS_PATH = '/monitoring/cost';
let costMetricsLastCpuUsage = process.cpuUsage();
let costMetricsLastHrtimeNs = process.hrtime.bigint();
let costMetricsLastTotalMessages = 0;
let latestCostMetrics = null;
const costMetricsHistory = [];

const buildCostMetricsSample = () => {
  const now = new Date();
  const nowHr = process.hrtime.bigint();
  const elapsedNs = Number(nowHr - costMetricsLastHrtimeNs);
  const elapsedMs = Math.max(elapsedNs / 1e6, 1);

  const cpuNow = process.cpuUsage();
  const cpuUserUs = Math.max(0, cpuNow.user - costMetricsLastCpuUsage.user);
  const cpuSystemUs = Math.max(0, cpuNow.system - costMetricsLastCpuUsage.system);
  const cpuTotalMs = (cpuUserUs + cpuSystemUs) / 1000;
  const cpuCoreCount = Math.max(1, os.cpus()?.length || 1);
  const cpuPercentOfSingleCore = Math.min(100, (cpuTotalMs / elapsedMs) * 100);
  const cpuPercentOfMachine = Math.min(
    100,
    (cpuTotalMs / (elapsedMs * cpuCoreCount)) * 100
  );

  const mem = process.memoryUsage();
  const totalMessages = totalSocketMessages;
  const messageDelta = Math.max(0, totalMessages - costMetricsLastTotalMessages);
  const messagesPerSecond = (messageDelta * 1000) / elapsedMs;

  const sample = {
    timestampIso: now.toISOString(),
    intervalMs: Math.round(elapsedMs),
    connectedClients: clients.size,
    activeLobbies: lobbies.size,
    activeGames: games.size,
    socketMessagesTotal: totalMessages,
    socketMessagesDelta: messageDelta,
    socketMessagesPerSecond: Number(messagesPerSecond.toFixed(2)),
    cpu: {
      coreCount: cpuCoreCount,
      userMs: Number((cpuUserUs / 1000).toFixed(2)),
      systemMs: Number((cpuSystemUs / 1000).toFixed(2)),
      totalMs: Number(cpuTotalMs.toFixed(2)),
      percentSingleCore: Number(cpuPercentOfSingleCore.toFixed(2)),
      percentMachine: Number(cpuPercentOfMachine.toFixed(2))
    },
    memory: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      arrayBuffersBytes: mem.arrayBuffers || 0
    }
  };

  costMetricsLastCpuUsage = cpuNow;
  costMetricsLastHrtimeNs = nowHr;
  costMetricsLastTotalMessages = totalMessages;
  latestCostMetrics = sample;
  costMetricsHistory.push(sample);
  if (costMetricsHistory.length > COST_METRICS_HISTORY_SIZE) {
    costMetricsHistory.splice(0, costMetricsHistory.length - COST_METRICS_HISTORY_SIZE);
  }

  return sample;
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
  costMetrics: {
    enabled: ENABLE_COST_METRICS,
    intervalMs: COST_METRICS_INTERVAL_MS,
    latest: latestCostMetrics
  },
  logs: logs.slice(-50).reverse() // 50 derniers logs, plus récent en premier
});

// HTTP minimal : handshake Engine.IO / Socket.IO uniquement sur SOCKET_IO_PATH
const server = createServer((req, res) => {
  const url = req.url || '';
  if (url === COST_METRICS_PATH || url.startsWith(`${COST_METRICS_PATH}?`)) {
    const requestUrl = new URL(url, 'http://localhost');
    const includeHistory = requestUrl.searchParams.get('history') === '1';
    const payload = {
      enabled: ENABLE_COST_METRICS,
      intervalMs: COST_METRICS_INTERVAL_MS,
      latest: latestCostMetrics,
      ...(includeHistory
        ? { history: costMetricsHistory.slice(-COST_METRICS_HISTORY_SIZE) }
        : {})
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
    return;
  }
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

const touchLobby = (code) => {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  lobby.lastActivityAt = Date.now();
  lobby.expiresAt = lobby.lastActivityAt + LOBBY_TTL_MS;
};

const touchGame = (code) => {
  const game = games.get(code);
  if (!game) return;
  game.lastActivityAt = Date.now();
  if (!game.finishedAt) {
    game.expiresAt = game.lastActivityAt + GAME_TTL_MS;
  }
};

const hasPresentPlayersInGame = (game) => {
  if (!game?.players || game.players.size === 0) return false;
  for (const player of game.players.values()) {
    if ((player?.status || 'active').toLowerCase() !== 'disconnected') {
      return true;
    }
  }
  return false;
};

const forEachConnectedGameRecipient = (game, callback, { exceptId = null } = {}) => {
  if (!game?.players) return;
  for (const player of game.players.values()) {
    if (!player?.id) continue;
    if (exceptId && player.id === exceptId) continue;
    if ((player.status || 'active').toLowerCase() === 'disconnected') continue;
    const playerSocket = socketsById.get(player.id);
    if (!playerSocket || !playerSocket.connected) continue;
    callback(playerSocket, player);
  }
};

const pruneDisconnectedGamePlayers = (game, now = Date.now()) => {
  if (!game?.players || game.players.size === 0) return 0;
  let removed = 0;
  for (const [id, player] of game.players.entries()) {
    if (!player) continue;
    if ((player.status || '').toLowerCase() !== 'disconnected') continue;
    const disconnectedAt =
      typeof player.disconnectedAt === 'number' ? player.disconnectedAt : now;
    if (now - disconnectedAt < DISCONNECTED_GAME_PLAYER_TTL_MS) continue;
    game.players.delete(id);
    removed += 1;
  }
  return removed;
};

const closeLobby = (code, reason = 'Lobby expiré', notify = true) => {
  const lobby = lobbies.get(code);
  if (!lobby) return false;
  if (notify) {
    lobby.players.forEach((player) => {
      const playerSocket = socketsById.get(player.id);
      send(playerSocket, { type: 'lobby:closed', payload: { code, reason } });
    });
  }
  if (disconnectedHosts.has(code)) {
    clearTimeout(disconnectedHosts.get(code).timeoutId);
    disconnectedHosts.delete(code);
  }
  if (awayHosts.has(code)) {
    clearTimeout(awayHosts.get(code).timeoutId);
    awayHosts.delete(code);
  }
  lobbies.delete(code);
  lobbySocketMessageCounts.delete(code);
  return true;
};

const closeGame = (code, reason = 'Partie expirée', notify = true) => {
  const game = games.get(code);
  if (!game) return false;
  const winnerType = game?.lastHostState?.gameDetails?.winner_type || null;
  const playerResults = Array.from(game.players.values()).map((player) => ({
    player_external_id: player.id,
    display_name_snapshot: player.name || 'Joueur',
    role: player.role ?? null,
    team: null,
    score: 0,
    kills: 0,
    deaths: 0,
    objectives_completed: 0,
    reward_xp: winnerType && String(player.role || '').toUpperCase() === String(winnerType).toUpperCase()
      ? 150
      : 50,
    is_winner: winnerType
      ? String(player.role || '').toUpperCase() === String(winnerType).toUpperCase()
      : false
  }));

  persistToBdd(`/api/games/${code}/end`, 'POST', {
    winner_side: winnerType,
    end_reason: reason
  });
  persistToBdd(`/api/games/${code}/results`, 'POST', {
    winning_side: winnerType,
    end_reason: reason,
    player_results: playerResults
  });

  if (notify) {
    game.players.forEach((player) => {
      const playerSocket = socketsById.get(player.id);
      send(playerSocket, { type: 'game:closed', payload: { code, reason } });
    });
  }
  if (disconnectedGameHosts.has(code)) {
    clearTimeout(disconnectedGameHosts.get(code).timeoutId);
    disconnectedGameHosts.delete(code);
  }
  games.delete(code);
  gameSocketMessageCounts.delete(code);
  return true;
};

const pickReplacementGameHost = (game, excludedId = null) => {
  if (!game) return null;
  const candidates = Array.from(game.players.values()).filter(
    (player) => player?.id && player.id !== excludedId
  );
  if (!candidates.length) return null;

  const connectedActive = candidates.find((player) => {
    const socket = socketsById.get(player.id);
    return socket?.connected && (player.status || 'active') === 'active';
  });
  if (connectedActive) return connectedActive.id;

  const connectedAny = candidates.find((player) => {
    const socket = socketsById.get(player.id);
    return socket?.connected;
  });
  if (connectedAny) return connectedAny.id;

  const activeAny = candidates.find((player) => (player.status || 'active') === 'active');
  if (activeAny) return activeAny.id;

  return candidates[0].id;
};

const transferGameHost = ({
  code,
  oldHostId,
  reason = 'Le host a quitté la partie'
}) => {
  const game = games.get(code);
  if (!game) return false;
  const newHostId = pickReplacementGameHost(game, oldHostId);
  if (!newHostId) return false;

  game.hostId = newHostId;
  game.players.forEach((player) => {
    player.isHost = player.id === newHostId;
  });

  if (disconnectedGameHosts.has(code)) {
    clearTimeout(disconnectedGameHosts.get(code).timeoutId);
    disconnectedGameHosts.delete(code);
  }

  game.players.forEach((player) => {
    const playerSocket = socketsById.get(player.id);
    if (playerSocket) {
      send(playerSocket, {
        type: 'game:host-transferred',
        payload: {
          code,
          oldHostId,
          newHostId,
          reason
        }
      });
      // Compat event déjà utilisé côté clients.
      send(playerSocket, {
        type: 'game:host-reconnected',
        payload: { newHostId }
      });
    }
  });
  markStateChanged('game:host-transfer', { code, oldHostId, newHostId, reason });
  return true;
};

const pickReplacementLobbyHost = (lobby, excludedId = null) => {
  if (!lobby) return null;
  const candidates = Array.from(lobby.players.values()).filter(
    (player) => player?.id && player.id !== excludedId
  );
  if (!candidates.length) return null;

  const connectedActive = candidates.find((player) => {
    const socket = socketsById.get(player.id);
    return socket?.connected && (player.status || 'active') === 'active';
  });
  if (connectedActive) return connectedActive.id;

  const connectedAny = candidates.find((player) => {
    const socket = socketsById.get(player.id);
    return socket?.connected;
  });
  if (connectedAny) return connectedAny.id;

  const activeAny = candidates.find((player) => (player.status || 'active') === 'active');
  if (activeAny) return activeAny.id;

  return candidates[0].id;
};

const transferLobbyHost = ({
  code,
  oldHostId,
  reason = 'Le host a quitté le lobby'
}) => {
  const lobby = lobbies.get(code);
  if (!lobby) return false;
  const newHostId = pickReplacementLobbyHost(lobby, oldHostId);
  if (!newHostId) return false;

  lobby.hostId = newHostId;
  lobby.players.forEach((player) => {
    player.isHost = player.id === newHostId;
  });

  if (disconnectedHosts.has(code)) {
    clearTimeout(disconnectedHosts.get(code).timeoutId);
    disconnectedHosts.delete(code);
  }
  if (awayHosts.has(code)) {
    clearTimeout(awayHosts.get(code).timeoutId);
    awayHosts.delete(code);
  }

  lobby.players.forEach((player) => {
    const playerSocket = socketsById.get(player.id);
    if (playerSocket) {
      if (oldHostId) {
        send(playerSocket, {
          type: 'lobby:peer-left',
          payload: { playerId: oldHostId }
        });
      }
      send(playerSocket, {
        type: 'lobby:host-transferred',
        payload: {
          code,
          oldHostId,
          newHostId,
          reason
        }
      });
      // Compat event already consumed by clients.
      send(playerSocket, {
        type: 'lobby:host-reconnected',
        payload: { newHostId }
      });
    }
  });
  markStateChanged('lobby:host-transfer', { code, oldHostId, newHostId, reason });
  return true;
};

const shouldLogLevel = (level) => {
  if (!ENABLE_SERVER_LOGS) return false;
  const requested = LOG_LEVEL_ORDER[level] ?? LOG_LEVEL_ORDER.info;
  const configured = LOG_LEVEL_ORDER[LOG_LEVEL] ?? LOG_LEVEL_ORDER.info;
  return requested <= configured;
};

const formatLogArg = (arg) => {
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg);
    } catch (_) {
      return '[unserializable-object]';
    }
  }
  return String(arg);
};

// Helper pour les logs horodatés
const logAt = (level, ...args) => {
  if (!shouldLogLevel(level)) return;
  const timestamp = new Date().toLocaleString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${args
    .map(formatLogArg)
    .join(' ')}`;
  
  console.log(`[${timestamp}] [${level.toUpperCase()}]`, ...args);
  
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

const log = (...args) => logAt('info', ...args);
const logWarn = (...args) => logAt('warn', ...args);
const logError = (...args) => logAt('error', ...args);
const logDebug = (...args) => logAt('debug', ...args);

let persistTimer = null;
let persistInFlight = false;
let persistQueued = false;
let eventLogFlushTimer = null;
let eventLogFlushInFlight = false;
const pendingEventLogLines = [];

const serializeLobby = (lobby) => ({
  code: lobby.code,
  hostId: lobby.hostId,
  stateVersion: lobby.stateVersion || 1,
  createdAt: lobby.createdAt || Date.now(),
  expiresAt: lobby.expiresAt || Date.now() + LOBBY_TTL_MS,
  config: lobby.config || null,
  players: Array.from(lobby.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    isHost: !!p.isHost,
    role: p.role ?? null,
    status: p.status ?? 'active'
  }))
});

const serializeGame = (game) => ({
  code: game.code,
  hostId: game.hostId,
  stateVersion: game.stateVersion || 1,
  createdAt: game.createdAt || Date.now(),
  expiresAt: game.expiresAt || Date.now() + GAME_TTL_MS,
  config: game.config || null,
  players: Array.from(game.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    isHost: !!p.isHost,
    role: p.role ?? null,
    status: p.status ?? 'active'
  })),
  remainingTimeSeconds:
    typeof game.remainingTimeSeconds === 'number' ? game.remainingTimeSeconds : null,
  remainingTimeUpdatedAt:
    typeof game.remainingTimeUpdatedAt === 'number' ? game.remainingTimeUpdatedAt : null,
  remainingTimeCountdownActive: !!game.remainingTimeCountdownActive,
  lastHostState: game.lastHostState || null,
  lastHostStateAt:
    typeof game.lastHostStateAt === 'number' ? game.lastHostStateAt : null,
  lastHostStateHostId: game.lastHostStateHostId || null,
  reconnectedPlayerIds: game.reconnectedPlayerIds || {}
});

const persistRuntimeStateNow = async (reason = 'unspecified') => {
  if (MEMORY_ONLY_MODE) return;
  if (persistInFlight) {
    persistQueued = true;
    return;
  }
  persistInFlight = true;
  try {
    await fs.mkdir(RUNTIME_DATA_DIR, { recursive: true });
    const snapshot = {
      version: 1,
      signalingVersion: SIGNALING_VERSION,
      savedAt: new Date().toISOString(),
      reason,
      lobbies: Array.from(lobbies.values()).map(serializeLobby),
      games: Array.from(games.values()).map(serializeGame),
      counters: {
        totalSocketMessages
      }
    };
    const tempPath = `${SNAPSHOT_FILE}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(snapshot), 'utf8');
    await fs.rename(tempPath, SNAPSHOT_FILE);
  } catch (error) {
    logError('[PERSIST] Erreur snapshot runtime:', error?.message || error);
  } finally {
    persistInFlight = false;
    if (persistQueued) {
      persistQueued = false;
      void persistRuntimeStateNow('queued-followup');
    }
  }
};

const schedulePersist = (reason = 'state-change') => {
  if (MEMORY_ONLY_MODE) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistRuntimeStateNow(reason);
  }, 500);
};

const flushRuntimeEvents = async () => {
  if (MEMORY_ONLY_MODE || pendingEventLogLines.length === 0 || eventLogFlushInFlight) {
    return;
  }
  eventLogFlushInFlight = true;
  const lines = pendingEventLogLines.splice(0, pendingEventLogLines.length);
  try {
    await fs.mkdir(RUNTIME_DATA_DIR, { recursive: true });
    await fs.appendFile(EVENT_LOG_FILE, `${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    logError('[PERSIST] Erreur event log:', error?.message || error);
    // Requeue to avoid losing events when temporary I/O issues happen.
    pendingEventLogLines.unshift(...lines);
  } finally {
    eventLogFlushInFlight = false;
    if (pendingEventLogLines.length > 0 && !eventLogFlushTimer) {
      eventLogFlushTimer = setTimeout(() => {
        eventLogFlushTimer = null;
        void flushRuntimeEvents();
      }, 250);
    }
  }
};

const appendRuntimeEvent = (type, payload = {}) => {
  if (MEMORY_ONLY_MODE) return;
  pendingEventLogLines.push(
    JSON.stringify({
      ts: Date.now(),
      type,
      payload
    })
  );
  if (!eventLogFlushTimer) {
    eventLogFlushTimer = setTimeout(() => {
      eventLogFlushTimer = null;
      void flushRuntimeEvents();
    }, 250);
  }
};

const markStateChanged = (type, payload = {}) => {
  appendRuntimeEvent(type, payload);
  schedulePersist(type);
};

const hydrateRuntimeState = async () => {
  if (MEMORY_ONLY_MODE) return;
  try {
    await fs.mkdir(RUNTIME_DATA_DIR, { recursive: true });
    const raw = await fs.readFile(SNAPSHOT_FILE, 'utf8');
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }
    lobbies.clear();
    games.clear();
    lobbySocketMessageCounts.clear();
    gameSocketMessageCounts.clear();

    for (const lobby of snapshot.lobbies || []) {
      if (!lobby?.code || !lobby?.hostId) continue;
      const playersMap = new Map();
      for (const p of lobby.players || []) {
        if (!p?.id) continue;
        playersMap.set(p.id, {
          id: p.id,
          name: p.name || 'Joueur',
          isHost: !!p.isHost,
          role: p.role ?? null,
          status: p.status || 'active'
        });
      }
      lobbies.set(lobby.code, {
        code: lobby.code,
        hostId: lobby.hostId,
        stateVersion:
          typeof lobby.stateVersion === 'number' && lobby.stateVersion > 0
            ? Math.floor(lobby.stateVersion)
            : 1,
        createdAt: typeof lobby.createdAt === 'number' ? lobby.createdAt : Date.now(),
        lastActivityAt: Date.now(),
        expiresAt:
          typeof lobby.expiresAt === 'number' && lobby.expiresAt > Date.now()
            ? lobby.expiresAt
            : Date.now() + LOBBY_TTL_MS,
        config: lobby.config || null,
        players: playersMap
      });
      lobbySocketMessageCounts.set(lobby.code, 0);
    }

    for (const game of snapshot.games || []) {
      if (!game?.code || !game?.hostId) continue;
      const playersMap = new Map();
      for (const p of game.players || []) {
        if (!p?.id) continue;
        playersMap.set(p.id, {
          id: p.id,
          name: p.name || 'Joueur',
          isHost: !!p.isHost,
          role: p.role ?? null,
          status: p.status || 'active'
        });
      }
      games.set(game.code, {
        code: game.code,
        hostId: game.hostId,
        stateVersion:
          typeof game.stateVersion === 'number' && game.stateVersion > 0
            ? Math.floor(game.stateVersion)
            : 1,
        createdAt: typeof game.createdAt === 'number' ? game.createdAt : Date.now(),
        lastActivityAt: Date.now(),
        expiresAt:
          typeof game.expiresAt === 'number' && game.expiresAt > Date.now()
            ? game.expiresAt
            : Date.now() + GAME_TTL_MS,
        config: game.config || null,
        players: playersMap,
        remainingTimeSeconds:
          typeof game.remainingTimeSeconds === 'number' ? game.remainingTimeSeconds : undefined,
        remainingTimeUpdatedAt:
          typeof game.remainingTimeUpdatedAt === 'number' ? game.remainingTimeUpdatedAt : undefined,
        remainingTimeCountdownActive: !!game.remainingTimeCountdownActive,
        lastHostState: game.lastHostState || null,
        lastHostStateAt:
          typeof game.lastHostStateAt === 'number' ? game.lastHostStateAt : null,
        lastHostStateHostId: game.lastHostStateHostId || null,
        reconnectedPlayerIds: game.reconnectedPlayerIds || {}
      });
      gameSocketMessageCounts.set(game.code, 0);
    }
    if (snapshot.counters && typeof snapshot.counters.totalSocketMessages === 'number') {
      totalSocketMessages = snapshot.counters.totalSocketMessages;
    }
    log(
      `[PERSIST] Etat runtime restaure: ${lobbies.size} lobby(s), ${games.size} game(s)`
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      log('[PERSIST] Erreur restauration runtime:', error?.message || error);
    }
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

const buildTurnCredentials = (clientId) => {
  if (!TURN_URLS.length || !TURN_SECRET) return null;
  const expiresAtSec = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${expiresAtSec}:${clientId}`;
  const credential = createHmac('sha1', TURN_SECRET)
    .update(username)
    .digest('base64');
  return {
    urls: TURN_URLS,
    username,
    credential,
    ttlSeconds: TURN_TTL_SECONDS,
    expiresAtMs: expiresAtSec * 1000,
    realm: TURN_REALM || null
  };
};

const getRawMessagePreview = (raw) => {
  if (typeof raw === 'string') {
    return raw.substring(0, 200);
  }
  if (raw && typeof raw === 'object') {
    const type = raw.type || 'unknown';
    return `[object type=${type}]`;
  }
  return String(raw).substring(0, 200);
};

const send = (socket, message) => {
  if (socket && socket.connected) {
    incrementTotalSocketMessages();
    const clientInfo = clients.get(socket.id);
    incrementLobbySocketMessages(clientInfo?.lobbyCode || null);
    const recipientId = clientInfo?.clientId || 'unknown';
    const finalMessage = enrichMessageWithVersion(message);
    if (Math.random() < MESSAGE_DEBUG_SAMPLE_RATE) {
      logDebug(
        `[MESSAGE ENVOYE] to=${recipientId} type=${finalMessage.type} version=${SIGNALING_VERSION}`
      );
    }
    socket.emit('message', finalMessage);
  }
};

const getLobbySnapshot = (lobby) => ({
  code: lobby.code,
  hostId: lobby.hostId,
  stateVersion: lobby.stateVersion || 1,
  config: lobby.config || null,
  players: Array.from(lobby.players.values()).map(({ id, name, isHost, role, status }) => ({
    id,
    name,
    isHost,
    role: role ?? null,
    status: status ?? 'active'
  }))
});

const countRolesInLobby = (lobby) => {
  let agents = 0;
  let rogues = 0;
  lobby.players.forEach((p) => {
    const role = (p.role || '').toUpperCase();
    if (role === 'AGENT') agents += 1;
    if (role === 'ROGUE') rogues += 1;
  });
  return { agents, rogues };
};

const applyLobbyRoleUpdate = ({
  lobby,
  targetId,
  role,
  requestId
}) => {
  const player = lobby.players.get(targetId);
  if (!player) {
    return false;
  }
  player.role = role;
  lobby.stateVersion = (lobby.stateVersion || 1) + 1;
  persistToBdd(`/api/games/${lobby.code}/players`, 'POST', {
    player_external_id: player.id,
    display_name_snapshot: player.name || 'Joueur',
    role: role ?? null,
    team: null,
    is_host: !!player.isHost,
    status: player.status || 'active'
  });
  persistToBdd(`/api/games/${lobby.code}/events`, 'POST', {
    events: [
      {
        event_type: 'lobby:role-updated',
        actor_external_id: targetId,
        payload_json: { role: role ?? null }
      }
    ]
  });
  lobby.players.forEach((p) => {
    const s = socketsById.get(p.id);
    if (s) {
      send(s, {
        type: 'lobby:role-updated',
        payload: {
          playerId: targetId,
          role,
          stateVersion: lobby.stateVersion,
          requestId: requestId || null
        }
      });
      // Compat backward with existing listeners.
      send(s, {
        type: 'lobby:player-updated',
        payload: {
          playerId: targetId,
          changes: { role: role },
          stateVersion: lobby.stateVersion
        }
      });
    }
  });
  return true;
};

const bumpGameStateVersion = (game) => {
  game.stateVersion = (game.stateVersion || 1) + 1;
  return game.stateVersion;
};

const sendGameActionRejected = (socket, action, requestId, reason) => {
  send(socket, {
    type: 'game:action-rejected',
    payload: {
      action,
      requestId: requestId || null,
      reason
    }
  });
};

const applyGameRemainingTimeUpdate = ({
  game,
  remaining,
  countdownStarted,
  hasCountdownStarted,
  requestId = null
}) => {
  game.remainingTimeSeconds = Math.max(0, Math.floor(remaining));
  game.remainingTimeUpdatedAt = Date.now();
  if (hasCountdownStarted) {
    game.remainingTimeCountdownActive = !!countdownStarted;
  }
  const stateVersion = bumpGameStateVersion(game);
  game.players.forEach((p) => {
    const s = socketsById.get(p.id);
    if (s) {
      send(s, {
        type: 'game:remaining-time-updated',
        payload: {
          remaining_time: game.remainingTimeSeconds,
          countdown_started: !!game.remainingTimeCountdownActive,
          stateVersion,
          requestId
        }
      });
    }
  });
  return stateVersion;
};

const applyGameStateSync = ({
  game,
  hostId,
  statePayload,
  targetId = null,
  requestId = null
}) => {
  const remainingTime = statePayload?.gameDetails?.remaining_time;
  if (typeof remainingTime === 'number') {
    game.remainingTimeSeconds = remainingTime;
    game.remainingTimeUpdatedAt = Date.now();
  }
  if (typeof statePayload?.gameDetails?.countdown_started === 'boolean') {
    game.remainingTimeCountdownActive = statePayload.gameDetails.countdown_started;
  }
  // Mode léger: le serveur stocke l'état fourni par le host sans recalcul métier.
  game.lastHostState = statePayload || null;
  game.lastHostStateAt = Date.now();
  game.lastHostStateHostId = hostId;
  const winnerType = statePayload?.gameDetails?.winner_type || null;
  const shouldCloseImmediately = Boolean(winnerType && !game.finishedAt);
  if (winnerType && !game.finishedAt) {
    game.finishedAt = Date.now();
    game.expiresAt = game.finishedAt + FINISHED_GAME_TTL_MS;
  }
  const stateVersion = bumpGameStateVersion(game);

  if (targetId) {
    const targetSocket = socketsById.get(targetId);
    if (targetSocket) {
      send(targetSocket, {
        type: 'state:sync',
        payload: statePayload
      });
    }
  } else {
    game.players.forEach((p) => {
      if (p.id === hostId) return;
      const s = socketsById.get(p.id);
      if (s) {
        send(s, {
          type: 'state:sync',
          payload: statePayload
        });
      }
    });
  }

  game.players.forEach((p) => {
    const s = socketsById.get(p.id);
    if (s) {
      send(s, {
        type: 'game:state-version',
        payload: {
          stateVersion,
          requestId
        }
      });
    }
  });

  if (shouldCloseImmediately) {
    const closedCode = game.code;
    closeGame(closedCode, 'Partie terminée', false);
    markStateChanged('game:finished-immediate', { code: closedCode });
  }

  return stateVersion;
};

const tryStartGameFromLobby = ({
  socket,
  clientId,
  code,
  requestId = null,
  requireRoleCheck = false
}) => {
  const lobby = lobbies.get(code);
  if (!code || !lobby) {
    const errorMessage = 'Lobby introuvable pour démarrer la partie.';
    if (requestId) {
      send(socket, {
        type: 'lobby:action-rejected',
        payload: { action: 'start-game', requestId, reason: errorMessage }
      });
    } else {
      send(socket, { type: 'game:error', payload: { message: errorMessage } });
    }
    return true;
  }

  if (lobby.hostId !== clientId) {
    const errorMessage = 'Seul le host peut démarrer la partie.';
    if (requestId) {
      send(socket, {
        type: 'lobby:action-rejected',
        payload: { action: 'start-game', requestId, reason: errorMessage }
      });
    } else {
      send(socket, { type: 'game:error', payload: { message: errorMessage } });
    }
    return true;
  }

  if (requireRoleCheck) {
    const { agents, rogues } = countRolesInLobby(lobby);
    if (agents < 1 || rogues < 1) {
      send(socket, {
        type: 'lobby:action-rejected',
        payload: {
          action: 'start-game',
          requestId,
          reason: 'Prerequis roles non satisfaits (>=1 AGENT et >=1 ROGUE).'
        }
      });
      return true;
    }
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
    return true;
  }

  const game = {
    code,
    hostId: lobby.hostId,
    config: lobby.config || null,
    players: new Map(),
    stateVersion: 1,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    expiresAt: Date.now() + GAME_TTL_MS
  };

  lobby.players.forEach((player) => {
    game.players.set(player.id, { ...player });
  });

  games.set(code, game);
  gameSocketMessageCounts.set(code, gameSocketMessageCounts.get(code) || 0);
  markStateChanged('game:create', { code, hostId: clientId });
  persistToBdd('/api/games', 'POST', {
    game_code: code,
    host_player_id: clientId,
    config_json: lobby.config || null
  });
  persistToBdd(`/api/games/${code}/start`, 'POST', {});
  game.players.forEach((player) => {
    persistGamePlayerToBdd(code, player);
  });
  persistToBdd(`/api/games/${code}/events`, 'POST', {
    events: [
      {
        event_type: 'game:created-from-lobby',
        actor_external_id: clientId,
        payload_json: { lobby_code: code }
      }
    ]
  });
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

  closeLobby(code, 'Partie démarrée', false);

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

  if (requestId) {
    send(socket, {
      type: 'lobby:action-ack',
      payload: { action: 'start-game', requestId, code }
    });
  }
  send(socket, {
    type: 'game:created',
    payload: {
      code,
      playerId: clientId,
      hostId: lobby.hostId,
      game: getLobbySnapshot(game)
    }
  });
  return true;
};

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
    if (Math.random() < MESSAGE_DEBUG_SAMPLE_RATE) {
      const rawPreview = getRawMessagePreview(raw);
      logDebug(
        `[MESSAGE BRUT RECU] client=${clientId} size=${rawPreview.length} preview=${rawPreview}`
      );
    }
    
    let message = raw;
    if (typeof raw === 'string') {
      try {
        message = JSON.parse(raw);
      } catch (error) {
        logWarn(`[ERREUR PARSING] client=${clientId} err=${error.message}`);
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
      logWarn(`[ERREUR MESSAGE] client=${clientId} missing-type`);
      send(socket, { type: 'error', payload: { message: 'Type de message manquant.' } });
      return;
    }
    if (Math.random() < MESSAGE_DEBUG_SAMPLE_RATE) {
      const payloadSize =
        payload && typeof payload === 'object' ? Object.keys(payload).length : 0;
      logDebug(
        `[MESSAGE RECU] client=${clientId} type=${type} payloadKeys=${payloadSize}`
      );
    }
    const clientInfo = clients.get(socket.id);
    const lobbyCodeForMessage = getLobbyCodeFromMessage(type, payload, clientInfo);
    const gameCodeForMessage = getGameCodeFromMessage(type, payload, clientInfo);
    if (lobbyCodeForMessage && lobbies.has(lobbyCodeForMessage)) {
      touchLobby(lobbyCodeForMessage);
    }
    if (gameCodeForMessage && games.has(gameCodeForMessage)) {
      touchGame(gameCodeForMessage);
    }
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
        config: payload?.gameConfig || null,
        stateVersion: 1,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        expiresAt: Date.now() + LOBBY_TTL_MS
      };

      lobby.players.set(clientId, { id: clientId, name: payload?.playerName || 'Host', isHost: true });
      lobbies.set(code, lobby);
      lobbySocketMessageCounts.set(code, lobbySocketMessageCounts.get(code) || 0);
      clients.get(socket.id).lobbyCode = code;

      log(`[LOBBY CRÉÉ] Code: ${code}, Host: ${clientId}, Nom: ${payload?.playerName || 'Host'}`);
      incrementLobbySocketMessages(code);
      markStateChanged('lobby:create', { code, hostId: clientId });
      persistToBdd('/api/games', 'POST', {
        game_code: code,
        host_player_id: clientId,
        config_json: payload?.gameConfig || null
      });
      persistToBdd(`/api/games/${code}/players`, 'POST', {
        player_external_id: clientId,
        display_name_snapshot: payload?.playerName || 'Host',
        role: null,
        team: null,
        is_host: true,
        status: 'active'
      });
      persistToBdd(`/api/games/${code}/events`, 'POST', {
        events: [
          {
            event_type: 'lobby:created',
            actor_external_id: clientId,
            payload_json: { code }
          }
        ]
      });

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

    if (type === 'turn:credentials-request') {
      const requestId = payload?.requestId || null;
      const turn = buildTurnCredentials(clientId);
      send(socket, {
        type: 'turn:credentials',
        payload: {
          requestId,
          urls: turn?.urls || [],
          username: turn?.username || null,
          credential: turn?.credential || null,
          ttlSeconds: turn?.ttlSeconds || 0,
          expiresAtMs: turn?.expiresAtMs || null,
          realm: turn?.realm || null
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
      markStateChanged('lobby:join', { code, playerId: clientId });
      persistToBdd(`/api/games/${code}/players`, 'POST', {
        player_external_id: clientId,
        display_name_snapshot: payload?.playerName || 'Joueur',
        role: null,
        team: null,
        is_host: false,
        status: 'active'
      });
      persistToBdd(`/api/games/${code}/events`, 'POST', {
        events: [
          {
            event_type: 'lobby:joined',
            actor_external_id: clientId,
            payload_json: { code }
          }
        ]
      });

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

    if (type === 'lobby:role-update-request') {
      const { lobbyCode } = clients.get(socket.id) || {};
      const requestId = payload?.requestId || null;
      const targetId = payload?.playerId || clientId;
      const role = payload?.role ?? null;
      if (!lobbyCode || !lobbies.has(lobbyCode)) {
        send(socket, {
          type: 'lobby:action-rejected',
          payload: {
            action: 'role-update',
            requestId,
            reason: 'Lobby introuvable.'
          }
        });
        return;
      }
      const lobby = lobbies.get(lobbyCode);
      if (lobby.hostId !== clientId) {
        send(socket, {
          type: 'lobby:action-rejected',
          payload: {
            action: 'role-update',
            requestId,
            reason: 'Seul le host peut modifier les roles.'
          }
        });
        return;
      }
      const applied = applyLobbyRoleUpdate({
        lobby,
        targetId,
        role,
        requestId
      });
      if (!applied) {
        send(socket, {
          type: 'lobby:action-rejected',
          payload: {
            action: 'role-update',
            requestId,
            reason: 'Joueur cible introuvable.'
          }
        });
        return;
      }
      markStateChanged('lobby:role-update-request', {
        code: lobbyCode,
        targetId,
        role,
        requestId
      });
      return;
    }

    if (type === 'lobby:config-update-request') {
      const { lobbyCode } = clients.get(socket.id) || {};
      const requestId = payload?.requestId || null;
      const incomingConfig =
        payload?.gameConfig && typeof payload.gameConfig === 'object'
          ? payload.gameConfig
          : null;
      if (!lobbyCode || !lobbies.has(lobbyCode)) {
        send(socket, {
          type: 'lobby:action-rejected',
          payload: {
            action: 'config-update',
            requestId,
            reason: 'Lobby introuvable.'
          }
        });
        return;
      }
      const lobby = lobbies.get(lobbyCode);
      if (lobby.hostId !== clientId) {
        send(socket, {
          type: 'lobby:action-rejected',
          payload: {
            action: 'config-update',
            requestId,
            reason: 'Seul le host peut modifier les paramètres.'
          }
        });
        return;
      }
      if (!incomingConfig) {
        send(socket, {
          type: 'lobby:action-rejected',
          payload: {
            action: 'config-update',
            requestId,
            reason: 'Configuration invalide.'
          }
        });
        return;
      }
      lobby.config = {
        ...(lobby.config && typeof lobby.config === 'object' ? lobby.config : {}),
        ...incomingConfig
      };
      lobby.stateVersion = (lobby.stateVersion || 1) + 1;
      lobby.players.forEach((p) => {
        const s = socketsById.get(p.id);
        if (s) {
          send(s, {
            type: 'lobby:config-updated',
            payload: {
              config: lobby.config,
              stateVersion: lobby.stateVersion,
              requestId
            }
          });
        }
      });
      markStateChanged('lobby:config-update-request', {
        code: lobbyCode,
        stateVersion: lobby.stateVersion,
        requestId
      });
      return;
    }

    if (type === 'lobby:start-game-request') {
      const { lobbyCode } = clients.get(socket.id) || {};
      const requestId = payload?.requestId || null;
      tryStartGameFromLobby({
        socket,
        clientId,
        code: lobbyCode?.toUpperCase(),
        requestId,
        requireRoleCheck: false
      });
      return;
    }

    if (type === 'game:create') {
      const code = payload?.code?.toUpperCase();
      tryStartGameFromLobby({
        socket,
        clientId,
        code,
        requireRoleCheck: false
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
          status: 'active',
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

        game.players.forEach((p) => {
          if (p.id === clientId) return;
          const s = socketsById.get(p.id);
          if (s) {
            send(s, {
              type: 'game:peer-joined',
              payload: {
                playerId: clientId,
                oldPlayerId,
                playerName: existingPlayer?.name || payload?.playerName || 'Joueur',
                role: existingPlayer?.role ?? null,
                status: 'active'
              }
            });
            send(s, {
              type: 'game:peer-reconnected',
              payload: {
                playerId: clientId,
                oldPlayerId,
                playerName: existingPlayer?.name || payload?.playerName || 'Joueur',
                role: existingPlayer?.role ?? null,
                status: 'active'
              }
            });
          }
        });
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

      game.players.forEach((p) => {
        if (p.id === clientId) return;
        const s = socketsById.get(p.id);
        if (s) {
          send(s, {
            type: 'game:peer-joined',
            payload: {
              playerId: clientId,
              playerName: payload?.playerName || 'Joueur',
              role: game.players.get(clientId)?.role ?? null,
              status: game.players.get(clientId)?.status || 'active'
            }
          });
        }
      });
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

    if (type === 'game:update-remaining-time-request') {
      const gameCode = clientInfo?.gameCode;
      const requestId = payload?.requestId || null;
      const remaining = payload?.remaining_time;
      if (!gameCode || !games.has(gameCode)) {
        sendGameActionRejected(socket, 'update-remaining-time', requestId, 'Partie introuvable.');
        return;
      }
      if (typeof remaining !== 'number') {
        sendGameActionRejected(socket, 'update-remaining-time', requestId, 'remaining_time invalide.');
        return;
      }
      const game = games.get(gameCode);
      if (clientInfo?.clientId !== game.hostId) {
        sendGameActionRejected(socket, 'update-remaining-time', requestId, 'Seul le host peut modifier le temps.');
        return;
      }
      const hasCountdownStarted = !!(payload && 'countdown_started' in payload);
      const stateVersion = applyGameRemainingTimeUpdate({
        game,
        remaining,
        countdownStarted: payload?.countdown_started,
        hasCountdownStarted,
        requestId
      });
      markStateChanged('game:update-remaining-time-request', {
        code: gameCode,
        remaining: game.remainingTimeSeconds,
        stateVersion,
        requestId
      });
      send(socket, {
        type: 'game:action-ack',
        payload: {
          action: 'update-remaining-time',
          requestId,
          stateVersion
        }
      });
      return;
    }

    if (type === 'game:update-remaining-time') {
      const gameCode = clientInfo?.gameCode;
      const remaining = payload?.remaining_time;
      if (gameCode && games.has(gameCode) && typeof remaining === 'number') {
        const game = games.get(gameCode);
        if (game && clientInfo?.clientId === game.hostId) {
          const stateVersion = applyGameRemainingTimeUpdate({
            game,
            remaining,
            countdownStarted: payload?.countdown_started,
            hasCountdownStarted: !!(payload && 'countdown_started' in payload)
          });
          markStateChanged('game:update-remaining-time', {
            code: gameCode,
            remaining: game.remainingTimeSeconds,
            stateVersion
          });
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
      // No recurrent /api/game-replay/snapshot call.
      return;
    }

    if (type === 'state:sync') {
      const targetId = payload?.targetId;
      const gameCode = clientInfo?.gameCode;
      const inner = payload?.payload;
      if (gameCode && games.has(gameCode)) {
        const game = games.get(gameCode);
        if (game && clientInfo?.clientId === game.hostId) {
          const stateVersion = applyGameStateSync({
            game,
            hostId: clientInfo.clientId,
            statePayload: inner,
            targetId: targetId || null
          });
          markStateChanged('game:state-sync', { code: gameCode, stateVersion });
          persistToBdd(`/api/games/${gameCode}/events`, 'POST', {
            events: [
              {
                event_type: 'game:state-sync',
                actor_external_id: clientInfo.clientId,
                payload_json: {
                  stateVersion,
                  targetId: targetId || null,
                  winner_type: inner?.gameDetails?.winner_type || null,
                  remaining_time: inner?.gameDetails?.remaining_time ?? null
                }
              }
            ]
          });
        }
      }
      if (targetId && !socketsById.get(targetId)) {
        log(`[ERREUR RESYNC] État sync vers ${targetId} échoué: destinataire introuvable`);
      }
      return;
    }

    if (type === 'game:state-sync-request') {
      const gameCode = clientInfo?.gameCode;
      const requestId = payload?.requestId || null;
      const targetId = payload?.targetId || null;
      const inner = payload?.payload || null;
      if (inner && typeof inner === 'object') {
        try {
          log(
            `[STATE_SYNC_REQUEST] ${clientId} -> ${gameCode} requestId=${requestId || 'n/a'} ` +
              `props=${Array.isArray(inner.props) ? inner.props.length : 0} ` +
              `players=${Array.isArray(inner.players) ? inner.players.length : 0}`
          );
          if (Array.isArray(inner.props)) {
            log('[STATE_SYNC_REQUEST][props]', prettyInspect(inner.props));
          }
          if (Array.isArray(inner.players)) {
            log('[STATE_SYNC_REQUEST][players]', prettyInspect(inner.players));
          }
        } catch (e) {
          log('[STATE_SYNC_REQUEST][debug] failed to inspect payload', e?.message || e);
        }
      }
      if (!gameCode || !games.has(gameCode)) {
        sendGameActionRejected(socket, 'state-sync', requestId, 'Partie introuvable.');
        return;
      }
      const game = games.get(gameCode);
      if (!game || clientInfo?.clientId !== game.hostId) {
        sendGameActionRejected(socket, 'state-sync', requestId, 'Seul le host peut synchroniser l etat.');
        return;
      }
      const stateVersion = applyGameStateSync({
        game,
        hostId: clientInfo.clientId,
        statePayload: inner,
        targetId,
        requestId
      });
      markStateChanged('game:state-sync-request', {
        code: gameCode,
        targetId,
        stateVersion
      });
      send(socket, {
        type: 'game:action-ack',
        payload: {
          action: 'state-sync',
          requestId,
          stateVersion
        }
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

      // Si c'est le host qui quitte, transférer le host si possible
      if (lobby.hostId === playerId) {
        lobby.players.delete(playerId);
        const transferred = transferLobbyHost({
          code,
          oldHostId: playerId,
          reason: 'Le host a quitté le lobby'
        });
        if (!transferred) {
          closeLobby(code, 'Le host a quitté le lobby');
        }
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
      markStateChanged('lobby:leave', { code, playerId });
      
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
        const leavingHost = game.players.get(playerId);
        if (leavingHost) {
          leavingHost.status = 'disconnected';
          leavingHost.disconnectedAt = Date.now();
          leavingHost.isHost = false;
        }
        const transferred = transferGameHost({
          code,
          oldHostId: playerId,
          reason: 'Le host a quitté la partie'
        });
        if (!transferred) {
          closeGame(code, 'Le host a quitté la partie');
        }
      } else {
        const leavingPlayer = game.players.get(playerId);
        if (leavingPlayer) {
          leavingPlayer.status = 'disconnected';
          leavingPlayer.disconnectedAt = Date.now();
        }
        forEachConnectedGameRecipient(
          game,
          (s) => {
            send(s, {
              type: 'game:peer-left',
              payload: { playerId }
            });
          },
          { exceptId: playerId }
        );
      }

      const clientInfo = clients.get(socket.id);
      if (clientInfo) {
        clientInfo.gameCode = null;
      }
      markStateChanged('game:leave', { code, playerId });
      return;
    }

    if (type === 'player:status-update') {
      const { lobbyCode, gameCode } = clients.get(socket.id) || {};
      if (gameCode && games.has(gameCode)) {
        const game = games.get(gameCode);
        const player = game.players.get(clientId);
        if (player) {
          player.status = payload?.status || 'active';
          if ((player.status || '').toLowerCase() === 'disconnected') {
            player.disconnectedAt = Date.now();
          } else {
            player.disconnectedAt = null;
          }
          markStateChanged('game:player-status-update', {
            code: gameCode,
            playerId: clientId,
            status: player.status
          });
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
        markStateChanged('lobby:player-status-update', {
          code: lobbyCode,
          playerId: clientId,
          status: player.status
        });
        
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
                  const oldHostId = currentLobby.hostId;
                  currentLobby.players.delete(oldHostId);
                  const transferred = transferLobbyHost({
                    code: lobbyCode,
                    oldHostId,
                    reason: 'Host absent trop longtemps, transfert automatique'
                  });
                  if (!transferred) {
                    closeLobby(lobbyCode, 'Host absent depuis trop longtemps');
                  }
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

    if (type === 'game:player-status-update-request') {
      const { gameCode } = clients.get(socket.id) || {};
      const requestId = payload?.requestId || null;
      const targetId = payload?.playerId || clientId;
      const requestedStatus = payload?.status;
      const status = typeof requestedStatus === 'string' && requestedStatus.trim()
        ? requestedStatus.trim()
        : 'active';
      if (!gameCode || !games.has(gameCode)) {
        sendGameActionRejected(socket, 'player-status-update', requestId, 'Partie introuvable.');
        return;
      }
      const game = games.get(gameCode);
      const isHost = game.hostId === clientId;
      if (!isHost && targetId !== clientId) {
        sendGameActionRejected(
          socket,
          'player-status-update',
          requestId,
          'Seul le host peut modifier un autre joueur.'
        );
        return;
      }
      const player = game.players.get(targetId);
      if (!player) {
        sendGameActionRejected(socket, 'player-status-update', requestId, 'Joueur introuvable.');
        return;
      }
      player.status = status;
      if ((status || '').toLowerCase() === 'disconnected') {
        player.disconnectedAt = Date.now();
      } else {
        player.disconnectedAt = null;
      }
      const stateVersion = bumpGameStateVersion(game);
      game.players.forEach((p) => {
        const s = socketsById.get(p.id);
        if (s) {
          send(s, {
            type: 'game:player-updated',
            payload: {
              playerId: targetId,
              changes: { status },
              stateVersion,
              requestId
            }
          });
        }
      });
      markStateChanged('game:player-status-update-request', {
        code: gameCode,
        playerId: targetId,
        status,
        stateVersion,
        requestId
      });
      send(socket, {
        type: 'game:action-ack',
        payload: {
          action: 'player-status-update',
          requestId,
          stateVersion
        }
      });
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
      markStateChanged('lobby:chat', { code: lobbyCode, playerId: clientId });
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
      const requestId = payload?.requestId || null;

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
        if (lobby.hostId !== clientId) {
          send(socket, {
            type: 'lobby:action-rejected',
            payload: {
              action: 'role-update',
              requestId,
              reason: 'Seul le host peut modifier les roles.'
            }
          });
          return;
        }
        const applied = applyLobbyRoleUpdate({
          lobby,
          targetId,
          role,
          requestId
        });
        if (!applied) {
          send(socket, {
            type: 'lobby:action-rejected',
            payload: {
              action: 'role-update',
              requestId,
              reason: 'Joueur cible introuvable.'
            }
          });
          return;
        }
        markStateChanged('lobby:player-role-update', {
          code: lobbyCode,
          targetId,
          role
        });
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
              const hostPlayer = currentGame.players.get(clientInfo.clientId);
              if (hostPlayer) {
                hostPlayer.status = 'disconnected';
                hostPlayer.disconnectedAt = Date.now();
                hostPlayer.isHost = false;
              }
              const transferred = transferGameHost({
                code: gameCode,
                oldHostId: clientInfo.clientId,
                reason: 'Host déconnecté, transfert automatique'
              });
              if (!transferred) {
                closeGame(gameCode, 'Timeout de reconnexion du host dépassé');
              }
            }
          }
        }, 5 * 60 * 1000);

        disconnectedGameHosts.set(gameCode, {
          hostId: clientInfo.clientId,
          timeoutId,
          disconnectedAt: Date.now()
        });
      } else {
        const player = game.players.get(clientInfo.clientId);
        if (player) {
          player.status = 'disconnected';
          player.disconnectedAt = Date.now();
        }
        forEachConnectedGameRecipient(
          game,
          (s) => {
            send(s, {
              type: 'game:peer-left',
              payload: { playerId: clientInfo.clientId }
            });
          },
          { exceptId: clientInfo.clientId }
        );
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
            const currentLobby = lobbies.get(lobbyCode);
            if (currentLobby) {
              currentLobby.players.delete(clientInfo.clientId);
              const transferred = transferLobbyHost({
                code: lobbyCode,
                oldHostId: clientInfo.clientId,
                reason: 'Host déconnecté, transfert automatique'
              });
              if (!transferred) {
                closeLobby(lobbyCode, 'Timeout de reconnexion du host dépassé');
              }
            }
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

await hydrateRuntimeState();

setInterval(() => {
  const now = Date.now();
  for (const [code, lobby] of lobbies.entries()) {
    if (typeof lobby.expiresAt === 'number' && lobby.expiresAt <= now) {
      log(`[TTL] Fermeture lobby expiré: ${code}`);
      closeLobby(code, 'Lobby expiré');
      markStateChanged('lobby:expired', { code });
    }
  }
  for (const [code, game] of games.entries()) {
    const prunedPlayers = pruneDisconnectedGamePlayers(game, now);
    if (prunedPlayers > 0) {
      logDebug(`[TTL] Nettoyage joueurs disconnected: game=${code} removed=${prunedPlayers}`);
      markStateChanged('game:disconnected-player-pruned', {
        code,
        removed: prunedPlayers
      });
    }

    if (game.finishedAt) {
      log(`[TTL] Fermeture immédiate partie terminée: ${code}`);
      closeGame(code, 'Partie terminée', false);
      markStateChanged('game:finished-immediate-sweep', { code });
      continue;
    }

    if (!hasPresentPlayersInGame(game)) {
      const lastActivityAt =
        typeof game.lastActivityAt === 'number' ? game.lastActivityAt : now;
      if (now - lastActivityAt >= EMPTY_GAME_TTL_MS) {
        log(`[TTL] Fermeture partie inactive sans joueurs: ${code}`);
        closeGame(code, 'Partie inactive sans joueurs');
        markStateChanged('game:expired-empty', { code });
        continue;
      }
    }

    if (typeof game.expiresAt === 'number' && game.expiresAt <= now) {
      log(`[TTL] Fermeture partie expirée: ${code}`);
      closeGame(code, game.finishedAt ? 'Partie terminée' : 'Partie expirée');
      markStateChanged('game:expired', { code, finished: !!game.finishedAt });
    }
  }
}, 30000).unref();

if (!MEMORY_ONLY_MODE) {
  setInterval(() => {
    schedulePersist('periodic');
  }, 15000).unref();
}

const gracefulPersistAndExit = async (signal) => {
  if (!MEMORY_ONLY_MODE) {
    if (eventLogFlushTimer) {
      clearTimeout(eventLogFlushTimer);
      eventLogFlushTimer = null;
    }
    await flushRuntimeEvents();
  }
  if (!MEMORY_ONLY_MODE) {
    log(`[PERSIST] Signal ${signal} reçu, sauvegarde de l'état runtime...`);
    await persistRuntimeStateNow(`signal:${signal}`);
  }
  process.exit(0);
};

process.on('SIGINT', () => {
  void gracefulPersistAndExit('SIGINT');
});
process.on('SIGTERM', () => {
  void gracefulPersistAndExit('SIGTERM');
});

if (ENABLE_COST_METRICS) {
  buildCostMetricsSample();
  setInterval(() => {
    const sample = buildCostMetricsSample();
    log('[COST_METRICS]', sample);
  }, COST_METRICS_INTERVAL_MS).unref();
}

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
