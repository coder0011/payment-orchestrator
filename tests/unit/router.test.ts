import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { adyenConnector } from '../../src/connectors/adyen.connector.js';
import { razorpayConnector } from '../../src/connectors/razorpay.connector.js';
import { stripeConnector } from '../../src/connectors/stripe.connector.js';
import type { PaymentIntent } from '../../src/domain/entities.js';
import { CostAwareRouter } from '../../src/routing/cost-aware-router.js';
import { HealthTracker } from '../../src/routing/health-tracker.js';

describe('Unit: Cost-Aware Router & Decision Matrix', () => {
  let tracker: HealthTracker;
  let router: CostAwareRouter;
  const connectors = [stripeConnector, adyenConnector, razorpayConnector];

  const baseIntent: PaymentIntent = {
    id: 'pay_test_unit_01',
    amount: 100,
    currency: 'USD',
    paymentMethod: 'card',
    card: {
      number: '4242424242424242',
      expMonth: 12,
      expYear: 2028,
      cvv: '123',
      holderName: 'Jane Doe',
    },
    billingCountry: 'US',
    merchantId: 'merch_test',
    createdAt: new Date(),
  };

  beforeEach(() => {
    tracker = new HealthTracker();
    router = new CostAwareRouter(tracker, { healthFloorThreshold: 0.85 });
  });

  it('Happy Path: Selects cheapest healthy connector (Adyen over Stripe)', () => {
    const decision = router.evaluate(baseIntent, connectors);

    assert.equal(decision.strategy, 'least_cost');
    assert.equal(decision.selectedConnector, 'adyen');
    assert.ok(decision.fallbackCandidates.includes('stripe'));

    const adyenEval = decision.evaluationMatrix.find((c) => c.connectorId === 'adyen');
    const stripeEval = decision.evaluationMatrix.find((c) => c.connectorId === 'stripe');

    assert.ok(adyenEval?.selected, 'Adyen should be selected as primary');
    assert.ok(!stripeEval?.selected, 'Stripe should not be selected');
    assert.equal(stripeEval?.status, 'rejected_higher_cost');
  });

  it('Edge Case 1: Rejects cheapest connector if success rate drops below 85% health floor', () => {
    // Degrade Adyen to 65% (below 85% floor)
    tracker.setManualOverride('adyen', 0.65);

    const decision = router.evaluate(baseIntent, connectors);

    // Adyen ($1.21) is degraded, next cheapest healthy connector is Razorpay ($2.00), followed by Stripe ($3.20)
    assert.equal(decision.strategy, 'least_cost');
    assert.equal(decision.selectedConnector, 'razorpay');

    const adyenEval = decision.evaluationMatrix.find((c) => c.connectorId === 'adyen');
    assert.equal(adyenEval?.passedHealthFloor, false);
    assert.equal(adyenEval?.status, 'rejected_below_health_floor');
    assert.ok(adyenEval?.rejectionReason?.includes('below the 85% health floor'));
  });

  it('Edge Case 2: Correctly rejects connectors that do not support the currency', () => {
    const gbpIntent: PaymentIntent = {
      ...baseIntent,
      currency: 'GBP',
      billingCountry: 'GB',
    };

    const decision = router.evaluate(gbpIntent, connectors);

    // Razorpay does not support GBP in our config
    const razorpayEval = decision.evaluationMatrix.find((c) => c.connectorId === 'razorpay');
    assert.equal(razorpayEval?.status, 'rejected_unsupported_currency');
    assert.ok(razorpayEval?.rejectionReason?.includes("Currency 'GBP' is not supported"));
  });

  it('Failure Mode / Graceful Degradation: All connectors below floor -> selects highest availability', () => {
    // Simulate severe multi-gateway industry outage
    tracker.setManualOverride('stripe', 0.80);
    tracker.setManualOverride('adyen', 0.60);
    tracker.setManualOverride('razorpay', 0.70);

    const decision = router.evaluate(baseIntent, connectors);

    // Does NOT crash or drop payment: gracefully degrades to highest availability connector (Stripe at 80%)
    assert.equal(decision.strategy, 'graceful_degradation');
    assert.equal(decision.selectedConnector, 'stripe');
    assert.ok(decision.reason.includes('Gracefully degraded to highest-availability connector'));

    const stripeEval = decision.evaluationMatrix.find((c) => c.connectorId === 'stripe');
    assert.equal(stripeEval?.status, 'chosen_graceful_degradation');
  });
});
