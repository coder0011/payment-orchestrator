import crypto from 'node:crypto';
import type { IPaymentConnector } from '../connectors/connector.interface.js';
import { adyenConnector } from '../connectors/adyen.connector.js';
import { razorpayConnector } from '../connectors/razorpay.connector.js';
import { stripeConnector } from '../connectors/stripe.connector.js';
import type {
  ConnectorId,
  PaymentAttemptRecord,
  PaymentIntent,
  PaymentResult,
  PaymentStatus,
} from '../domain/entities.js';
import { PaymentDeclinedError } from '../domain/errors.js';
import type { CompleteRoutingTrace } from '../domain/routing-trace.js';
import {
  cascadeAttemptsTotal,
  paymentProcessingDurationSeconds,
  paymentRequestsTotal,
} from '../observability/metrics.js';
import { costAwareRouter, CostAwareRouter } from '../routing/cost-aware-router.js';
import { healthTracker, HealthTracker } from '../routing/health-tracker.js';
import { idempotencyService, IdempotencyService } from '../security/idempotency.js';
import { PiiService } from '../security/pii.js';
import { traceService, TraceService } from './trace.service.js';

export interface ProcessPaymentOptions {
  connectors?: IPaymentConnector[];
}

export class PaymentService {
  private readonly connectorsMap: Map<ConnectorId, IPaymentConnector>;
  private readonly allConnectors: IPaymentConnector[];

  constructor(
    private readonly router: CostAwareRouter = costAwareRouter,
    private readonly idempotency: IdempotencyService = idempotencyService,
    private readonly traces: TraceService = traceService,
    private readonly health: HealthTracker = healthTracker,
    customConnectors?: IPaymentConnector[]
  ) {
    this.allConnectors = customConnectors ?? [stripeConnector, adyenConnector, razorpayConnector];
    this.connectorsMap = new Map(this.allConnectors.map((c) => [c.id, c]));
  }

  /**
   * Orchestrates the complete payment lifecycle:
   * 1. Check idempotency claim
   * 2. Evaluate multi-objective routing matrix
   * 3. Execute primary connector
   * 4. Cascades automatically on soft decline
   * 5. Persists decision trace & metrics
   * 6. Commits idempotency reservation
   */
  async processPayment(
    intent: PaymentIntent,
    options: ProcessPaymentOptions = {}
  ): Promise<{ result: PaymentResult; isReplayed: boolean }> {
    const startTime = Date.now();
    const candidateConnectors = options.connectors ?? this.allConnectors;

    // Phase 1: Two-Phase Idempotency Claim
    if (intent.idempotencyKey) {
      const claimResult = await this.idempotency.claim(intent.idempotencyKey, {
        amount: intent.amount,
        currency: intent.currency,
        cardLast4: PiiService.extractLast4(intent.card.number),
        billingCountry: intent.billingCountry,
      });

      if (claimResult.status === 'REPLAYED') {
        return { result: claimResult.result, isReplayed: true };
      }
    }

    try {
      // Phase 2: Multi-Objective Routing Evaluation
      const decision = this.router.evaluate(intent, candidateConnectors);

      const attempts: PaymentAttemptRecord[] = [];
      const executionChain: ConnectorId[] = [
        decision.selectedConnector,
        ...decision.fallbackCandidates,
      ];

      let finalStatus: PaymentStatus = 'failed';
      let finalConnector: ConnectorId = decision.selectedConnector;
      let lastDeclineReason: string | undefined;
      let lastDeclineType: 'soft' | 'hard' = 'hard';

      // Phase 3: Chain of Responsibility Execution & Cascading
      for (let i = 0; i < executionChain.length; i++) {
        const connectorId = executionChain[i]!;
        const connector = this.connectorsMap.get(connectorId);
        if (!connector) continue;

        const attemptStart = Date.now();
        let attemptResult;

        try {
          attemptResult = await connector.authorize(intent);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Unknown connector execution error';
          attemptResult = {
            connectorId,
            status: 'failed' as PaymentStatus,
            externalTransactionId: `err_${crypto.randomUUID()}`,
            latencyMs: Date.now() - attemptStart,
            declineType: 'soft' as const,
            declineReason: errMsg,
            rawResponse: { error: errMsg },
          };
        }

        const latencyMs = attemptResult.latencyMs || Date.now() - attemptStart;
        const isSuccess = attemptResult.status === 'succeeded';

        // Update connector rolling health
        this.health.recordOutcome(connectorId, isSuccess);

        attempts.push({
          attemptNumber: i + 1,
          connectorId,
          status: attemptResult.status,
          latencyMs,
          declineType: attemptResult.declineType,
          declineReason: attemptResult.declineReason,
          timestamp: new Date().toISOString(),
        });

        if (isSuccess) {
          finalStatus = 'succeeded';
          finalConnector = connectorId;
          break;
        }

        // Handle Declines
        lastDeclineReason = attemptResult.declineReason;
        lastDeclineType = attemptResult.declineType ?? 'hard';

        if (lastDeclineType === 'hard') {
          // Hard decline (stolen card / invalid CVV / fraud block) -> Stop cascade immediately
          finalStatus = 'failed';
          finalConnector = connectorId;
          break;
        }

        // Soft decline -> Cascade to next candidate if available
        if (i < executionChain.length - 1) {
          const nextConnector = executionChain[i + 1]!;
          cascadeAttemptsTotal.inc({
            from_connector: connectorId,
            to_connector: nextConnector,
          });
        }
      }

      const totalLatencyMs = Date.now() - startTime;
      const totalDurationSec = totalLatencyMs / 1000;

      // Telemetry
      paymentProcessingDurationSeconds.observe(
        { connector: finalConnector, status: finalStatus },
        totalDurationSec
      );

      paymentRequestsTotal.inc({
        status: finalStatus,
        currency: intent.currency,
        connector: finalConnector,
      });

      // Assemble Decision & Execution Trace (Memento Pattern)
      const primaryQuote = this.connectorsMap.get(finalConnector)?.quoteFee({
        amount: intent.amount,
        currency: intent.currency,
        cardBin: PiiService.extractBin(intent.card.number),
        billingCountry: intent.billingCountry,
        merchantCountry: 'US',
      });

      const calculatedCost = primaryQuote ? primaryQuote.feeBreakdown.total : 0;
      const wasCascaded = attempts.length > 1;

      const completeTrace: CompleteRoutingTrace = {
        paymentId: intent.id,
        decision,
        executionTrace: {
          attempts,
          finalConnector,
          finalStatus,
          totalLatencyMs,
          wasCascaded,
        },
      };

      this.traces.saveTrace(completeTrace);

      // Assemble Payment Result
      const result: PaymentResult = {
        paymentId: intent.id,
        status: finalStatus,
        amount: intent.amount,
        currency: intent.currency,
        connector: finalConnector,
        maskedCard: PiiService.maskCardNumber(intent.card.number),
        routingSummary: {
          selectedConnector: finalConnector,
          calculatedCost,
          currency: intent.currency,
          reason: wasCascaded
            ? `Cascaded to ${finalConnector} after primary decline: ${lastDeclineReason}`
            : decision.reason,
          strategy: wasCascaded ? 'fallback_cascade' : decision.strategy,
        },
        attempts,
        createdAt: new Date().toISOString(),
      };

      // Phase 4: Commit Idempotency
      if (intent.idempotencyKey) {
        await this.idempotency.commit(intent.idempotencyKey, result);
      }

      if (finalStatus === 'failed') {
        throw new PaymentDeclinedError(
          lastDeclineReason ?? 'Payment authorization declined by upstream connector',
          finalConnector,
          lastDeclineType
        );
      }

      return { result, isReplayed: false };
    } catch (err) {
      if (intent.idempotencyKey && !(err instanceof PaymentDeclinedError)) {
        await this.idempotency.release(intent.idempotencyKey);
      }
      throw err;
    }
  }
}

export const paymentService = new PaymentService();
