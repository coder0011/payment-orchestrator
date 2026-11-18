import type { FastifyPluginAsync } from 'fastify';
import { getPrometheusMetrics, metricsContentType } from '../observability/metrics.js';

export const metricsRoute: FastifyPluginAsync = async (fastify) => {
  // GET /metrics (BONUS REQUIREMENT)
  fastify.get('/metrics', async (_request, reply) => {
    const metrics = await getPrometheusMetrics();
    return reply.header('Content-Type', metricsContentType).status(200).send(metrics);
  });
};
