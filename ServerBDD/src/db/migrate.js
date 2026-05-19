import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function splitSqlStatements(sqlText) {
  return sqlText
    .split(/;\s*$/gm)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function readSqlFile(absolutePath) {
  const { createReadStream } = await import('node:fs');
  const stream = createReadStream(absolutePath, { encoding: 'utf8' });
  const chunks = [];
  for await (const chunk of Readable.from(stream)) {
    chunks.push(chunk);
  }
  return chunks.join('');
}

export async function runMigrations() {
  await ensureMigrationsTable();

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (existing.rowCount > 0) {
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    const sql = await readSqlFile(fullPath);
    const statements = splitSqlStatements(sql);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied migration: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
