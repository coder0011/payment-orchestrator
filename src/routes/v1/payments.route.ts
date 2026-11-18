import { Router } from 'express';
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

export const paymentsRouter: Router = Router();

// POST /payments
paymentsRouter.post('/payments', async (req, res, next) => {
  try {
    const parseResult = createPaymentBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError('Invalid payment request payload', parseResult.error.format());
    }

    const body = parseResult.data;
    const idempotencyKey =
      (req.headers['idempotency-key'] as string | undefined) ??
      (req.headers['x-idempotency-key'] as string | undefined);

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
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(200).json(result);
      return;
    }

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /payments/:id
paymentsRouter.get('/payments/:id', async (req, res, next) => {
  try {
    const paymentId = req.params['id'];
    if (!paymentId) {
      throw new ValidationError('Payment ID parameter required');
    }

    const trace = traceService.getTrace(paymentId);
    if (!trace) {
      throw new NotFoundError('Payment', paymentId);
    }

    res.status(200).json({
      paymentId: trace.paymentId,
      status: trace.executionTrace.finalStatus,
      amount: trace.decision.input.amount,
      currency: trace.decision.input.currency,
      connector: trace.executionTrace.finalConnector,
      evaluatedAt: trace.decision.evaluatedAt,
      strategy: trace.decision.strategy,
    });
  } catch (err) {
    next(err);
  }
});
