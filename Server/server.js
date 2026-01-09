import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const PORT = process.env.SIGNALING_PORT || 5174;

// Créer le serveur HTTP avec un gestionnaire de requêtes
const server = createServer((req, res) => {
  // Page de monitoring accessible via HTTP
  if (req.method === 'GET') {
    const stats = {
      connectedClients: clients.size,
      activeLobbies: lobbies.size,
      clients: Array.from(clients.entries()).map(([socket, info]) => ({
        clientId: info.clientId,
        lobbyCode: info.lobbyCode || 'Aucun',
        connected: socket.readyState === 1
      })),
      lobbies: Array.from(lobbies.entries()).map(([code, lobby]) => ({
        code,
        hostId: lobby.hostId,
        playerCount: lobby.players.size,
        players: Array.from(lobby.players.values())
      })),
      serverInfo: {
        port: PORT,
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      }
    };

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
      color: #333;
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
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Serveur de Signalisation WebRTC - Monitoring</h1>
    
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
        <span class="info-label">URL WebSocket:</span>
        <span class="info-value">ws://${req.headers.host}</span>
      </div>
      <div class="info-item">
        <span class="info-label">URL HTTP:</span>
        <span class="info-value">http://${req.headers.host}</span>
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

    <div class="card">
      <h2>👥 Clients WebSocket Connectés</h2>
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

    <div class="card">
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
                <td><strong>${lobby.code}</strong></td>
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

    <button class="refresh-btn" onclick="location.reload()">🔄 Rafraîchir</button>
  </div>

  <script>
    // Auto-refresh toutes les 10 secondes
    setTimeout(() => location.reload(), 10000);
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
  const address = server.address();
  const host = address.address === '::' ? 'localhost' : address.address;
  const port = address.port;
  
  log('========================================');
  log(`🚀 Serveur de signalisation WebRTC démarré`);
  log(`📡 Port: ${port}`);
  log(`🌐 Adresse: ${host}`);
  log(`🔗 URL: ws://${host === '::' ? 'localhost' : host}:${port}`);
  log(`📊 Logs des signaux activés`);
  log('========================================');
});
