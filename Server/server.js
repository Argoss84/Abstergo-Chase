import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { randomUUID } from 'crypto';

const PORT = process.env.SIGNALING_PORT || 5174;
const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || '/socket.io';

// Fonction pour obtenir les statistiques du serveur
const getServerStats = () => ({
  connectedClients: clients.size,
  activeLobbies: lobbies.size,
  clients: Array.from(clients.entries()).map(([socketId, info]) => {
    const socket = io.sockets.sockets.get(socketId);
    return {
      clientId: info.clientId,
      lobbyCode: info.lobbyCode || 'Aucun',
      connected: Boolean(socket?.connected)
    };
  }),
  lobbies: Array.from(lobbies.entries()).map(([code, lobby]) => {
    const hostDisconnected = disconnectedHosts.has(code);
    const hostInfo = hostDisconnected ? disconnectedHosts.get(code) : null;
    return {
      code,
      hostId: lobby.hostId,
      playerCount: lobby.players.size,
      players: Array.from(lobby.players.values()),
      hostDisconnected,
      reconnectionTimeout: hostInfo ? Math.ceil((5 * 60 * 1000 - (Date.now() - hostInfo.disconnectedAt)) / 1000) : null
    };
  }),
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
    }
    .status.connected {
      background-color: #4caf50;
      color: white;
    }
    .status.disconnected {
      background-color: #f44336;
      color: white;
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
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            ${stats.clients.map(client => `
              <tr>
                <td><code>${client.clientId.substring(0, 8)}...</code></td>
                <td>${client.lobbyCode}</td>
                <td>
                  <span class="status ${client.connected ? 'connected' : 'disconnected'}">
                    ${client.connected ? 'Connecté' : 'Déconnecté'}
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
              <th>Détails</th>
            </tr>
          </thead>
          <tbody>
            ${stats.lobbies.map(lobby => `
              <tr>
                <td>
                  <strong>${lobby.code}</strong>
                  ${lobby.hostDisconnected ? `<span class="reconnection-badge">⏱️ ${lobby.reconnectionTimeout}s</span>` : ''}
                </td>
                <td><code>${lobby.hostId.substring(0, 8)}...</code></td>
                <td>${lobby.playerCount}</td>
                <td>
                  <div class="player-list">
                    ${lobby.players.map(p => `${p.name} ${p.isHost ? '👑' : ''}`).join(', ')}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<div class="no-data">Aucun lobby actif actuellement</div>'}
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
    
    // Fonction pour mettre à jour les statistiques
    async function updateStats() {
      try {
        const response = await fetch('/api/stats');
        const stats = await response.json();
        
        // Mettre à jour les statistiques principales
        document.querySelectorAll('.stat-box')[0].querySelector('.number').textContent = stats.connectedClients;
        document.querySelectorAll('.stat-box')[1].querySelector('.number').textContent = stats.activeLobbies;
        document.querySelectorAll('.stat-box')[2].querySelector('.number').textContent = Math.floor(stats.serverInfo.uptime / 60) + 'm';
        document.querySelectorAll('.stat-box')[3].querySelector('.number').textContent = Math.round(stats.serverInfo.memoryUsage.heapUsed / 1024 / 1024) + 'MB';
        
        // Mettre à jour les clients
        const clientsCard = document.getElementById('clientsCard');
        if (stats.clients.length > 0) {
          const clientsHTML = \`
            <table>
              <thead>
                <tr>
                  <th>Client ID</th>
                  <th>Lobby</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                \${stats.clients.map(client => \`
                  <tr>
                    <td><code>\${client.clientId.substring(0, 8)}...</code></td>
                    <td>\${client.lobbyCode}</td>
                    <td>
                      <span class="status \${client.connected ? 'connected' : 'disconnected'}">
                        \${client.connected ? 'Connecté' : 'Déconnecté'}
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
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                \${stats.lobbies.map(lobby => \`
                  <tr>
                    <td>
                      <strong>\${lobby.code}</strong>
                      \${lobby.hostDisconnected ? \`<span class="reconnection-badge">⏱️ \${lobby.reconnectionTimeout}s</span>\` : ''}
                    </td>
                    <td><code>\${lobby.hostId.substring(0, 8)}...</code></td>
                    <td>\${lobby.playerCount}</td>
                    <td>
                      <div class="player-list">
                        \${lobby.players.map(p => \`\${p.name} \${p.isHost ? '👑' : ''}\`).join(', ')}
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
const clients = new Map();
const socketsById = new Map();
const disconnectedHosts = new Map(); // Stocke temporairement les lobbies dont le host s'est déconnecté

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

const send = (socket, message) => {
  if (socket && socket.connected) {
    const clientInfo = clients.get(socket.id);
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
  clients.set(socket.id, { clientId, lobbyCode: null });
  socketsById.set(clientId, socket);
  
  log(`[CONNEXION] Nouveau client connecté: ${clientId}`);

  socket.on('message', (raw) => {
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
      clients.get(socket.id).lobbyCode = code;

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
          lobby.players.set(clientId, { ...oldPlayer, id: clientId });
        } else {
          lobby.players.set(clientId, { id: clientId, name: payload?.playerName || 'Host', isHost: true });
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

    if (type === 'state:sync') {
      const targetId = payload?.targetId;
      const targetSocket = socketsById.get(targetId);
      if (!targetSocket) {
        log(`[ERREUR RESYNC] État sync vers ${targetId} échoué: destinataire introuvable`);
        return;
      }
      send(targetSocket, {
        type: 'state:sync',
        payload: payload?.payload
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
    
    const { lobbyCode } = clientInfo;
    if (lobbyCode && lobbies.has(lobbyCode)) {
      const lobby = lobbies.get(lobbyCode);
      lobby.players.delete(clientInfo.clientId);

      if (lobby.hostId === clientInfo.clientId) {
        log(`[HOST DÉCONNECTÉ] Code: ${lobbyCode}, Host: ${clientInfo.clientId} - Lobby conservé pendant 5 minutes`);
        
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
            disconnectedHosts.delete(lobbyCode);
          }
        }, 5 * 60 * 1000); // 5 minutes
        
        disconnectedHosts.set(lobbyCode, {
          hostId: clientInfo.clientId,
          timeoutId,
          disconnectedAt: Date.now()
        });
      } else {
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
