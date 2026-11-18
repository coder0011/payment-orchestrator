import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { HealthTracker } from '../../src/routing/health-tracker.js';

describe('Unit: Connector Health & First Attempt Authorization Rate Tracker', () => {
  let tracker: HealthTracker;

  beforeEach(() => {
    tracker = new HealthTracker(10); // Small window for fast testing
  });

  it('initializes with baseline success rates', () => {
    const stripeRate = tracker.getSuccessRate('stripe');
    const adyenRate = tracker.getSuccessRate('adyen');
    const razorpayRate = tracker.getSuccessRate('razorpay');

    assert.ok(stripeRate >= 0.98, 'Stripe baseline should be >= 98%');
    assert.ok(adyenRate >= 0.95, 'Adyen baseline should be >= 95%');
    assert.ok(razorpayRate >= 0.90, 'Razorpay baseline should be >= 90%');
  });

  it('updates success rate as failures occur', () => {
    // Record 5 consecutive failures for Adyen
    for (let i = 0; i < 5; i++) {
      tracker.recordOutcome('adyen', false);
    }

    const degradedRate = tracker.getSuccessRate('adyen');
    assert.ok(degradedRate < 0.85, `Expected Adyen to drop below 85% floor, got ${(degradedRate * 100).toFixed(1)}%`);
  });

  it('supports manual overrides for deterministic scenario testing', () => {
    tracker.setManualOverride('stripe', 0.50);
    assert.equal(tracker.getSuccessRate('stripe'), 0.50);

    tracker.reset();
    assert.ok(tracker.getSuccessRate('stripe') > 0.95, 'Reset restores baseline health');
  });
});
