import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { TransactionTuple } from '../../src/domain/entities.js';
import { type DynamicRoutingRule, RulesEngine } from '../../src/routing/rules-engine.js';

describe('Unit: Euclid-Style Dynamic Routing Rules Engine', () => {
  let engine: RulesEngine;

  const sampleTuple: TransactionTuple = {
    amount: 1500,
    currency: 'USD',
    cardBin: '424242',
    billingCountry: 'US',
    merchantCountry: 'US',
  };

  beforeEach(() => {
    engine = new RulesEngine();
  });

  it('evaluates comparison operators correctly', () => {
    // GREATER_THAN
    assert.ok(
      engine.evaluateCondition(
        { field: 'amount', operator: 'GREATER_THAN', value: 1000 },
        sampleTuple
      )
    );
    assert.ok(
      !engine.evaluateCondition(
        { field: 'amount', operator: 'GREATER_THAN', value: 2000 },
        sampleTuple
      )
    );

    // EQUAL
    assert.ok(
      engine.evaluateCondition(
        { field: 'currency', operator: 'EQUAL', value: 'usd' },
        sampleTuple
      )
    );

    // IN
    assert.ok(
      engine.evaluateCondition(
        { field: 'billingCountry', operator: 'IN', value: ['US', 'CA', 'GB'] },
        sampleTuple
      )
    );
    assert.ok(
      !engine.evaluateCondition(
        { field: 'billingCountry', operator: 'IN', value: ['IN', 'SG'] },
        sampleTuple
      )
    );
  });

  it('matches rules in priority order', () => {
    const lowPriorityRule: DynamicRoutingRule = {
      id: 'rule_low',
      name: 'Catch-all USD',
      priority: 1,
      conditions: [{ field: 'currency', operator: 'EQUAL', value: 'USD' }],
      actions: {
        preferredConnectors: ['stripe'],
        strategy: 'priority',
      },
    };

    const highPriorityRule: DynamicRoutingRule = {
      id: 'rule_high',
      name: 'High-value USD VIP',
      priority: 10,
      conditions: [
        { field: 'currency', operator: 'EQUAL', value: 'USD' },
        { field: 'amount', operator: 'GREATER_THAN', value: 1000 },
      ],
      actions: {
        preferredConnectors: ['adyen'],
        strategy: 'priority',
      },
    };

    engine.setRules([lowPriorityRule, highPriorityRule]);

    const matched = engine.findMatchingRule(sampleTuple);
    assert.ok(matched !== null);
    assert.equal(matched?.id, 'rule_high', 'Higher priority rule should match first');
  });

  it('returns null when no rule conditions match', () => {
    const inrRule: DynamicRoutingRule = {
      id: 'rule_inr',
      name: 'INR Only',
      priority: 5,
      conditions: [{ field: 'currency', operator: 'EQUAL', value: 'INR' }],
      actions: {
        preferredConnectors: ['razorpay'],
        strategy: 'priority',
      },
    };

    engine.setRules([inrRule]);

    const matched = engine.findMatchingRule(sampleTuple);
    assert.equal(matched, null, 'Should return null when conditions do not match');
  });
});
