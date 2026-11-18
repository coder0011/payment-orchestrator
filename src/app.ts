import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { DomainError } from './domain/errors.js';
import { logger } from './observability/logger.js';
import { metricsRouter } from './routes/metrics.route.js';
import { paymentsRouter } from './routes/v1/payments.route.js';
import { rulesRouter } from './routes/v1/rules.route.js';
import { tracesRouter } from './routes/v1/traces.route.js';

export function buildApp(): Application {
  const app: Application = express();
  const isSilent = process.env['SILENT_LOGS'] === 'true';

  // Enterprise Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS
  app.use(
    cors({
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Idempotency-Key'],
      exposedHeaders: ['Idempotent-Replayed'],
    })
  );

  // Request body parsing
  app.use(express.json());

  // Rate Limiting Shield (Token Bucket)
  const rateLimitMax = process.env['RATE_LIMIT_MAX']
    ? parseInt(process.env['RATE_LIMIT_MAX'], 10)
    : process.env['NODE_ENV'] === 'test'
    ? 1000000
    : 10000;

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Standard Health Check
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'payment-orchestrator',
      version: '1.0.0',
    });
  });

  // Mount API Routes
  app.use(metricsRouter); // Root /metrics
  app.use('/v1', paymentsRouter);
  app.use('/v1', tracesRouter);
  app.use('/v1', rulesRouter);

  // Top-level aliases for Hyperswitch compatibility (/payments)
  app.use(paymentsRouter);
  app.use(tracesRouter);
  app.use(rulesRouter);

  // Global RFC 7807 Error Handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }

    if (!isSilent) {
      logger.error({ err }, 'Unhandled exception during request execution');
    }

    res.status(500).json({
      type: 'https://api.payments.io/errors/internal-server-error',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected internal error occurred while processing the transaction',
    });
  });

  return app;
}
