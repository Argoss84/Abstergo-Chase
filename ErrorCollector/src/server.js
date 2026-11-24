import mysql from 'mysql2/promise';
import { createApp } from './app.js';
import { createAuthenticator } from './auth.js';
import { loadConfig } from './config.js';
import { ErrorRepository } from './repository.js';

const config = loadConfig();
const pool = mysql.createPool(config.database);
const app = createApp({ ...config, repository: new ErrorRepository(pool),
  authenticate: createAuthenticator(config) });
const server = app.listen(config.passenger ? 'passenger' : config.port, () => console.log('Error collector listening'));
async function shutdown() {
  server.close(async () => { await pool.end(); });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
