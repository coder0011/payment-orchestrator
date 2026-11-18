import crypto from 'node:crypto';
import type { ConnectorPricingConfig } from '../config/connectors.config.js';
import type {
  ConnectorId,
  ConnectorQuote,
  Currency,
  DeclineType,
  PaymentIntent,
  TransactionTuple,
} from '../domain/entities.js';
import { CircuitBreaker } from './circuit-breaker.js';
import type { ConnectorExecutionResult, IPaymentConnector } from './connector.interface.js';

export abstract class BaseConnector implements IPaymentConnector {
  abstract readonly id: ConnectorId;
  abstract readonly name: string;
  readonly circuitBreaker: CircuitBreaker;

  protected simulatedFailure: { declineType: DeclineType; reason: string } | null = null;
  protected overrideLatencyMs: number | null = null;

  constructor(protected readonly config: ConnectorPricingConfig) {
    this.circuitBreaker = new CircuitBreaker(config ? 'unnamed' : 'base');
  }

  get supportedCurrencies(): readonly Currency[] {
    return this.config.supportedCurrencies;
  }

  get supportedCountries(): readonly string[] {
    return this.config.supportedCountries;
  }

  supportsCurrency(currency: Currency): boolean {
    return this.config.supportedCurrencies.includes(currency);
  }

  supportsCountry(country: string): boolean {
    if (this.config.supportedCountries.includes('GLOBAL')) {
      return true;
    }
    return this.config.supportedCountries.includes(country.toUpperCase());
  }

  /**
   * Quotes the transaction processing fee for a given transaction tuple.
   */
  quoteFee(tuple: TransactionTuple): ConnectorQuote {
    const fixed = this.config.fixedFee[tuple.currency] ?? 0;
    let percentage = tuple.amount * this.config.percentageRate;

    // Apply cap if defined for this currency
    const cap = this.config.percentageFeeCap?.[tuple.currency];
    if (cap !== undefined && percentage > cap) {
      percentage = cap;
    }

    // Cross-border FX markup applied if card country != merchant acquiring country
    const isCrossBorder = tuple.billingCountry.toUpperCase() !== tuple.merchantCountry.toUpperCase();
    const fxMarkup = isCrossBorder ? tuple.amount * this.config.crossBorderMarkupRate : 0;

    const total = parseFloat((fixed + percentage + fxMarkup).toFixed(4));

    return {
      connectorId: this.id,
      feeBreakdown: {
        fixed: parseFloat(fixed.toFixed(4)),
        percentage: parseFloat(percentage.toFixed(4)),
        fxMarkup: parseFloat(fxMarkup.toFixed(4)),
        total,
      },
      currency: tuple.currency,
    };
  }

  /**
   * Authorizes the payment against the simulated upstream gateway.
   */
  async authorize(intent: PaymentIntent): Promise<ConnectorExecutionResult> {
    return this.circuitBreaker.execute(async () => {
      const latency = this.overrideLatencyMs ?? this.config.simulatedLatencyMs;
      if (latency > 0) {
        await new Promise((resolve) => setTimeout(resolve, latency));
      }

      // Check simulated failure override (used for test scenarios)
      if (this.simulatedFailure) {
        const failure = this.simulatedFailure;
        return {
          connectorId: this.id,
          status: 'failed',
          externalTransactionId: `txn_${this.id}_${crypto.randomUUID()}`,
          latencyMs: latency,
          declineType: failure.declineType,
          declineReason: failure.reason,
          rawResponse: {
            error: {
              type: failure.declineType,
              message: failure.reason,
            },
          },
        };
      }

      // Default successful authorization
      return {
        connectorId: this.id,
        status: 'succeeded',
        externalTransactionId: `txn_${this.id}_${crypto.randomUUID()}`,
        latencyMs: latency,
        rawResponse: {
          chargeId: `ch_${crypto.randomBytes(12).toString('hex')}`,
          status: 'paid',
          amountCaptured: intent.amount,
          currency: intent.currency,
        },
      };
    });
  }

  simulateFailure(declineType: DeclineType, reason: string): void {
    this.simulatedFailure = { declineType, reason };
  }

  simulateLatency(ms: number): void {
    this.overrideLatencyMs = ms;
  }

  resetSimulations(): void {
    this.simulatedFailure = null;
    this.overrideLatencyMs = null;
    this.circuitBreaker.reset();
  }
}
