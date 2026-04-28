import { runMigrations } from './migrate.js';
import { closePool } from './pool.js';

try {
  await runMigrations();
  console.log('Migrations completed.');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await closePool();
}
