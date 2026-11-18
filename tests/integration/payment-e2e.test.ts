import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { Application } from 'express';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { adyenConnector } from '../../src/connectors/adyen.connector.js';
import { razorpayConnector } from '../../src/connectors/razorpay.connector.js';
import { stripeConnector } from '../../src/connectors/stripe.connector.js';
import { healthTracker } from '../../src/routing/health-tracker.js';
import { idempotencyService } from '../../src/security/idempotency.js';
import { traceService } from '../../src/services/trace.service.js';

describe('Integration / E2E: Payment Orchestrator API Suite (Express 5)', () => {
  const app: Application = buildApp();

  const validPaymentPayload = {
    amount: 150,
    currency: 'USD',
    paymentMethod: 'card',
    card: {
      number: '4242424242424242',
      expMonth: 11,
      expYear: 2028,
      cvv: '999',
      holderName: 'Alice Morgan',
    },
    billingCountry: 'US',
    merchantId: 'merch_integration_01',
  };

  beforeEach(() => {
    adyenConnector.resetSimulations();
    stripeConnector.resetSimulations();
    razorpayConnector.resetSimulations();
    healthTracker.reset();
    idempotencyService.clear();
    traceService.clear();
  });

  it('POST /v1/payments - Executes payment successfully with cost-aware routing', async () => {
    const res = await request(app)
      .post('/v1/payments')
      .set('content-type', 'application/json')
      .set('idempotency-key', 'idem-e2e-1')
      .send(validPaymentPayload);

    assert.equal(res.status, 201);
    const body = res.body;

    assert.ok(body.paymentId.startsWith('pay_'));
    assert.equal(body.status, 'succeeded');
    assert.equal(body.amount, 150);
    assert.equal(body.currency, 'USD');
    assert.equal(body.connector, 'adyen', 'Adyen should be chosen as cheapest healthy connector');
    assert.equal(body.maskedCard, '424242******4242');
    assert.equal(body.routingSummary.strategy, 'least_cost');
  });

  it('GET /v1/payments/:id/routing-trace - Returns full decision trace (BONUS +5)', async () => {
    // 1. Create payment
    const createRes = await request(app)
      .post('/v1/payments')
      .set('content-type', 'application/json')
      .send(validPaymentPayload);

    const payment = createRes.body;

    // 2. Fetch trace
    const traceRes = await request(app).get(`/v1/payments/${payment.paymentId}/routing-trace`);

    assert.equal(traceRes.status, 200);
    const trace = traceRes.body;

    assert.equal(trace.paymentId, payment.paymentId);
    assert.equal(trace.healthFloorThreshold, 0.85);
    assert.equal(trace.selectedConnector, 'adyen');
    assert.ok(Array.isArray(trace.evaluationMatrix));
    assert.equal(trace.evaluationMatrix.length, 3);

    const adyenCandidate = trace.evaluationMatrix.find(
      (c: { connectorId: string }) => c.connectorId === 'adyen'
    );
    assert.ok(adyenCandidate.selected);
    assert.equal(adyenCandidate.status, 'chosen_primary');

    assert.equal(trace.executionTrace.finalStatus, 'succeeded');
    assert.equal(trace.executionTrace.attempts.length, 1);
  });

  it('Automatic Cascading Fallback: Cascades to secondary connector on primary soft decline', async () => {
    // Simulate Adyen temporary gateway timeout (soft decline)
    adyenConnector.simulateFailure('soft', 'Processor 504 Gateway Timeout');

    const res = await request(app)
      .post('/v1/payments')
      .set('content-type', 'application/json')
      .send(validPaymentPayload);

    assert.equal(res.status, 201);
    const body = res.body;

    // Final result succeeded via next cheapest healthy connector (Razorpay at $2.00 vs Stripe at $3.20)
    assert.equal(body.status, 'succeeded');
    assert.equal(body.connector, 'razorpay');
    assert.equal(body.routingSummary.strategy, 'fallback_cascade');
    assert.ok(body.routingSummary.reason.includes('Cascaded to razorpay after primary decline'));
    assert.equal(body.attempts.length, 2, 'Should have made 2 attempts (Adyen then Razorpay)');
    assert.equal(body.attempts[0].connectorId, 'adyen');
    assert.equal(body.attempts[0].status, 'failed');
    assert.equal(body.attempts[1].connectorId, 'razorpay');
    assert.equal(body.attempts[1].status, 'succeeded');
  });

  it('Idempotency Replay: Duplicate requests with same key return cached response with header', async () => {
    const key = 'idem-replay-test-01';

    // First request
    const res1 = await request(app)
      .post('/v1/payments')
      .set('content-type', 'application/json')
      .set('idempotency-key', key)
      .send(validPaymentPayload);
    assert.equal(res1.status, 201);
    assert.equal(res1.headers['idempotent-replayed'], undefined);

    // Duplicate request with identical key
    const res2 = await request(app)
      .post('/v1/payments')
      .set('content-type', 'application/json')
      .set('idempotency-key', key)
      .send(validPaymentPayload);
    assert.equal(res2.status, 200);
    assert.equal(res2.headers['idempotent-replayed'], 'true');

    assert.equal(res1.body.paymentId, res2.body.paymentId);
  });

  it('GET /metrics - Exposes standard Prometheus metrics (BONUS +5)', async () => {
    const res = await request(app).get('/metrics');

    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('text/plain'));
    assert.ok(res.text.includes('payment_requests_total'));
    assert.ok(res.text.includes('payment_routing_decisions_total'));
    assert.ok(res.text.includes('payment_processing_duration_seconds'));
  });
});
