import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from '../../domain/errors.js';
import { traceService } from '../../services/trace.service.js';

export const tracesRoute: FastifyPluginAsync = async (fastify) => {
  // GET /v1/payments/:id/routing-trace (BONUS REQUIREMENT)
  fastify.get<{ Params: { id: string } }>('/payments/:id/routing-trace', async (request, reply) => {
    const trace = traceService.getTrace(request.params.id);
    if (!trace) {
      throw new NotFoundError('RoutingTrace for payment', request.params.id);
    }

    return reply.status(200).send({
      paymentId: trace.paymentId,
      evaluatedAt: trace.decision.evaluatedAt,
      input: trace.decision.input,
      healthFloorThreshold: trace.decision.healthFloorThreshold,
      evaluationMatrix: trace.decision.evaluationMatrix,
      selectedConnector: trace.decision.selectedConnector,
      fallbackCandidates: trace.decision.fallbackCandidates,
      strategy: trace.decision.strategy,
      reason: trace.decision.reason,
      matchedRule: trace.decision.matchedRule,
      executionTrace: trace.executionTrace,
    });
  });
};
