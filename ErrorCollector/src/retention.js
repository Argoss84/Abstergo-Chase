import mysql from 'mysql2/promise';
import { loadConfig } from './config.js';

const tables = [
  ['error_events', '320 + OCTET_LENGTH(message) + COALESCE(OCTET_LENGTH(error_text), 0) + COALESCE(OCTET_LENGTH(stack_trace), 0)'],
  ['diagnostic_events', '250 + OCTET_LENGTH(event_code)'],
  ['voice_route_samples', '220'],
];

const pool = mysql.createPool(loadConfig().database);
const maximum = Number(process.env.DIAGNOSTICS_MAX_BYTES ?? 0);
try {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error('Invalid DIAGNOSTICS_MAX_BYTES');
  for (const [table] of tables) {
    let removed;
    do {
      const [result] = await pool.query(
        'DELETE FROM ' + table + ' WHERE received_at < UTC_TIMESTAMP(3) - INTERVAL 30 DAY ORDER BY received_at LIMIT 2000'
      );
      removed = result.affectedRows;
    } while (removed === 2000);
  }

  if (maximum > 0) {
    const totals = await Promise.all(tables.map(async ([table, size]) => {
      const [[row]] = await pool.query('SELECT COALESCE(SUM(' + size + '), 0) AS bytes FROM ' + table);
      return Number(row.bytes);
    }));
    let bytes = totals.reduce((total, value) => total + value, 0);
    while (bytes > maximum) {
      const entries = await Promise.all(tables.map(async ([table, size]) => {
        const [rows] = await pool.query(
          'SELECT event_id, received_at, ' + size + ' AS bytes FROM ' + table + ' ORDER BY received_at, event_id LIMIT 500'
        );
        return rows.map((row) => ({ ...row, table }));
      }));
      const oldest = entries.flat().sort((a, b) => String(a.received_at).localeCompare(String(b.received_at))).slice(0, 500);
      if (!oldest.length) break;
      for (const [table] of tables) {
        const batch = oldest.filter((entry) => entry.table === table);
        if (!batch.length) continue;
        await pool.query('DELETE FROM ' + table + ' WHERE event_id IN (?)', [batch.map((entry) => entry.event_id)]);
        bytes -= batch.reduce((total, entry) => total + Number(entry.bytes), 0);
      }
    }
  }
  console.log('Diagnostic retention applied');
} finally {
  await pool.end();
}
