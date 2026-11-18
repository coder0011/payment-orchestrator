import { CONNECTORS_CONFIG } from '../config/connectors.config.js';
import type { ConnectorId } from '../domain/entities.js';
import { BaseConnector } from './base.connector.js';
import { CircuitBreaker } from './circuit-breaker.js';

export class StripeConnector extends BaseConnector {
  readonly id: ConnectorId = 'stripe';
  readonly name: string = 'Stripe Payments';
  override readonly circuitBreaker: CircuitBreaker;

  constructor() {
    super(CONNECTORS_CONFIG.stripe);
    this.circuitBreaker = new CircuitBreaker('stripe', {
      failureThreshold: 5,
      recoveryTimeMs: 15000,
    });
  }
}

export const stripeConnector = new StripeConnector();
