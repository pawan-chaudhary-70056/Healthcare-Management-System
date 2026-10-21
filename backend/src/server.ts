import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from './config/database.js';
import { logger } from './config/logger.js';
import { env } from './config/env.js';
import { startBackgroundJobs, stopBackgroundJobs } from './jobs/index.js';
import { logPolicySnapshot } from './config/policy.loader.js';

/** Bootstrap order: env check (import side effect) → db connect → http server. */
async function main(): Promise<void> {
  await connectDatabase();
  logPolicySnapshot();
  const app = createApp();
  await ensureIndexes(); // uniqueness guards ready before first write (AC-15)
  startBackgroundJobs();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, `HMS backend listening on :${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      stopBackgroundJobs();
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
