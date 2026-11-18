import type { Server } from 'node:http';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';

async function main(): Promise<void> {
  const app = buildApp();
  let server: Server;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown initiated');
    if (server) {
      server.close((err) => {
        if (err) {
          logger.error({ err }, 'Error during server close');
          process.exit(1);
        }
        logger.info('HTTP server closed successfully');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    server = app.listen(env.PORT, env.HOST, () => {
      logger.info(
        {
          port: env.PORT,
          host: env.HOST,
          env: env.NODE_ENV,
          healthFloor: env.DEFAULT_HEALTH_FLOOR,
        },
        'Payment Orchestrator (Express 5) started successfully'
      );
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start payment orchestrator');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal bootstrapping error:', err);
  process.exit(1);
});
