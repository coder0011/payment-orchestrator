import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { rulesEngine } from '../../src/routing/rules-engine.js';
import { idempotencyService } from '../../src/security/idempotency.js';
import { traceService } from '../../src/services/trace.service.js';

describe('Integration: Euclid-Style Dynamic Routing Rules API', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  beforeEach(() => {
    rulesEngine.clearRules();
    idempotencyService.clear();
    traceService.clear();
  });

  it('POST /v1/routing/rules - Configures dynamic rules and enforcers them in payment routing', async () => {
    // 1. Post a custom rule that forces Stripe for high-value USD
    const rulePayload = {
      rules: [
        {
          id: 'rule_vip_usd',
          name: 'VIP High-Value USD Override',
          priority: 10,
          conditions: [
            { field: 'currency', operator: 'EQUAL', value: 'USD' },
            { field: 'amount', operator: 'GREATER_THAN', value: 500 },
          ],
          actions: {
            preferredConnectors: ['stripe'],
            strategy: 'priority',
          },
        },
      ],
    };

    const postRuleRes = await app.inject({
      method: 'POST',
      url: '/v1/routing/rules',
      headers: { 'content-type': 'application/json' },
      payload: rulePayload,
    });

    assert.equal(postRuleRes.statusCode, 200);
    const ruleResBody = JSON.parse(postRuleRes.body);
    assert.equal(ruleResBody.activeRuleCount, 1);

    // 2. Send high-value payment ($600 USD)
    // Normally Adyen is cheapest ($1.21 vs $3.20), but our rule dictates Stripe!
    const paymentRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: { 'content-type': 'application/json' },
      payload: {
        amount: 600,
        currency: 'USD',
        paymentMethod: 'card',
        card: {
          number: '4242424242424242',
          expMonth: 12,
          expYear: 2028,
          cvv: '123',
          holderName: 'VIP Customer',
        },
        billingCountry: 'US',
      },
    });

    assert.equal(paymentRes.statusCode, 201);
    const payment = JSON.parse(paymentRes.body);

    assert.equal(payment.connector, 'stripe', 'Should route to Stripe due to dynamic rule priority');
    assert.equal(payment.routingSummary.strategy, 'rule_priority');
    assert.ok(payment.routingSummary.reason.includes('VIP High-Value USD Override'));

    // 3. Inspect Decision Trace
    const traceRes = await app.inject({
      method: 'GET',
      url: `/v1/payments/${payment.paymentId}/routing-trace`,
    });

    assert.equal(traceRes.statusCode, 200);
    const trace = JSON.parse(traceRes.body);
    assert.equal(trace.matchedRule, 'VIP High-Value USD Override');
    assert.equal(trace.selectedConnector, 'stripe');
  });

  it('DELETE /v1/routing/rules - Clears rules and restores pure cost-aware routing', async () => {
    // Set a rule
    rulesEngine.setRules([
      {
        id: 'temp_rule',
        name: 'Temporary Rule',
        priority: 1,
        conditions: [{ field: 'currency', operator: 'EQUAL', value: 'USD' }],
        actions: { preferredConnectors: ['stripe'], strategy: 'priority' },
      },
    ]);

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/v1/routing/rules',
    });

    assert.equal(delRes.statusCode, 200);
    assert.equal(rulesEngine.getRules().length, 0);

    // Payment for USD 100 should now route to Adyen (cheapest)
    const paymentRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: { 'content-type': 'application/json' },
      payload: {
        amount: 100,
        currency: 'USD',
        paymentMethod: 'card',
        card: {
          number: '4242424242424242',
          expMonth: 12,
          expYear: 2028,
          cvv: '123',
          holderName: 'Standard User',
        },
        billingCountry: 'US',
      },
    });

    assert.equal(paymentRes.statusCode, 201);
    const payment = JSON.parse(paymentRes.body);
    assert.equal(payment.connector, 'adyen', 'Default cheapest connector should be selected after rule deletion');
  });
});
