import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { DomainError } from './domain/errors.js';
import { logger } from './observability/logger.js';
import { metricsRoute } from './routes/metrics.route.js';
import { paymentsRoute } from './routes/v1/payments.route.js';
import { rulesRoute } from './routes/v1/rules.route.js';
import { tracesRoute } from './routes/v1/traces.route.js';

export async function buildApp(): Promise<FastifyInstance> {
  const isSilent = process.env['SILENT_LOGS'] === 'true';

  const app = Fastify({
    logger: isSilent
      ? false
      : {
          level: logger.level,
          redact: {
            paths: [
              'card.number',
              'card.cvv',
              'body.card.number',
              'body.card.cvv',
              'req.body.card.number',
              'req.body.card.cvv',
              'req.headers.authorization',
              'cardNumber',
              'cvv',
            ],
            censor: '[REDACTED_PCI_PII]',
          },
        },
  });

  // Enterprise Security Headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // API server
    crossOriginEmbedderPolicy: false,
  });

  // CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replayed'],
  });

  // Abuse & Carding Rate Limiting Shield (Token Bucket)
  const rateLimitMax = process.env['RATE_LIMIT_MAX']
    ? parseInt(process.env['RATE_LIMIT_MAX'], 10)
    : process.env['NODE_ENV'] === 'test'
    ? 1000000
    : 10000;

  await app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute',
  });

  // Standard Health Check
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'techdome-payment-orchestrator',
      version: '1.0.0',
    });
  });

  // Global RFC 7807 Error Handler
  app.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send(error.toJSON());
    }

    const fastifyErr = error as FastifyError;

    // Fastify schema validation error fallback
    if (fastifyErr.validation) {
      return reply.status(400).send({
        type: 'https://api.techdome.io/errors/validation-failed',
        title: 'Validation Error',
        status: 400,
        detail: fastifyErr.message,
        errors: fastifyErr.validation,
      });
    }

    if (typeof fastifyErr.statusCode === 'number') {
      return reply.status(fastifyErr.statusCode).send({
        type: `https://api.techdome.io/errors/${fastifyErr.statusCode}`,
        title: fastifyErr.name || 'HTTP Error',
        status: fastifyErr.statusCode,
        detail: fastifyErr.message,
      });
    }

    // Unhandled internal errors
    logger.error({ err: error }, 'Unhandled exception during request execution');
    return reply.status(500).send({
      type: 'https://api.techdome.io/errors/internal-server-error',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected internal error occurred while processing the transaction',
    });
  });

  // Inbound API Routes
  await app.register(metricsRoute); // Root /metrics
  await app.register(paymentsRoute, { prefix: '/v1' });
  await app.register(tracesRoute, { prefix: '/v1' });
  await app.register(rulesRoute, { prefix: '/v1' });

  // Also register top-level aliases for compatibility with Hyperswitch conventions (/payments)
  await app.register(paymentsRoute);
  await app.register(tracesRoute);
  await app.register(rulesRoute);

  return app;
}
