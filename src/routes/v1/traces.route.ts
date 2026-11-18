import { Router } from 'express';
import { NotFoundError, ValidationError } from '../../domain/errors.js';
import { traceService } from '../../services/trace.service.js';

export const tracesRouter: Router = Router();

// GET /payments/:id/routing-trace (BONUS REQUIREMENT)
tracesRouter.get('/payments/:id/routing-trace', async (req, res, next) => {
  try {
    const paymentId = req.params['id'];
    if (!paymentId) {
      throw new ValidationError('Payment ID parameter required');
    }

    const trace = traceService.getTrace(paymentId);
    if (!trace) {
      throw new NotFoundError('RoutingTrace for payment', paymentId);
    }

    res.status(200).json({
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
  } catch (err) {
    next(err);
  }
});
