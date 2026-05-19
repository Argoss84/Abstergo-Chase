import { env } from './config/env.js';
import { app } from './app.js';
import { runMigrations } from './db/migrate.js';
import { closePool } from './db/pool.js';

async function bootstrap() {
  await runMigrations();

  const server = app.listen(env.port, () => {
    console.log(`ServerBDD started on port ${env.port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap API:', error);
  process.exit(1);
});
