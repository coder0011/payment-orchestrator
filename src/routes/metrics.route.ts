import { Router } from 'express';
import { getPrometheusMetrics, metricsContentType } from '../observability/metrics.js';

export const metricsRouter: Router = Router();

// GET /metrics (BONUS REQUIREMENT)
metricsRouter.get('/metrics', async (_req, res, next) => {
  try {
    const metrics = await getPrometheusMetrics();
    res.setHeader('Content-Type', metricsContentType);
    res.status(200).send(metrics);
  } catch (err) {
    next(err);
  }
});
