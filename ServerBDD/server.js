import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5175;

// CORS (incl. Private Network Access pour requêtes vers localhost)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// GET /api/db/test - Test de connexion MySQL/MariaDB
app.get('/api/db/test', async (req, res) => {
  const host = process.env.DATABASE_HOST || 'localhost';
  const port = parseInt(process.env.DATABASE_PORT || '3306', 10);
  const database = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USER;
  const password = process.env.DATABASE_PASSWORD;
  const socketPath = process.env.DATABASE_SOCKET_PATH || undefined;

  if (!database || !user || !password) {
    res.status(500).json({
      success: false,
      error: 'Configuration MySQL manquante. Vérifiez DATABASE_NAME, DATABASE_USER et DATABASE_PASSWORD dans .env',
    });
    return;
  }

  const config = {
    database,
    user,
    password,
    charset: 'utf8mb4',
  };

  if (socketPath) {
    config.socketPath = socketPath;
  } else {
    config.host = host;
    config.port = port;
  }

  try {
    const connection = await mysql.createConnection(config);
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

app.listen(PORT, () => {
  console.log(`ServerBDD démarré sur le port ${PORT}`);
  console.log(`Test DB: http://localhost:${PORT}/api/db/test`);
});
