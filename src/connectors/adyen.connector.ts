import { CONNECTORS_CONFIG } from '../config/connectors.config.js';
import type { ConnectorId } from '../domain/entities.js';
import { BaseConnector } from './base.connector.js';
import { CircuitBreaker } from './circuit-breaker.js';

export class AdyenConnector extends BaseConnector {
  readonly id: ConnectorId = 'adyen';
  readonly name: string = 'Adyen Acquiring';
  override readonly circuitBreaker: CircuitBreaker;

  constructor() {
    super(CONNECTORS_CONFIG.adyen);
    this.circuitBreaker = new CircuitBreaker('adyen', {
      failureThreshold: 5,
      recoveryTimeMs: 15000,
    });
  }
}

export const adyenConnector = new AdyenConnector();
