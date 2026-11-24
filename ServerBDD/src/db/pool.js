import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

export const pool = mysql.createPool({
  host: env.database.host,
  port: env.database.port,
  database: env.database.name,
  user: env.database.user,
  password: env.database.password,
  ssl: env.database.ssl ? { rejectUnauthorized: true } : undefined,
  timezone: 'Z',
  charset: 'utf8mb4',
  jsonStrings: true,
  connectionLimit: 5,
});

pool.on('connection', (connection) => {
  // Keep SQL defaults and UTC interval comparisons aligned on shared hosting.
  connection.query("SET time_zone = '+00:00'");
});

export async function transaction(work, database = pool) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function readJson(value, fallback = null) {
  return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback);
}

export async function closePool() {
  await pool.end();
}
