import client from 'prom-client';

// Initialize default recommended Prometheus metrics (event loop lag, memory, GC)
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'orchestrator_' });

export const paymentRequestsTotal = new client.Counter({
  name: 'payment_requests_total',
  help: 'Total count of inbound payment requests handled by the switch',
  labelNames: ['status', 'currency', 'connector'] as const,
  registers: [register],
});

export const routingDecisionsTotal = new client.Counter({
  name: 'payment_routing_decisions_total',
  help: 'Total routing decisions made categorized by selected connector and decision strategy',
  labelNames: ['selected_connector', 'strategy'] as const,
  registers: [register],
});

export const routingFloorRejectionsTotal = new client.Counter({
  name: 'payment_routing_floor_rejections_total',
  help: 'Total count of connectors rejected during evaluation due to health floor violations',
  labelNames: ['connector', 'reason'] as const,
  registers: [register],
});

export const cascadeAttemptsTotal = new client.Counter({
  name: 'payment_cascade_attempts_total',
  help: 'Total number of cascading failovers triggered from one connector to another',
  labelNames: ['from_connector', 'to_connector'] as const,
  registers: [register],
});

export const paymentProcessingDurationSeconds = new client.Histogram({
  name: 'payment_processing_duration_seconds',
  help: 'Duration of end-to-end payment processing in seconds',
  labelNames: ['connector', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2],
  registers: [register],
});

export const connectorCircuitBreakerState = new client.Gauge({
  name: 'connector_circuit_breaker_state',
  help: 'State of connector circuit breaker (0=CLOSED/HEALTHY, 1=HALF_OPEN, 2=OPEN/TRIPPED)',
  labelNames: ['connector'] as const,
  registers: [register],
});

export async function getPrometheusMetrics(): Promise<string> {
  return register.metrics();
}

export const metricsContentType = register.contentType;
