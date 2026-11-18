import type {
  ConnectorId,
  ConnectorQuote,
  Currency,
  DeclineType,
  PaymentIntent,
  PaymentStatus,
  TransactionTuple,
} from '../domain/entities.js';

export interface ConnectorExecutionResult {
  connectorId: ConnectorId;
  status: PaymentStatus;
  externalTransactionId: string;
  latencyMs: number;
  declineType?: DeclineType;
  declineReason?: string;
  rawResponse: Record<string, unknown>;
}

export interface IPaymentConnector {
  readonly id: ConnectorId;
  readonly name: string;
  readonly supportedCurrencies: readonly Currency[];
  readonly supportedCountries: readonly string[];

  supportsCurrency(currency: Currency): boolean;
  supportsCountry(country: string): boolean;
  quoteFee(tuple: TransactionTuple): ConnectorQuote;
  authorize(intent: PaymentIntent): Promise<ConnectorExecutionResult>;
  resetSimulations(): void;
  simulateFailure(declineType: DeclineType, reason: string): void;
  simulateLatency(ms: number): void;
}
