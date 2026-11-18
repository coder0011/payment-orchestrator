import { CONNECTORS_CONFIG } from '../config/connectors.config.js';
import type { ConnectorId } from '../domain/entities.js';
import { BaseConnector } from './base.connector.js';
import { CircuitBreaker } from './circuit-breaker.js';

export class RazorpayConnector extends BaseConnector {
  readonly id: ConnectorId = 'razorpay';
  readonly name: string = 'Razorpay Core';
  override readonly circuitBreaker: CircuitBreaker;

  constructor() {
    super(CONNECTORS_CONFIG.razorpay);
    this.circuitBreaker = new CircuitBreaker('razorpay', {
      failureThreshold: 5,
      recoveryTimeMs: 15000,
    });
  }
}

export const razorpayConnector = new RazorpayConnector();
