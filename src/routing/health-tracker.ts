import { CONNECTORS_CONFIG } from '../config/connectors.config.js';
import type { ConnectorId } from '../domain/entities.js';

interface HealthStats {
  successes: number;
  total: number;
  manualOverrideRate: number | null;
}

export class HealthTracker {
  private readonly stats = new Map<ConnectorId, HealthStats>();
  private readonly windowSize: number;

  constructor(windowSize: number = 100) {
    this.windowSize = windowSize;
    this.initializeBaselines();
  }

  private initializeBaselines(): void {
    const connectorIds: ConnectorId[] = ['stripe', 'adyen', 'razorpay'];
    for (const id of connectorIds) {
      const baseline = CONNECTORS_CONFIG[id].baselineSuccessRate;
      const successes = Math.round(baseline * this.windowSize);
      this.stats.set(id, {
        successes,
        total: this.windowSize,
        manualOverrideRate: null,
      });
    }
  }

  /**
   * Records a transaction outcome for a connector.
   */
  recordOutcome(connectorId: ConnectorId, success: boolean): void {
    const current = this.stats.get(connectorId);
    if (!current) return;

    // Moving window calculation
    if (current.total >= this.windowSize) {
      const currentRate = current.successes / current.total;
      current.successes = Math.round(currentRate * (this.windowSize - 1)) + (success ? 1 : 0);
      current.total = this.windowSize;
    } else {
      current.total++;
      if (success) {
        current.successes++;
      }
    }
  }

  /**
   * Returns current First Attempt Authorization Rate (FAAR) as a float between 0.0 and 1.0.
   */
  getSuccessRate(connectorId: ConnectorId): number {
    const current = this.stats.get(connectorId);
    if (!current) return 0;

    if (current.manualOverrideRate !== null) {
      return current.manualOverrideRate;
    }

    if (current.total === 0) {
      return CONNECTORS_CONFIG[connectorId].baselineSuccessRate;
    }

    return parseFloat((current.successes / current.total).toFixed(4));
  }

  /**
   * Manually overrides success rate (used for testing and demo degradation scenarios)
   */
  setManualOverride(connectorId: ConnectorId, rate: number): void {
    const current = this.stats.get(connectorId);
    if (current) {
      current.manualOverrideRate = rate;
    }
  }

  /**
   * Clears manual overrides and restores default baseline health
   */
  reset(): void {
    this.stats.clear();
    this.initializeBaselines();
  }
}

export const healthTracker = new HealthTracker();
