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

app.listen(PORT, () => {
  console.log(`ServerBDD démarré sur le port ${PORT}`);
  console.log(`Test DB: http://localhost:${PORT}/api/db/test`);
});
