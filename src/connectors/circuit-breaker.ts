import { connectorCircuitBreakerState } from '../observability/metrics.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Consecutive failures to trip (default: 5)
  recoveryTimeMs?: number; // Cooldown before HALF_OPEN (default: 15,000ms)
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private lastStateChange: number = Date.now();
  private readonly failureThreshold: number;
  private readonly recoveryTimeMs: number;

  constructor(readonly name: string, options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeMs = options.recoveryTimeMs ?? 15000;
    this.updateGauge();
  }

  getState(): CircuitState {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed >= this.recoveryTimeMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = Date.now();
        this.updateGauge();
      }
    }
    return this.state;
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      throw new Error(`Circuit breaker for '${this.name}' is OPEN. Requests temporarily halted.`);
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failureCount = 0;
      this.lastStateChange = Date.now();
      this.updateGauge();
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
      this.updateGauge();
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastStateChange = Date.now();
    this.updateGauge();
  }

  trip(): void {
    this.state = 'OPEN';
    this.lastStateChange = Date.now();
    this.updateGauge();
  }

  private updateGauge(): void {
    const numericState = this.state === 'CLOSED' ? 0 : this.state === 'HALF_OPEN' ? 1 : 2;
    connectorCircuitBreakerState.set({ connector: this.name }, numericState);
  }
}
