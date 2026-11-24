import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pool } from './pool.js';
import { env } from '../config/env.js';

const migrations = new URL('../../migrations/', import.meta.url);

export async function runMigrations(database = pool) {
  const lockName = createHash('sha256').update('abstergo-migrations:' + env.database.name).digest('hex');
  const connection = await database.getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
    locked = Number(lock.acquired) === 1;
    if (!locked) throw new Error('Could not lock schema migrations');

    await connection.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (' +
      'filename VARCHAR(255) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' +
      ') ENGINE=InnoDB'
    );
    const filenames = (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort();
    for (const filename of filenames) {
      const [existing] = await connection.query('SELECT 1 FROM schema_migrations WHERE filename = ?', [filename]);
      if (existing.length) continue;
      const sql = await readFile(new URL(filename, migrations), 'utf8');
      // MySQL DDL commits implicitly. A partially applied migration can safely be replayed.
      const statements = sql.split(/;\s*$/gm).map((statement) => statement.trim()).filter(Boolean);
      for (const statement of statements) await connection.query(statement);
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
    }
  } finally {
    try {
      if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } finally {
      connection.release();
    }
  }
}
