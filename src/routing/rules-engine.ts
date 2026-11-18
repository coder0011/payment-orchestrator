import { z } from 'zod';
import type { ConnectorId, Currency, TransactionTuple } from '../domain/entities.js';

export const ruleOperatorSchema = z.enum([
  'EQUAL',
  'NOT_EQUAL',
  'GREATER_THAN',
  'LESS_THAN',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN_OR_EQUAL',
  'IN',
  'NOT_IN',
]);

export type RuleOperator = z.infer<typeof ruleOperatorSchema>;

export const ruleFieldSchema = z.enum([
  'amount',
  'currency',
  'cardBin',
  'billingCountry',
  'merchantCountry',
]);

export type RuleField = z.infer<typeof ruleFieldSchema>;

export const ruleConditionSchema = z.object({
  field: ruleFieldSchema,
  operator: ruleOperatorSchema,
  value: z.union([z.string(), z.number(), z.array(z.string())]),
});

export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const dynamicRoutingRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  priority: z.number().default(0), // Higher priority rules evaluate first
  conditions: z.array(ruleConditionSchema),
  actions: z.object({
    preferredConnectors: z.array(z.enum(['stripe', 'adyen', 'razorpay'])),
    minHealthFloor: z.number().min(0).max(1).optional(),
    strategy: z.enum(['priority', 'least_cost_within_selection']).default('least_cost_within_selection'),
  }),
});

export type DynamicRoutingRule = z.infer<typeof dynamicRoutingRuleSchema>;

export class RulesEngine {
  private rules: DynamicRoutingRule[] = [];

  setRules(rules: DynamicRoutingRule[]): void {
    // Sort descending by priority so high priority rules match first
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  getRules(): DynamicRoutingRule[] {
    return [...this.rules];
  }

  clearRules(): void {
    this.rules = [];
  }

  /**
   * Evaluates a single condition against a transaction tuple.
   */
  evaluateCondition(condition: RuleCondition, tuple: TransactionTuple): boolean {
    const rawVal = tuple[condition.field];

    switch (condition.operator) {
      case 'EQUAL':
        return typeof rawVal === 'string'
          ? rawVal.toUpperCase() === String(condition.value).toUpperCase()
          : rawVal === condition.value;

      case 'NOT_EQUAL':
        return typeof rawVal === 'string'
          ? rawVal.toUpperCase() !== String(condition.value).toUpperCase()
          : rawVal !== condition.value;

      case 'GREATER_THAN':
        return typeof rawVal === 'number' && typeof condition.value === 'number' && rawVal > condition.value;

      case 'LESS_THAN':
        return typeof rawVal === 'number' && typeof condition.value === 'number' && rawVal < condition.value;

      case 'GREATER_THAN_OR_EQUAL':
        return typeof rawVal === 'number' && typeof condition.value === 'number' && rawVal >= condition.value;

      case 'LESS_THAN_OR_EQUAL':
        return typeof rawVal === 'number' && typeof condition.value === 'number' && rawVal <= condition.value;

      case 'IN':
        if (Array.isArray(condition.value)) {
          const list = condition.value.map((v) => String(v).toUpperCase());
          return list.includes(String(rawVal).toUpperCase());
        }
        return false;

      case 'NOT_IN':
        if (Array.isArray(condition.value)) {
          const list = condition.value.map((v) => String(v).toUpperCase());
          return !list.includes(String(rawVal).toUpperCase());
        }
        return true;

      default:
        return false;
    }
  }

  /**
   * Finds the first matching rule for a given transaction tuple.
   */
  findMatchingRule(tuple: TransactionTuple): DynamicRoutingRule | null {
    for (const rule of this.rules) {
      const matchesAll = rule.conditions.every((c) => this.evaluateCondition(c, tuple));
      if (matchesAll) {
        return rule;
      }
    }
    return null;
  }
}

export const rulesEngine = new RulesEngine();
