import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5175;

// CORS (incl. Private Network Access pour requêtes vers localhost)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.json());

// Helper : connexion DB
const getDbConfig = () => {
  const host = process.env.DATABASE_HOST || 'localhost';
  const port = parseInt(process.env.DATABASE_PORT || '3306', 10);
  const database = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USER;
  const password = process.env.DATABASE_PASSWORD;
  const socketPath = process.env.DATABASE_SOCKET_PATH || undefined;
  const config = { database, user, password, charset: 'utf8mb4' };
  if (socketPath) config.socketPath = socketPath;
  else { config.host = host; config.port = port; }
  return config;
};

// GET /api/db/test - Test de connexion MySQL/MariaDB
app.get('/api/db/test', async (req, res) => {
  const { database, user, password } = getDbConfig();
  if (!database || !user || !password) {
    res.status(500).json({
      success: false,
      error: 'Configuration MySQL manquante. Vérifiez DATABASE_NAME, DATABASE_USER et DATABASE_PASSWORD dans .env',
    });
    return;
  }
  try {
    const connection = await mysql.createConnection(getDbConfig());
    await connection.query('SELECT 1');
    await connection.end();
    res.json({ success: true, message: 'Connexion MySQL/MariaDB réussie' });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur de connexion à la base de données',
    });
  }
});

// ========== CRUD Table "test" ==========

// GET /api/test - Liste tous les enregistrements
app.get('/api/test', async (req, res) => {
  try {
    const conn = await mysql.createConnection(getDbConfig());
    const [rows] = await conn.query('SELECT ID, ColonneInt, ColonneText, ColonneDate FROM test ORDER BY ID');
    await conn.end();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/test/:id - Récupère un enregistrement par ID
app.get('/api/test/:id', async (req, res) => {
  try {
    const conn = await mysql.createConnection(getDbConfig());
    const [rows] = await conn.query(
      'SELECT ID, ColonneInt, ColonneText, ColonneDate FROM test WHERE ID = ?',
      [req.params.id]
    );
    await conn.end();
    if (rows.length === 0) {
      res.status(404).json({ error: 'Enregistrement introuvable' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/test - Crée un enregistrement
app.post('/api/test', async (req, res) => {
  const { ColonneInt, ColonneText, ColonneDate } = req.body;
  if (ColonneInt == null || ColonneText == null || ColonneDate == null) {
    res.status(400).json({ error: 'ColonneInt, ColonneText et ColonneDate sont requis' });
    return;
  }
  try {
    const conn = await mysql.createConnection(getDbConfig());
    const [result] = await conn.query(
      'INSERT INTO test (ColonneInt, ColonneText, ColonneDate) VALUES (?, ?, ?)',
      [ColonneInt, ColonneText, ColonneDate]
    );
    await conn.end();
    res.status(201).json({ id: result.insertId, ColonneInt, ColonneText, ColonneDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/test/:id - Met à jour un enregistrement
app.put('/api/test/:id', async (req, res) => {
  const { ColonneInt, ColonneText, ColonneDate } = req.body;
  if (ColonneInt == null || ColonneText == null || ColonneDate == null) {
    res.status(400).json({ error: 'ColonneInt, ColonneText et ColonneDate sont requis' });
    return;
  }
  try {
    const conn = await mysql.createConnection(getDbConfig());
    const [result] = await conn.query(
      'UPDATE test SET ColonneInt = ?, ColonneText = ?, ColonneDate = ? WHERE ID = ?',
      [ColonneInt, ColonneText, ColonneDate, req.params.id]
    );
    await conn.end();
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Enregistrement introuvable' });
      return;
    }
    res.json({ id: req.params.id, ColonneInt, ColonneText, ColonneDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/test/:id - Supprime un enregistrement
app.delete('/api/test/:id', async (req, res) => {
  try {
    const conn = await mysql.createConnection(getDbConfig());
    const [result] = await conn.query('DELETE FROM test WHERE ID = ?', [req.params.id]);
    await conn.end();
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Enregistrement introuvable' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== Game Replay API ==========

// POST /api/game-sessions - Créer ou mettre à jour une session de jeu
app.post('/api/game-sessions', async (req, res) => {
  const { game_code, config_json, started_at, ended_at, winner_type } = req.body;
  if (!game_code || typeof game_code !== 'string') {
    res.status(400).json({ error: 'game_code requis' });
    return;
  }
  const code = String(game_code).trim().toUpperCase();
  try {
    const conn = await mysql.createConnection(getDbConfig());
    const [existing] = await conn.query(
      'SELECT id FROM game_sessions WHERE game_code = ?',
      [code]
    );
    const configStr = config_json ? JSON.stringify(config_json) : null;
    if (existing.length > 0) {
      const updates = [];
      const values = [];
      if (started_at != null) { updates.push('started_at = ?'); values.push(started_at); }
      if (ended_at != null) { updates.push('ended_at = ?'); values.push(ended_at); }
      if (winner_type != null) { updates.push('winner_type = ?'); values.push(winner_type); }
      if (config_json != null) { updates.push('config_json = ?'); values.push(configStr); }
      if (updates.length > 0) {
        values.push(existing[0].id);
        await conn.query(
          `UPDATE game_sessions SET ${updates.join(', ')} WHERE id = ?`,
          values
        );
      }
      await conn.end();
      res.json({ success: true, id: existing[0].id, game_code: code });
    } else {
      const [result] = await conn.query(
        'INSERT INTO game_sessions (game_code, config_json, started_at, ended_at, winner_type) VALUES (?, ?, ?, ?, ?)',
        [code, configStr, started_at || null, ended_at || null, winner_type || null]
      );
      await conn.end();
      res.status(201).json({ success: true, id: result.insertId, game_code: code });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/game-replay/snapshot - Insérer un snapshot pour le replay
app.post('/api/game-replay/snapshot', async (req, res) => {
  const { game_code, snapshot_timestamp, remaining_time_seconds, game_phase, players_json, props_json } = req.body;
  if (!game_code || typeof game_code !== 'string') {
    res.status(400).json({ error: 'game_code requis' });
    return;
  }
  const code = String(game_code).trim().toUpperCase();
  try {
    const conn = await mysql.createConnection(getDbConfig());
    let [sessions] = await conn.query(
      'SELECT id FROM game_sessions WHERE game_code = ?',
      [code]
    );
    if (sessions.length === 0) {
      const [insertResult] = await conn.query(
        'INSERT INTO game_sessions (game_code) VALUES (?)',
        [code]
      );
      sessions = [{ id: insertResult.insertId }];
    }
    const gameSessionId = sessions[0].id;
    const ts = snapshot_timestamp || new Date().toISOString();
    const playersStr = players_json ? JSON.stringify(players_json) : null;
    const propsStr = props_json ? JSON.stringify(props_json) : null;
    const [result] = await conn.query(
      'INSERT INTO game_replay_snapshots (game_session_id, snapshot_timestamp, remaining_time_seconds, game_phase, players_json, props_json) VALUES (?, ?, ?, ?, ?, ?)',
      [gameSessionId, ts, remaining_time_seconds ?? null, game_phase || null, playersStr, propsStr]
    );
    await conn.end();
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/game-replay/:gameCode - Récupérer session + snapshots pour le replay
app.get('/api/game-replay/:gameCode', async (req, res) => {
  const code = String(req.params.gameCode || '').trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: 'gameCode requis' });
    return;
  }
  try {
    const conn = await mysql.createConnection(getDbConfig());
    const [sessions] = await conn.query(
      'SELECT id, game_code, created_at, started_at, ended_at, winner_type, config_json FROM game_sessions WHERE game_code = ?',
      [code]
    );
    if (sessions.length === 0) {
      await conn.end();
      res.status(404).json({ error: 'Partie introuvable' });
      return;
    }
    const session = sessions[0];
    const [snapshots] = await conn.query(
      'SELECT id, snapshot_timestamp, remaining_time_seconds, game_phase, players_json, props_json FROM game_replay_snapshots WHERE game_session_id = ? ORDER BY snapshot_timestamp ASC',
      [session.id]
    );
    await conn.end();
    const config = session.config_json ? (typeof session.config_json === 'string' ? JSON.parse(session.config_json) : session.config_json) : null;
    const replaySnapshots = snapshots.map(s => ({
      id: s.id,
      snapshot_timestamp: s.snapshot_timestamp,
      remaining_time_seconds: s.remaining_time_seconds,
      game_phase: s.game_phase,
      players: s.players_json ? (typeof s.players_json === 'string' ? JSON.parse(s.players_json) : s.players_json) : [],
      props: s.props_json ? (typeof s.props_json === 'string' ? JSON.parse(s.props_json) : s.props_json) : []
    }));
    res.json({
      session: {
        id: session.id,
        game_code: session.game_code,
        created_at: session.created_at,
        started_at: session.started_at,
        ended_at: session.ended_at,
        winner_type: session.winner_type,
        config
      },
      snapshots: replaySnapshots
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ServerBDD démarré sur le port ${PORT}`);
  console.log(`Test DB: http://localhost:${PORT}/api/db/test`);
});
