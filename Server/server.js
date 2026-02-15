import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

// Charger les variables d'environnement depuis le fichier .env
dotenv.config();

const PORT = process.env.SIGNALING_PORT || 5174;
const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || '/socket.io';

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

// Créer le serveur HTTP avec un gestionnaire de requêtes
const server = createServer((req, res) => {
  // Gérer les requêtes OPTIONS pour CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // API endpoint pour les statistiques
  if (req.method === 'GET' && req.url === '/api/stats') {
    const stats = getServerStats();
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(stats));
    return;
  }

  // API endpoint pour les données d'une game (pour la modal live)
  const gameMatch = req.url && req.url.match(/^\/api\/stats\/game\/([A-Za-z0-9]+)/);
  if (req.method === 'GET' && gameMatch) {
    const code = gameMatch[1].toUpperCase();
    const game = games.get(code);
    if (!game) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Game not found', code }));
      return;
    }
    const gameData = {
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
      players: Array.from(game.players.values()).map(player => {
        const socket = socketsById.get(player.id);
        return {
          ...player,
          socketConnected: Boolean(socket?.connected),
          status: player.status || 'active'
        };
      })
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(gameData));
    return;
  }

  // API: envoyer une notification à un joueur (clientId)
  if (req.method === 'POST' && req.url === '/api/notify/player') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const clientId = data.clientId;
        const message = data.message != null ? String(data.message) : '';
        const title = data.title != null ? String(data.title) : undefined;
        if (!clientId) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'clientId requis' }));
          return;
        }
        const socket = socketsById.get(clientId);
        if (!socket || !socket.connected) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'Joueur introuvable ou déconnecté' }));
          return;
        }
        send(socket, { type: 'admin:notification', payload: { message, title, timestamp: Date.now() } });
        log(`[NOTIFICATION] Envoyée au joueur ${clientId.substring(0, 8)}...`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // API: envoyer une notification à tous les joueurs d'une partie
  if (req.method === 'POST' && req.url === '/api/notify/game') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const gameCode = data.gameCode != null ? String(data.gameCode).toUpperCase() : '';
        const message = data.message != null ? String(data.message) : '';
        const title = data.title != null ? String(data.title) : undefined;
        if (!gameCode) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'gameCode requis' }));
          return;
        }
        const game = games.get(gameCode);
        if (!game) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'Partie introuvable' }));
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
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, count }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Page de monitoring accessible via HTTP
  if (req.method === 'GET') {
    const stats = getServerStats();

    const protoHeader = req.headers['x-forwarded-proto'];
    const protocol = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader || 'http';

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Serveur WebRTC - Monitoring</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      color: white;
      text-align: center;
      margin-bottom: 30px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }
    .card {
      background: white;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .card h2 {
      color: #667eea;
      margin-bottom: 15px;
      border-bottom: 2px solid #667eea;
      padding-bottom: 10px;
    }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-box .number {
      font-size: 2.5em;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .stat-box .label {
      font-size: 0.9em;
      opacity: 0.9;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e0e0e0;
      color: #000;
    }
    th {
      background-color: #f5f5f5;
      font-weight: 600;
      color: #667eea;
    }
    tr:hover {
      background-color: #f9f9f9;
    }
    .status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
      animation: fadeIn 0.3s ease-in;
    }
    .status.connected {
      background-color: #4caf50;
      color: white;
      box-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
    }
    .status.disconnected {
      background-color: #f44336;
      color: white;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.8); }
      to { opacity: 1; transform: scale(1); }
    }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .info-item:last-child {
      border-bottom: none;
    }
    .info-label {
      font-weight: 600;
      color: #555;
    }
    .info-value {
      color: #000;
    }
    .refresh-btn {
      position: fixed;
      bottom: 30px;
      right: 30px;
      background: #667eea;
      color: white;
      border: none;
      padding: 15px 30px;
      border-radius: 50px;
      font-size: 1em;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 6px rgba(0,0,0,0.2);
      transition: all 0.3s;
    }
    .refresh-btn:hover {
      background: #764ba2;
      transform: translateY(-2px);
      box-shadow: 0 6px 8px rgba(0,0,0,0.3);
    }
    .no-data {
      text-align: center;
      color: #999;
      padding: 20px;
      font-style: italic;
    }
    .player-list {
      margin-left: 20px;
      font-size: 0.9em;
      color: #000;
    }
    .reconnection-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
      background-color: #ff9800;
      color: white;
      margin-left: 8px;
    }
    .logs-container {
      background: #1e1e1e;
      border-radius: 8px;
      padding: 15px;
      max-height: 500px;
      overflow-y: auto;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 0.85em;
    }
    .log-entry {
      color: #d4d4d4;
      padding: 4px 0;
      border-bottom: 1px solid #333;
      line-height: 1.6;
    }
    .log-entry:last-child {
      border-bottom: none;
    }
    .log-entry:hover {
      background-color: #2d2d2d;
    }
    .log-connexion { color: #4ec9b0; }
    .log-message { color: #9cdcfe; }
    .log-lobby { color: #4caf50; }
    .log-erreur { color: #f44336; }
    .log-webrtc { color: #ce9178; }
    .log-notification { color: #9c27b0; }
    .log-deconnexion { color: #ff9800; }
    .log-avertissement { color: #ffc107; }
    .logs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .logs-count {
      background: #667eea;
      color: white;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.9em;
    }
    .live-badge {
      display: inline-block;
      background: #f44336;
      color: white;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 0.9em;
      font-weight: 600;
      margin-left: 15px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .modal-overlay.open { display: flex; }
    .modal-box {
      background: white;
      border-radius: 12px;
      max-width: 720px;
      width: 100%;
      max-height: 90vh;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    }
    .modal-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-header h3 { margin: 0; font-size: 1.05em; }
    .modal-close {
      background: rgba(255,255,255,0.25);
      border: none;
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 1.2em;
      line-height: 1;
    }
    .modal-close:hover { background: rgba(255,255,255,0.4); }
    .modal-body {
      padding: 16px 20px;
      overflow-y: auto;
      max-height: calc(90vh - 54px);
      font-size: 0.9em;
    }
    .modal-body .loading { color: #667eea; }
    .modal-body .error { color: #f44336; }
    .dash-kpis {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    @media (max-width: 500px) {
      .dash-kpis { grid-template-columns: repeat(2, 1fr); }
      .modal-box { max-width: 100%; }
    }
    .dash-kpi {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 10px 12px;
      border-radius: 8px;
      text-align: center;
    }
    .dash-kpi .dash-kpi-val { font-size: 1.1em; font-weight: 700; }
    .dash-kpi .dash-kpi-lbl { font-size: 0.75em; opacity: 0.9; }
    .dash-section {
      margin-bottom: 14px;
    }
    .dash-section h4 {
      color: #667eea;
      margin: 0 0 8px 0;
      padding-bottom: 4px;
      border-bottom: 1px solid #e0e0e0;
      font-size: 0.95em;
    }
    .dash-section table { width: 100%; font-size: 0.88em; }
    .dash-section th, .dash-section td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; }
    .dash-section th { background: #f5f5f5; color: #555; }
    .dash-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; }
    .dash-badge.phase-lobby { background: #e3f2fd; color: #1565c0; }
    .dash-badge.phase-start { background: #fff3e0; color: #e65100; }
    .dash-badge.phase-running { background: #e8f5e9; color: #2e7d32; }
    .dash-badge.phase-done { background: #fce4ec; color: #c2185b; }
    .dash-badge.role-agent { background: #e3f2fd; color: #0d47a1; }
    .dash-badge.role-rogue { background: #ffebee; color: #b71c1c; }
    .dash-badge.ok { background: #e8f5e9; color: #2e7d32; }
    .dash-badge.no { background: #ffebee; color: #c62828; }
    .dash-badge.socket-ok { background: #e8f5e9; color: #1b5e20; }
    .dash-badge.socket-ko { background: #ffebee; color: #b71c1c; }
    .dash-muted { color: #999; font-size: 0.9em; }
    .btn-game-data {
      background: #667eea;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .btn-game-data:hover { background: #764ba2; }
    .dash-section textarea, .dash-section input[type="text"] { width: 100%; max-width: 100%; box-sizing: border-box; padding: 8px; margin: 4px 0; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 0.9em; }
    .dash-section #gameModalNotifyBtn, .notify-form button { margin-top: 6px; }
    .notify-form { margin-top: 12px; }
    .notify-form select { width: 100%; padding: 8px; margin: 4px 0; border: 1px solid #e0e0e0; border-radius: 6px; font-size: 0.9em; box-sizing: border-box; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Serveur de Signalisation WebRTC - Monitoring <span class="live-badge">🔴 LIVE</span></h1>
    
    <div class="stat-grid">
      <div class="stat-box">
        <div class="number">${stats.connectedClients}</div>
        <div class="label">Clients Connectés</div>
      </div>
      <div class="stat-box">
        <div class="number">${stats.activeLobbies}</div>
        <div class="label">Lobbies Actifs</div>
      </div>
      <div class="stat-box">
        <div class="number">${stats.activeGames}</div>
        <div class="label">Games en cours</div>
      </div>
      <div class="stat-box">
        <div class="number">${stats.totalSocketMessages}</div>
        <div class="label">Messages Socket Totaux</div>
      </div>
      <div class="stat-box">
        <div class="number">${Math.floor(stats.serverInfo.uptime / 60)}m</div>
        <div class="label">Temps d'Activité</div>
      </div>
      <div class="stat-box">
        <div class="number">${Math.round(stats.serverInfo.memoryUsage.heapUsed / 1024 / 1024)}MB</div>
        <div class="label">Mémoire Utilisée</div>
      </div>
    </div>

    <div class="card">
      <h2>📡 Informations Serveur</h2>
      <div class="info-item">
        <span class="info-label">Port:</span>
        <span class="info-value">${stats.serverInfo.port}</span>
      </div>
      <div class="info-item">
        <span class="info-label">URL Socket.io:</span>
        <span class="info-value">${protocol}://${req.headers.host}${SOCKET_IO_PATH}</span>
      </div>
      <div class="info-item">
        <span class="info-label">URL HTTP:</span>
        <span class="info-value">${protocol}://${req.headers.host}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Version Node.js:</span>
        <span class="info-value">${stats.serverInfo.nodeVersion}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Plateforme:</span>
        <span class="info-value">${stats.serverInfo.platform}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Hôte de la Requête:</span>
        <span class="info-value">${req.headers.host}</span>
      </div>
      <div class="info-item">
        <span class="info-label">User Agent:</span>
        <span class="info-value">${req.headers['user-agent'] || 'N/A'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">IP Client:</span>
        <span class="info-value">${req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'N/A'}</span>
      </div>
    </div>

    <div class="card" id="clientsCard">
      <h2>👥 Clients Socket.io Connectés</h2>
      ${stats.clients.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Client ID</th>
              <th>Lobby</th>
              <th>Game</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            ${stats.clients.map(client => `
              <tr>
                <td><code>${client.clientId.substring(0, 8)}...</code></td>
                <td>${client.lobbyCode}</td>
                <td>${client.gameCode}</td>
                <td>
                  <span class="status ${client.connected ? 'connected' : 'disconnected'}">
                    ${client.connected ? '🟢 Connecté' : '🔴 Déconnecté'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<div class="no-data">Aucun client connecté actuellement</div>'}
    </div>

    <div class="card" id="lobbiesCard">
      <h2>🎮 Lobbies Actifs</h2>
      ${stats.lobbies.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Code Lobby</th>
              <th>Host ID</th>
              <th>Joueurs</th>
              <th>Messages</th>
              <th>Détails</th>
            </tr>
          </thead>
          <tbody>
            ${stats.lobbies.map(lobby => `
              <tr>
                <td>
                  <strong>${lobby.code}</strong>
                  ${lobby.hostDisconnected ? `<span class="reconnection-badge">⏱️ ${lobby.reconnectionTimeout}s</span>` : ''}
                  ${lobby.hostAway ? `<span class="reconnection-badge" style="background-color: #dc3545;">🔴 ${lobby.awayTimeout}s</span>` : ''}
                </td>
                <td><code>${lobby.hostId.substring(0, 8)}...</code></td>
                <td>${lobby.playerCount}</td>
                <td>${lobby.socketMessageCount}</td>
                <td>
                  <div class="player-list">
                    ${lobby.players.map(p => {
                      const isDisconnected = p.status === 'disconnected' || !p.socketConnected;
                      const isAway = p.status === 'away';
                      const icon = isDisconnected ? '🔴' : (isAway ? '🟠' : '🟢');
                      const badge = isDisconnected ? '❌' : (isAway ? '💤' : '');
                      const opacity = isDisconnected ? '0.4' : (isAway ? '0.6' : '1');
                      const roleLabel = p.role ? ` [${p.role}]` : ' [n/a]';
                      return `
                        <div style="margin: 2px 0; opacity: ${opacity};">
                          ${icon} ${p.name}${roleLabel} ${p.isHost ? '👑' : ''} ${badge}
                        </div>
                      `;
                    }).join('')}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<div class="no-data">Aucun lobby actif actuellement</div>'}
    </div>

    <div class="card" id="gamesCard">
      <h2>🎯 Games en cours</h2>
      ${stats.games.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Code Game</th>
              <th>Host ID</th>
              <th>Joueurs</th>
              <th>Messages</th>
              <th>Temps restant</th>
              <th>Détails</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${stats.games.map(game => `
              <tr>
                <td><strong>${game.code}</strong></td>
                <td><code>${game.hostId.substring(0, 8)}...</code></td>
                <td>${game.playerCount}</td>
                <td>${game.socketMessageCount}</td>
                <td><strong>${formatRemainingTime(game.remainingTimeSeconds)}</strong></td>
                <td>
                  <div class="player-list">
                    ${game.players.map(p => {
                      const isDisconnected = p.status === 'disconnected' || !p.socketConnected;
                      const isAway = p.status === 'away';
                      const icon = isDisconnected ? '🔴' : (isAway ? '🟠' : '🟢');
                      const badge = isDisconnected ? '❌' : (isAway ? '💤' : '');
                      const opacity = isDisconnected ? '0.4' : (isAway ? '0.6' : '1');
                      const roleLabel = p.role ? ` [${p.role}]` : ' [n/a]';
                      return `
                        <div style="margin: 2px 0; opacity: ${opacity};">
                          ${icon} ${p.name}${roleLabel} ${p.isHost ? '👑' : ''} ${badge}
                        </div>
                      `;
                    }).join('')}
                  </div>
                </td>
                <td><button type="button" class="btn-game-data" data-game-code="${game.code}">📊 Tableau de bord</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<div class="no-data">Aucune game en cours</div>'}
    </div>

    <div class="card" id="notifyCard">
      <h2>📤 Envoi de notifications</h2>
      <p style="margin-bottom:12px;color:#555;font-size:0.9em;">Envoyer une notification aux clients via le canal de signalisation (Socket.io). Les clients reçoivent un message de type <code>admin:notification</code> avec <code>payload: { message, title?, timestamp }</code>.</p>
      <div class="notify-form">
        <h4 style="color:#667eea;margin:0 0 8px 0;font-size:0.95em;">À un joueur</h4>
        <select id="notifyPlayerSelect"><option value="">— Choisir un joueur —</option></select>
        <textarea id="notifyPlayerMsg" rows="2" placeholder="Message…"></textarea>
        <input type="text" id="notifyPlayerTitle" placeholder="Titre (optionnel)" />
        <button type="button" id="notifyPlayerBtn" class="btn-game-data">Envoyer au joueur</button>
      </div>
      <div class="notify-form">
        <h4 style="color:#667eea;margin:0 0 8px 0;font-size:0.95em;">À tous les joueurs d'une partie</h4>
        <select id="notifyGameSelect"><option value="">— Choisir une partie —</option></select>
        <textarea id="notifyGameMsg" rows="2" placeholder="Message…"></textarea>
        <input type="text" id="notifyGameTitle" placeholder="Titre (optionnel)" />
        <button type="button" id="notifyGameBtn" class="btn-game-data">Envoyer à la partie</button>
      </div>
    </div>

    <div class="modal-overlay" id="gameModal">
      <div class="modal-box">
        <div class="modal-header">
          <h3 id="gameModalTitle">Tableau de bord — </h3>
          <button type="button" class="modal-close" id="gameModalClose" aria-label="Fermer">×</button>
        </div>
        <div class="modal-body" id="gameModalBody">
          <div id="gameModalDashboard"><span class="loading">Chargement…</span></div>
          <div class="dash-section" id="gameModalNotify">
            <h4>📤 Envoyer une notification à tous les joueurs</h4>
            <textarea id="gameModalNotifyMsg" rows="2" placeholder="Message…"></textarea>
            <input type="text" id="gameModalNotifyTitle" placeholder="Titre (optionnel)" />
            <button type="button" id="gameModalNotifyBtn">Envoyer</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card" id="logsCard">
      <div class="logs-header">
        <h2>📋 Logs Serveur</h2>
        <span class="logs-count">${stats.logs.length} logs</span>
      </div>
      <div class="logs-container">
        ${stats.logs.length > 0 ? 
          stats.logs.map(log => {
            const message = log.message;
            let className = 'log-entry';
            
            if (message.includes('[CONNEXION]')) className += ' log-connexion';
            else if (message.includes('[MESSAGE')) className += ' log-message';
            else if (message.includes('[LOBBY CRÉÉ]') || message.includes('[LOBBY REJOINT]')) className += ' log-lobby';
            else if (message.includes('[ERREUR]')) className += ' log-erreur';
            else if (message.includes('[WEBRTC]')) className += ' log-webrtc';
            else if (message.includes('[NOTIFICATION]')) className += ' log-notification';
            else if (message.includes('[DÉCONNEXION]') || message.includes('[LOBBY FERMÉ]') || message.includes('[JOUEUR PARTI]')) className += ' log-deconnexion';
            else if (message.includes('[AVERTISSEMENT]')) className += ' log-avertissement';
            
            return `<div class="${className}">${message}</div>`;
          }).join('')
        : '<div class="no-data">Aucun log disponible</div>'}
      </div>
    </div>

  </div>

  <script>
    let lastLogCount = 0;
    let gameModalPollId = null;

    const formatRemainingTime = (seconds) => {
      if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
        return 'n/a';
      }
      const safeSeconds = Math.max(0, Math.floor(seconds));
      const minutes = Math.floor(safeSeconds / 60);
      const remainingSeconds = safeSeconds % 60;
      return minutes + ':' + String(remainingSeconds).padStart(2, '0');
    };
    
    // Fonction pour mettre à jour les statistiques
    async function updateStats() {
      try {
        const response = await fetch('/api/stats');
        const stats = await response.json();
        
        // Mettre à jour les statistiques principales
        document.querySelectorAll('.stat-box')[0].querySelector('.number').textContent = stats.connectedClients;
        document.querySelectorAll('.stat-box')[1].querySelector('.number').textContent = stats.activeLobbies;
        document.querySelectorAll('.stat-box')[2].querySelector('.number').textContent = stats.activeGames;
        document.querySelectorAll('.stat-box')[3].querySelector('.number').textContent = stats.totalSocketMessages;
        document.querySelectorAll('.stat-box')[4].querySelector('.number').textContent = Math.floor(stats.serverInfo.uptime / 60) + 'm';
        document.querySelectorAll('.stat-box')[5].querySelector('.number').textContent = Math.round(stats.serverInfo.memoryUsage.heapUsed / 1024 / 1024) + 'MB';
        
        // Mettre à jour les clients
        const clientsCard = document.getElementById('clientsCard');
        if (stats.clients.length > 0) {
          const clientsHTML = \`
            <table>
              <thead>
                <tr>
                  <th>Client ID</th>
                  <th>Lobby</th>
                  <th>Game</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                \${stats.clients.map(client => \`
                  <tr>
                    <td><code>\${client.clientId.substring(0, 8)}...</code></td>
                    <td>\${client.lobbyCode}</td>
                    <td>\${client.gameCode}</td>
                    <td>
                      <span class="status \${client.connected ? 'connected' : 'disconnected'}">
                        \${client.connected ? '🟢 Connecté' : '🔴 Déconnecté'}
                      </span>
                    </td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          \`;
          clientsCard.innerHTML = '<h2>👥 Clients Socket.io Connectés</h2>' + clientsHTML;
        } else {
          clientsCard.innerHTML = '<h2>👥 Clients Socket.io Connectés</h2><div class="no-data">Aucun client connecté actuellement</div>';
        }
        
        // Mettre à jour les lobbies
        const lobbiesCard = document.getElementById('lobbiesCard');
        if (stats.lobbies.length > 0) {
          const lobbiesHTML = \`
            <table>
              <thead>
                <tr>
                  <th>Code Lobby</th>
                  <th>Host ID</th>
                  <th>Joueurs</th>
                  <th>Messages</th>
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                \${stats.lobbies.map(lobby => \`
                  <tr>
                    <td>
                      <strong>\${lobby.code}</strong>
                      \${lobby.hostDisconnected ? \`<span class="reconnection-badge">⏱️ \${lobby.reconnectionTimeout}s</span>\` : ''}
                      \${lobby.hostAway ? \`<span class="reconnection-badge" style="background-color: #dc3545;">🔴 \${lobby.awayTimeout}s</span>\` : ''}
                    </td>
                    <td><code>\${lobby.hostId.substring(0, 8)}...</code></td>
                    <td>\${lobby.playerCount}</td>
                    <td>\${lobby.socketMessageCount}</td>
                    <td>
                      <div class="player-list">
                        \${lobby.players.map(p => {
                          const isDisconnected = p.status === 'disconnected' || !p.socketConnected;
                          const isAway = p.status === 'away';
                          const icon = isDisconnected ? '🔴' : (isAway ? '🟠' : '🟢');
                          const badge = isDisconnected ? '❌' : (isAway ? '💤' : '');
                          const opacity = isDisconnected ? '0.4' : (isAway ? '0.6' : '1');
                          const roleLabel = p.role ? \` [\${p.role}]\` : ' [n/a]';
                          return \`
                            <div style="margin: 2px 0; opacity: \${opacity};">
                              \${icon} \${p.name}\${roleLabel} \${p.isHost ? '👑' : ''} \${badge}
                            </div>
                          \`;
                        }).join('')}
                      </div>
                    </td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          \`;
          lobbiesCard.innerHTML = '<h2>🎮 Lobbies Actifs</h2>' + lobbiesHTML;
        } else {
          lobbiesCard.innerHTML = '<h2>🎮 Lobbies Actifs</h2><div class="no-data">Aucun lobby actif actuellement</div>';
        }

        // Mettre à jour les games
        const gamesCard = document.getElementById('gamesCard');
        if (stats.games.length > 0) {
          const gamesHTML = \`
            <table>
              <thead>
                <tr>
                  <th>Code Game</th>
                  <th>Host ID</th>
                  <th>Joueurs</th>
                  <th>Messages</th>
                  <th>Temps restant</th>
                  <th>Détails</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                \${stats.games.map(game => \`
                  <tr>
                    <td><strong>\${game.code}</strong></td>
                    <td><code>\${game.hostId.substring(0, 8)}...</code></td>
                    <td>\${game.playerCount}</td>
                    <td>\${game.socketMessageCount}</td>
                    <td><strong>\${formatRemainingTime(game.remainingTimeSeconds)}</strong></td>
                    <td>
                      <div class="player-list">
                        \${game.players.map(p => {
                          const isDisconnected = p.status === 'disconnected' || !p.socketConnected;
                          const isAway = p.status === 'away';
                          const icon = isDisconnected ? '🔴' : (isAway ? '🟠' : '🟢');
                          const badge = isDisconnected ? '❌' : (isAway ? '💤' : '');
                          const opacity = isDisconnected ? '0.4' : (isAway ? '0.6' : '1');
                          const roleLabel = p.role ? \` [\${p.role}]\` : ' [n/a]';
                          return \`
                            <div style="margin: 2px 0; opacity: \${opacity};">
                              \${icon} \${p.name}\${roleLabel} \${p.isHost ? '👑' : ''} \${badge}
                            </div>
                          \`;
                        }).join('')}
                      </div>
                    </td>
                    <td><button type="button" class="btn-game-data" data-game-code="\${game.code}">📊 Tableau de bord</button></td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          \`;
          gamesCard.innerHTML = '<h2>🎯 Games en cours</h2>' + gamesHTML;
        } else {
          gamesCard.innerHTML = '<h2>🎯 Games en cours</h2><div class="no-data">Aucune game en cours</div>';
        }

        // Mettre à jour les listes du formulaire de notifications
        var selPlayer = document.getElementById('notifyPlayerSelect');
        if (selPlayer) {
          var curPlayer = selPlayer.value;
          selPlayer.innerHTML = '<option value="">— Choisir un joueur —</option>' + (stats.clients || []).map(function(c) { return '<option value="' + c.clientId + '">' + c.clientId.substring(0, 8) + '... ' + (c.lobbyCode || '—') + ' / ' + (c.gameCode || '—') + '</option>'; }).join('');
          if (curPlayer && (stats.clients || []).some(function(c) { return c.clientId === curPlayer; })) selPlayer.value = curPlayer;
        }
        var selGame = document.getElementById('notifyGameSelect');
        if (selGame) {
          var curGame = selGame.value;
          selGame.innerHTML = '<option value="">— Choisir une partie —</option>' + (stats.games || []).map(function(g) { return '<option value="' + g.code + '">' + g.code + ' (' + g.playerCount + ' joueurs)</option>'; }).join('');
          if (curGame && (stats.games || []).some(function(g) { return g.code === curGame; })) selGame.value = curGame;
        }
        
        // Mettre à jour les logs seulement si nécessaire
        if (stats.logs.length !== lastLogCount) {
          lastLogCount = stats.logs.length;
          const logsCard = document.getElementById('logsCard');
          const logsContainer = logsCard.querySelector('.logs-container');
          const logsCount = logsCard.querySelector('.logs-count');
          logsCount.textContent = stats.logs.length + ' logs';
          
          if (stats.logs.length > 0) {
            const logsHTML = stats.logs.map(log => {
              const message = log.message;
              let className = 'log-entry';
              
              if (message.includes('[CONNEXION]')) className += ' log-connexion';
              else if (message.includes('[MESSAGE')) className += ' log-message';
              else if (message.includes('[LOBBY CRÉÉ]') || message.includes('[LOBBY REJOINT]')) className += ' log-lobby';
              else if (message.includes('[ERREUR]')) className += ' log-erreur';
              else if (message.includes('[WEBRTC]')) className += ' log-webrtc';
              else if (message.includes('[NOTIFICATION]')) className += ' log-notification';
              else if (message.includes('[DÉCONNEXION]') || message.includes('[LOBBY FERMÉ]') || message.includes('[JOUEUR PARTI]')) className += ' log-deconnexion';
              else if (message.includes('[AVERTISSEMENT]')) className += ' log-avertissement';
              
              return \`<div class="\${className}">\${message}</div>\`;
            }).join('');
            
            logsContainer.innerHTML = logsHTML;
          } else {
            logsContainer.innerHTML = '<div class="no-data">Aucun log disponible</div>';
          }
          
          // Auto-scroll vers le haut (plus récent en premier)
          logsContainer.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } catch (error) {
        console.error('Erreur lors de la mise à jour des stats:', error);
      }
    }

    function renderDashboard(data) {
      if (data.error) return '<p class="error">' + (data.error || 'Partie introuvable') + '</p>';
      var gd = (data.lastHostState && data.lastHostState.gameDetails) ? data.lastHostState.gameDetails : null;
      var hostPlayers = (data.lastHostState && data.lastHostState.players) ? data.lastHostState.players : [];
      var props = (data.lastHostState && data.lastHostState.props) ? data.lastHostState.props : [];
      var hostStateAt = data.lastHostStateAt;
      var phase = 'Convergence', phaseClass = 'dash-badge phase-lobby', phaseExtra = '';
      if (gd && gd.winner_type) { phase = 'Terminée'; phaseClass = 'dash-badge phase-done'; phaseExtra = ' · ' + (gd.winner_type || '').toUpperCase(); }
      else if (gd && gd.started && gd.countdown_started) { phase = 'En cours'; phaseClass = 'dash-badge phase-running'; }
      else if (gd && gd.game_starting && !gd.started) { phase = 'Démarrage'; phaseClass = 'dash-badge phase-start'; }
      var t = data.remainingTimeSeconds;
      if (t == null && gd) t = gd.remaining_time;
      var timeStr = (t != null && !isNaN(t)) ? (Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0')) : 'n/a';
      var cap = 0, total = (props && props.length) || 0;
      if (props) for (var i = 0; i < props.length; i++) if ((props[i].state || '').toUpperCase() === 'CAPTURED') cap++;
      var objStr = total ? cap + ' / ' + total : '—';
      var html = '<div class="dash-kpis">';
      html += '<div class="dash-kpi"><div class="dash-kpi-val"><span class="' + phaseClass + '">' + phase + '</span>' + phaseExtra + '</div><div class="dash-kpi-lbl">Phase</div></div>';
      html += '<div class="dash-kpi"><div class="dash-kpi-val">' + timeStr + '</div><div class="dash-kpi-lbl">Temps restant</div></div>';
      html += '<div class="dash-kpi"><div class="dash-kpi-val">' + (data.playerCount || 0) + '</div><div class="dash-kpi-lbl">Joueurs</div></div>';
      html += '<div class="dash-kpi"><div class="dash-kpi-val">' + objStr + '</div><div class="dash-kpi-lbl">Objectifs</div></div>';
      html += '</div>';
      html += '<div class="dash-section"><h4>👥 Joueurs</h4><table><thead><tr><th>Joueur</th><th>Rôle</th><th>Zone départ</th><th>Prêt</th><th>Socket</th><th>Statut</th></tr></thead><tbody>';
      var pl = data.players || [];
      for (var i = 0; i < pl.length; i++) {
        var p = pl[i];
        var hp = null;
        for (var j = 0; j < hostPlayers.length; j++) if (hostPlayers[j].id_player === p.id) { hp = hostPlayers[j]; break; }
        if (!hp && p.isHost && data.lastHostStateHostId) {
          for (var j = 0; j < hostPlayers.length; j++) if (String(hostPlayers[j].id_player) === String(data.lastHostStateHostId)) { hp = hostPlayers[j]; break; }
        }
        if (!hp && data.reconnectedPlayerIds) {
          for (var oldId in data.reconnectedPlayerIds) if (data.reconnectedPlayerIds[oldId] === p.id) {
            for (var j = 0; j < hostPlayers.length; j++) if (String(hostPlayers[j].id_player) === String(oldId)) { hp = hostPlayers[j]; break; }
            if (hp) break;
          }
        }
        var role = (hp && hp.role) ? hp.role : (p.role || '—');
        var roleCl = (role + '').toUpperCase() === 'AGENT' ? 'dash-badge role-agent' : ((role + '').toUpperCase() === 'ROGUE' ? 'dash-badge role-rogue' : '');
        var zone = (hp && hp.isInStartZone === true) ? '<span class="dash-badge ok">Oui</span>' : ((hp && hp.isInStartZone === false) ? '<span class="dash-badge no">Non</span>' : '—');
        var ready = (hp && hp.hasAcknowledgedStart === true) ? '<span class="dash-badge ok">Oui</span>' : '—';
        var sock = p.socketConnected ? '<span class="dash-badge socket-ok">Connecté</span>' : '<span class="dash-badge socket-ko">Déco</span>';
        var name = (p.name || p.id || '—').substring(0, 20) + (p.isHost ? ' 👑' : '');
        html += '<tr><td>' + name + '</td><td>' + (roleCl ? '<span class="' + roleCl + '">' + role + '</span>' : role) + '</td><td>' + zone + '</td><td>' + ready + '</td><td>' + sock + '</td><td>' + (p.status || 'actif') + '</td></tr>';
      }
      html += '</tbody></table></div>';
      if (props && props.length > 0) {
        html += '<div class="dash-section"><h4>🎯 Objectifs (vue host)</h4><table><thead><tr><th>#</th><th>Nom</th><th>État</th></tr></thead><tbody>';
        for (var i = 0; i < props.length; i++) {
          var pr = props[i];
          var st = (pr.state || '—').toUpperCase();
          var stLabel = st === 'CAPTURED' ? 'Capturé' : (st === 'VISIBLE' ? 'Visible' : st);
          html += '<tr><td>' + (pr.id_prop || i + 1) + '</td><td>' + (pr.name || '—') + '</td><td>' + stLabel + '</td></tr>';
        }
        html += '</tbody></table></div>';
      }
      if (gd) {
        html += '<div class="dash-section"><h4>⚙️ Règles (vue host)</h4><table><thead><tr><th>Paramètre</th><th>Valeur</th></tr></thead><tbody>';
        html += '<tr><td>Durée</td><td>' + (gd.duration != null ? gd.duration + ' s' : '—') + '</td></tr>';
        html += '<tr><td>Objectifs pour victoire</td><td>' + (gd.victory_condition_nb_objectivs != null ? gd.victory_condition_nb_objectivs : '—') + '</td></tr>';
        html += '<tr><td>Rayon carte</td><td>' + (gd.map_radius != null ? gd.map_radius + ' m' : '—') + '</td></tr>';
        html += '<tr><td>Hack (ms)</td><td>' + (gd.hack_duration_ms != null ? gd.hack_duration_ms : '—') + '</td></tr>';
        html += '<tr><td>Rayon zone objectif</td><td>' + (gd.objectiv_zone_radius != null ? gd.objectiv_zone_radius + ' m' : '—') + '</td></tr>';
        html += '<tr><td>Portée Rogue / Agent</td><td>' + (gd.rogue_range != null ? gd.rogue_range : '—') + ' / ' + (gd.agent_range != null ? gd.agent_range : '—') + '</td></tr>';
        html += '</tbody></table></div>';
      }
      if (hostStateAt) html += '<p class="dash-muted">Dernière synchro host : ' + new Date(hostStateAt).toLocaleTimeString('fr-FR') + '</p>';
      else if (!gd) html += '<p class="dash-muted">Vue host : en attente de la première synchro du host.</p>';
      return html;
    }

    function openGameModal(code) {
      const overlay = document.getElementById('gameModal');
      const title = document.getElementById('gameModalTitle');
      const dash = document.getElementById('gameModalDashboard');
      const notifyBtn = document.getElementById('gameModalNotifyBtn');
      title.textContent = 'Tableau de bord — ' + code + ' · en direct';
      if (dash) dash.innerHTML = '<span class="loading">Chargement…</span>';
      if (notifyBtn) notifyBtn.setAttribute('data-game-code', code);
      overlay.classList.add('open');
      if (gameModalPollId) clearInterval(gameModalPollId);
      function poll() {
        fetch('/api/stats/game/' + code)
          .then(r => r.json())
          .then(data => {
            if (!dash) return;
            if (data.error) { dash.innerHTML = '<p class="error">' + (data.error || 'Partie introuvable') + '</p>'; return; }
            dash.innerHTML = renderDashboard(data);
          })
          .catch(function() { if (dash) dash.innerHTML = '<p class="error">Erreur de chargement</p>'; });
      }
      poll();
      gameModalPollId = setInterval(poll, 1500);
    }

    function closeGameModal() {
      document.getElementById('gameModal').classList.remove('open');
      if (gameModalPollId) { clearInterval(gameModalPollId); gameModalPollId = null; }
    }

    document.addEventListener('click', (e) => {
      if (e.target.closest('.btn-game-data')) {
        const code = e.target.closest('.btn-game-data').getAttribute('data-game-code');
        if (code) openGameModal(code);
      }
      if (e.target.id === 'gameModalClose' || e.target.id === 'gameModal') closeGameModal();
      if (e.target.id === 'gameModalNotifyBtn') {
        const code = e.target.getAttribute('data-game-code');
        const msgEl = document.getElementById('gameModalNotifyMsg');
        const titleEl = document.getElementById('gameModalNotifyTitle');
        const msg = msgEl ? msgEl.value.trim() : '';
        const title = titleEl ? titleEl.value.trim() : '';
        if (!code) { alert('Partie inconnue'); return; }
        if (!msg) { alert('Veuillez saisir un message'); return; }
        fetch('/api/notify/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameCode: code, message: msg, title: title || undefined }) })
          .then(r => r.json())
          .then(d => { if (d.success) { alert('Envoyé à ' + d.count + ' joueur(s)'); if (msgEl) msgEl.value = ''; if (titleEl) titleEl.value = ''; } else alert('Erreur: ' + (d.error || 'Inconnue')); })
          .catch(() => alert('Erreur réseau'));
      }
      if (e.target.id === 'notifyPlayerBtn') {
        var cid = document.getElementById('notifyPlayerSelect') && document.getElementById('notifyPlayerSelect').value;
        var msgEl = document.getElementById('notifyPlayerMsg');
        var titleEl = document.getElementById('notifyPlayerTitle');
        var msg = msgEl ? msgEl.value.trim() : '';
        var title = titleEl ? titleEl.value.trim() : '';
        if (!cid) { alert('Choisir un joueur'); return; }
        if (!msg) { alert('Veuillez saisir un message'); return; }
        fetch('/api/notify/player', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: cid, message: msg, title: title || undefined }) })
          .then(r => r.json())
          .then(d => { if (d.success) alert('Notification envoyée'); else alert('Erreur: ' + (d.error || 'Inconnue')); })
          .catch(function() { alert('Erreur réseau'); });
      }
      if (e.target.id === 'notifyGameBtn') {
        var gcode = document.getElementById('notifyGameSelect') && document.getElementById('notifyGameSelect').value;
        var msgEl = document.getElementById('notifyGameMsg');
        var titleEl = document.getElementById('notifyGameTitle');
        var msg = msgEl ? msgEl.value.trim() : '';
        var title = titleEl ? titleEl.value.trim() : '';
        if (!gcode) { alert('Choisir une partie'); return; }
        if (!msg) { alert('Veuillez saisir un message'); return; }
        fetch('/api/notify/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameCode: gcode, message: msg, title: title || undefined }) })
          .then(r => r.json())
          .then(d => { if (d.success) alert('Envoyé à ' + d.count + ' joueur(s)'); else alert('Erreur: ' + (d.error || 'Inconnue')); })
          .catch(function() { alert('Erreur réseau'); });
      }
    });

    document.getElementById('gameModalClose').addEventListener('click', closeGameModal);
    
    // Mettre à jour toutes les 2 secondes
    setInterval(updateStats, 2000);
    
    // Première mise à jour immédiate
    updateStats();
  </script>
</body>
</html>
    `;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
  }
});

const io = new SocketIOServer(server, {
  path: SOCKET_IO_PATH,
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

const send = (socket, message) => {
  if (socket && socket.connected) {
    incrementTotalSocketMessages();
    const clientInfo = clients.get(socket.id);
    incrementLobbySocketMessages(clientInfo?.lobbyCode || null);
    const recipientId = clientInfo?.clientId || 'unknown';
    log(`[MESSAGE ENVOYÉ] À: ${recipientId}, Type: ${message.type}`);
    socket.emit('message', message);
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

io.on('connection', (socket) => {
  const clientId = randomUUID();
  clients.set(socket.id, { clientId, lobbyCode: null, gameCode: null });
  socketsById.set(clientId, socket);
  
  log(`[CONNEXION] Nouveau client connecté: ${clientId}`);

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
        players: new Map()
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
        clients.set(socket.id, { clientId, lobbyCode: code });

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
        clients.set(socket.id, { clientId, lobbyCode: null, gameCode: code });

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
