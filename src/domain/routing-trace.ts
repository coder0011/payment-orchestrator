import type { ConnectorId, Currency, FeeBreakdown, PaymentAttemptRecord } from './entities.js';

export type CandidateEvaluationStatus =
  | 'chosen_primary'
  | 'rejected_higher_cost'
  | 'rejected_below_health_floor'
  | 'rejected_unsupported_currency'
  | 'rejected_unsupported_country'
  | 'chosen_graceful_degradation';

export interface EvaluatedCandidate {
  connectorId: ConnectorId;
  feeBreakdown: FeeBreakdown;
  calculatedCost: number;
  successRate: number;
  passedHealthFloor: boolean;
  selected: boolean;
  status: CandidateEvaluationStatus;
  rejectionReason?: string | undefined;
}

export interface RoutingDecision {
  paymentId: string;
  evaluatedAt: string;
  input: {
    amount: number;
    currency: Currency;
    cardBin: string;
    billingCountry: string;
    merchantCountry: string;
  };
  healthFloorThreshold: number;
  evaluationMatrix: EvaluatedCandidate[];
  selectedConnector: ConnectorId;
  fallbackCandidates: ConnectorId[];
  strategy: 'least_cost' | 'graceful_degradation' | 'rule_priority';
  reason: string;
  matchedRule?: string | undefined;
}

export interface CompleteRoutingTrace {
  paymentId: string;
  decision: RoutingDecision;
  executionTrace: {
    attempts: PaymentAttemptRecord[];
    finalConnector: ConnectorId;
    finalStatus: string;
    totalLatencyMs: number;
    wasCascaded: boolean;
  };
}
