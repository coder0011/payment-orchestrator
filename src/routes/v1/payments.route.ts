import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { PaymentIntent } from '../../domain/entities.js';
import { NotFoundError, ValidationError } from '../../domain/errors.js';
import { paymentService } from '../../services/payment.service.js';
import { traceService } from '../../services/trace.service.js';

export const createPaymentBodySchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  currency: z.enum(['USD', 'EUR', 'INR', 'GBP']),
  paymentMethod: z.literal('card').default('card'),
  card: z.object({
    number: z.string().min(12).max(19),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2025).max(2045),
    cvv: z.string().min(3).max(4),
    holderName: z.string().min(1),
  }),
  billingCountry: z.string().length(2).toUpperCase(),
  merchantId: z.string().optional().default('default_merchant'),
});

export type CreatePaymentBody = z.infer<typeof createPaymentBodySchema>;

export const paymentsRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/payments (or /payments)
  fastify.post('/payments', async (request, reply) => {
    // 1. Validate payload using strict Zod schema
    const parseResult = createPaymentBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Invalid payment request payload', parseResult.error.format());
    }

    const body = parseResult.data;
    const idempotencyKey =
      (request.headers['idempotency-key'] as string | undefined) ??
      (request.headers['x-idempotency-key'] as string | undefined);

    const intent: PaymentIntent = {
      id: `pay_${crypto.randomBytes(12).toString('hex')}`,
      amount: body.amount,
      currency: body.currency,
      paymentMethod: body.paymentMethod,
      card: body.card,
      billingCountry: body.billingCountry,
      merchantId: body.merchantId,
      idempotencyKey,
      createdAt: new Date(),
    };

    const { result, isReplayed } = await paymentService.processPayment(intent);

    if (isReplayed) {
      reply.header('Idempotent-Replayed', 'true');
      return reply.status(200).send(result);
    }

    return reply.status(201).send(result);
  });

  // GET /v1/payments/:id
  fastify.get<{ Params: { id: string } }>('/payments/:id', async (request, reply) => {
    const trace = traceService.getTrace(request.params.id);
    if (!trace) {
      throw new NotFoundError('Payment', request.params.id);
    }

    return reply.status(200).send({
      paymentId: trace.paymentId,
      status: trace.executionTrace.finalStatus,
      amount: trace.decision.input.amount,
      currency: trace.decision.input.currency,
      connector: trace.executionTrace.finalConnector,
      evaluatedAt: trace.decision.evaluatedAt,
      strategy: trace.decision.strategy,
    });
  });
};
