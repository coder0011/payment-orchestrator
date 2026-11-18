import type { CompleteRoutingTrace } from '../domain/routing-trace.js';

export class TraceService {
  private readonly traces = new Map<string, CompleteRoutingTrace>();

  saveTrace(trace: CompleteRoutingTrace): void {
    this.traces.set(trace.paymentId, trace);
  }

  getTrace(paymentId: string): CompleteRoutingTrace | undefined {
    return this.traces.get(paymentId);
  }

  clear(): void {
    this.traces.clear();
  }

  size(): number {
    return this.traces.size;
  }
}

export const traceService = new TraceService();
