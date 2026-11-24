import { readdir, readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { loadConfig } from './config.js';

const pool = mysql.createPool(loadConfig().database);
const directory = new URL('../migrations/', import.meta.url);
try {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const filename of filenames) {
    const sql = await readFile(new URL(filename, directory), 'utf8');
    for (const statement of sql.split(/;\s*$/gm).map((part) => part.trim()).filter(Boolean)) {
      await pool.query(statement);
    }
  }
  console.log('Error database ready');
} finally {
  await pool.end();
}
