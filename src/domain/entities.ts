export type Currency = 'USD' | 'EUR' | 'INR' | 'GBP';

export type ConnectorId = 'stripe' | 'adyen' | 'razorpay';

export type PaymentStatus = 'succeeded' | 'failed' | 'processing' | 'requires_customer_action';

export type PaymentMethodType = 'card';

export type DeclineType = 'soft' | 'hard';

export interface CardData {
  number: string;
  expMonth: number;
  expYear: number;
  cvv: string;
  holderName: string;
}

export interface SanitizedCardData {
  maskedNumber: string;
  bin: string;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName: string;
}

export interface TransactionTuple {
  amount: number;
  currency: Currency;
  cardBin: string;
  billingCountry: string;
  merchantCountry: string;
}

export interface FeeBreakdown {
  fixed: number;
  percentage: number;
  fxMarkup: number;
  total: number;
}

export interface ConnectorQuote {
  connectorId: ConnectorId;
  feeBreakdown: FeeBreakdown;
  currency: Currency;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: Currency;
  paymentMethod: PaymentMethodType;
  card: CardData;
  billingCountry: string;
  merchantId: string;
  idempotencyKey?: string | undefined;
  createdAt: Date;
}

export interface PaymentAttemptRecord {
  attemptNumber: number;
  connectorId: ConnectorId;
  status: PaymentStatus;
  latencyMs: number;
  declineType?: DeclineType | undefined;
  declineReason?: string | undefined;
  timestamp: string;
}

export interface RoutingSummary {
  selectedConnector: ConnectorId;
  calculatedCost: number;
  currency: Currency;
  reason: string;
  strategy: 'least_cost' | 'graceful_degradation' | 'fallback_cascade' | 'rule_priority';
}

export interface PaymentResult {
  paymentId: string;
  status: PaymentStatus;
  amount: number;
  currency: Currency;
  connector: ConnectorId;
  maskedCard: string;
  routingSummary: RoutingSummary;
  attempts: PaymentAttemptRecord[];
  createdAt: string;
}
