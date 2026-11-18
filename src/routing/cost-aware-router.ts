import type { IPaymentConnector } from '../connectors/connector.interface.js';
import type {
  ConnectorId,
  PaymentIntent,
  TransactionTuple,
} from '../domain/entities.js';
import { NoEligibleConnectorError } from '../domain/errors.js';
import type { EvaluatedCandidate, RoutingDecision } from '../domain/routing-trace.js';
import { routingDecisionsTotal, routingFloorRejectionsTotal } from '../observability/metrics.js';
import { PiiService } from '../security/pii.js';
import { healthTracker, type HealthTracker } from './health-tracker.js';
import { rulesEngine, type RulesEngine } from './rules-engine.js';

export interface RoutingEngineOptions {
  healthFloorThreshold?: number; // Minimum success rate floor (default: 0.85)
  merchantCountry?: string; // Default merchant acquiring country (default: 'US')
  rulesEngine?: RulesEngine;
}

export class CostAwareRouter {
  private readonly healthFloorThreshold: number;
  private readonly defaultMerchantCountry: string;
  private readonly rules: RulesEngine;

  constructor(
    private readonly tracker: HealthTracker = healthTracker,
    options: RoutingEngineOptions = {}
  ) {
    this.healthFloorThreshold = options.healthFloorThreshold ?? 0.85;
    this.defaultMerchantCountry = options.merchantCountry ?? 'US';
    this.rules = options.rulesEngine ?? rulesEngine;
  }

  /**
   * Evaluates all candidate connectors against cost functions and health floors,
   * returning an auditable RoutingDecision.
   */
  evaluate(
    intent: PaymentIntent,
    connectors: IPaymentConnector[]
  ): RoutingDecision {
    const cardBin = PiiService.extractBin(intent.card.number);
    const merchantCountry = this.defaultMerchantCountry;

    const tuple: TransactionTuple = {
      amount: intent.amount,
      currency: intent.currency,
      cardBin,
      billingCountry: intent.billingCountry,
      merchantCountry,
    };

    // Check for Euclid-style dynamic routing rules
    const matchedRule = this.rules.findMatchingRule(tuple);
    const effectiveFloor = matchedRule?.actions.minHealthFloor ?? this.healthFloorThreshold;

    const evaluationMatrix: EvaluatedCandidate[] = [];
    const eligiblePassingCandidates: Array<{
      connector: IPaymentConnector;
      cost: number;
      rate: number;
      priorityIndex: number;
    }> = [];

    // Step 1: Evaluate each connector
    for (const connector of connectors) {
      // Rule preferred connectors check
      if (
        matchedRule &&
        !matchedRule.actions.preferredConnectors.includes(connector.id)
      ) {
        const quote = connector.quoteFee(tuple);
        evaluationMatrix.push({
          connectorId: connector.id,
          feeBreakdown: quote.feeBreakdown,
          calculatedCost: quote.feeBreakdown.total,
          successRate: this.tracker.getSuccessRate(connector.id),
          passedHealthFloor: true,
          selected: false,
          status: 'rejected_higher_cost',
          rejectionReason: `Connector excluded by dynamic rule '${matchedRule.name}'`,
        });
        continue;
      }

      // Currency check
      if (!connector.supportsCurrency(intent.currency)) {
        const quote = connector.quoteFee(tuple);
        evaluationMatrix.push({
          connectorId: connector.id,
          feeBreakdown: quote.feeBreakdown,
          calculatedCost: quote.feeBreakdown.total,
          successRate: this.tracker.getSuccessRate(connector.id),
          passedHealthFloor: false,
          selected: false,
          status: 'rejected_unsupported_currency',
          rejectionReason: `Currency '${intent.currency}' is not supported by ${connector.name}`,
        });
        continue;
      }

      // Country check
      if (!connector.supportsCountry(intent.billingCountry)) {
        const quote = connector.quoteFee(tuple);
        evaluationMatrix.push({
          connectorId: connector.id,
          feeBreakdown: quote.feeBreakdown,
          calculatedCost: quote.feeBreakdown.total,
          successRate: this.tracker.getSuccessRate(connector.id),
          passedHealthFloor: false,
          selected: false,
          status: 'rejected_unsupported_country',
          rejectionReason: `Billing country '${intent.billingCountry}' is not supported by ${connector.name}`,
        });
        continue;
      }

      const quote = connector.quoteFee(tuple);
      const successRate = this.tracker.getSuccessRate(connector.id);
      const passedFloor = successRate >= effectiveFloor;

      if (!passedFloor) {
        routingFloorRejectionsTotal.inc({
          connector: connector.id,
          reason: 'below_success_rate_floor',
        });

        evaluationMatrix.push({
          connectorId: connector.id,
          feeBreakdown: quote.feeBreakdown,
          calculatedCost: quote.feeBreakdown.total,
          successRate,
          passedHealthFloor: false,
          selected: false,
          status: 'rejected_below_health_floor',
          rejectionReason: `Success rate ${(successRate * 100).toFixed(1)}% is below the ${(
            effectiveFloor * 100
          ).toFixed(0)}% health floor`,
        });
        continue;
      }

      const priorityIndex = matchedRule
        ? matchedRule.actions.preferredConnectors.indexOf(connector.id)
        : 0;

      eligiblePassingCandidates.push({
        connector,
        cost: quote.feeBreakdown.total,
        rate: successRate,
        priorityIndex: priorityIndex === -1 ? 999 : priorityIndex,
      });

      evaluationMatrix.push({
        connectorId: connector.id,
        feeBreakdown: quote.feeBreakdown,
        calculatedCost: quote.feeBreakdown.total,
        successRate,
        passedHealthFloor: true,
        selected: false,
        status: 'chosen_primary', // Will be refined below
      });
    }

    // Step 2: Determine Selected Connector & Strategy
    let selectedConnectorId: ConnectorId;
    let fallbackCandidates: ConnectorId[] = [];
    let strategy: 'least_cost' | 'graceful_degradation' | 'rule_priority';
    let reason: string;

    if (eligiblePassingCandidates.length > 0) {
      if (matchedRule && matchedRule.actions.strategy === 'priority') {
        // Sort strictly by rule priority order
        eligiblePassingCandidates.sort((a, b) => a.priorityIndex - b.priorityIndex);
        strategy = 'rule_priority';
        const primary = eligiblePassingCandidates[0]!;
        selectedConnectorId = primary.connector.id;
        fallbackCandidates = eligiblePassingCandidates.slice(1).map((c) => c.connector.id);
        reason = `Selected primary connector (${selectedConnectorId}) according to dynamic rule '${matchedRule.name}' priority`;
      } else {
        // Normal Mode or least_cost_within_selection: Sort passing candidates by lowest calculated cost
        eligiblePassingCandidates.sort((a, b) => a.cost - b.cost);
        strategy = 'least_cost';
        const primary = eligiblePassingCandidates[0]!;
        selectedConnectorId = primary.connector.id;
        fallbackCandidates = eligiblePassingCandidates.slice(1).map((c) => c.connector.id);
        reason = matchedRule
          ? `Matched rule '${matchedRule.name}'. Selected cheapest preferred connector (${selectedConnectorId}) satisfying the ${(
              effectiveFloor * 100
            ).toFixed(0)}% health floor`
          : `Selected cheapest connector (${selectedConnectorId}) satisfying the ${(
              effectiveFloor * 100
            ).toFixed(0)}% health floor`;
      }

      const primary = eligiblePassingCandidates[0]!;

      // Update evaluation matrix statuses
      for (const item of evaluationMatrix) {
        if (item.connectorId === selectedConnectorId) {
          item.selected = true;
          item.status = 'chosen_primary';
        } else if (item.passedHealthFloor && item.status !== 'rejected_higher_cost') {
          item.selected = false;
          item.status = 'rejected_higher_cost';
          item.rejectionReason = `Cost (${item.calculatedCost}) is higher than chosen primary (${primary.cost})`;
        }
      }
    } else {
      // Graceful Degradation Mode: ALL connectors fell below health floor!
      // Filter candidates that are at least currency/country eligible
      const eligibleConnectors = connectors.filter(
        (c) => c.supportsCurrency(intent.currency) && c.supportsCountry(intent.billingCountry)
      );

      if (eligibleConnectors.length === 0) {
        throw new NoEligibleConnectorError(
          `No connector supports currency '${intent.currency}' and country '${intent.billingCountry}'`
        );
      }

      // Rank by HIGHEST success rate (availability over cost)
      eligibleConnectors.sort(
        (a, b) => this.tracker.getSuccessRate(b.id) - this.tracker.getSuccessRate(a.id)
      );

      const primary = eligibleConnectors[0]!;
      selectedConnectorId = primary.id;
      fallbackCandidates = eligibleConnectors.slice(1).map((c) => c.id);
      strategy = 'graceful_degradation';
      const bestRate = (this.tracker.getSuccessRate(primary.id) * 100).toFixed(1);
      reason = `All connectors fell below the ${(
        effectiveFloor * 100
      ).toFixed(0)}% health floor. Gracefully degraded to highest-availability connector (${selectedConnectorId} at ${bestRate}% SR).`;

      // Update matrix statuses
      for (const item of evaluationMatrix) {
        if (item.connectorId === selectedConnectorId) {
          item.selected = true;
          item.status = 'chosen_graceful_degradation';
        }
      }
    }

    routingDecisionsTotal.inc({
      selected_connector: selectedConnectorId,
      strategy,
    });

    return {
      paymentId: intent.id,
      evaluatedAt: new Date().toISOString(),
      input: {
        amount: intent.amount,
        currency: intent.currency,
        cardBin,
        billingCountry: intent.billingCountry,
        merchantCountry,
      },
      healthFloorThreshold: effectiveFloor,
      evaluationMatrix,
      selectedConnector: selectedConnectorId,
      fallbackCandidates,
      strategy,
      reason,
      matchedRule: matchedRule ? matchedRule.name : undefined,
    };
  }
}

export const costAwareRouter = new CostAwareRouter();

