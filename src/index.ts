import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown initiated');
    try {
      await app.close();
      logger.info('HTTP server closed successfully');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    const address = await app.listen({
      port: env.PORT,
      host: env.HOST,
    });
    logger.info(
      {
        address,
        port: env.PORT,
        env: env.NODE_ENV,
        healthFloor: env.DEFAULT_HEALTH_FLOOR,
      },
      'Techdome Payment Orchestrator started successfully'
    );
  } catch (err) {
    logger.fatal({ err }, 'Failed to start payment orchestrator');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal bootstrapping error:', err);
  process.exit(1);
});
