import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { Application } from 'express';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { idempotencyService } from '../../src/security/idempotency.js';
import { traceService } from '../../src/services/trace.service.js';

describe('Integration: Comprehensive HTTP Validation & RFC 7807 Error Handling', () => {
  const app: Application = buildApp();

  const validBasePayload = {
    amount: 100,
    currency: 'USD',
    paymentMethod: 'card',
    card: {
      number: '4242424242424242',
      expMonth: 12,
      expYear: 2028,
      cvv: '123',
      holderName: 'Jane Doe',
    },
    billingCountry: 'US',
    merchantId: 'merch_test',
  };

  beforeEach(() => {
    idempotencyService.clear();
    traceService.clear();
  });

  it('Rejects negative amount with 400 Bad Request (RFC 7807)', async () => {
    const res = await request(app)
      .post('/v1/payments')
      .send({ ...validBasePayload, amount: -50 });

    assert.equal(res.status, 400);
    assert.equal(res.body.title, 'ValidationError');
    assert.equal(res.body.status, 400);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
    assert.ok(res.body.detail.includes('Invalid payment request payload'));
    assert.ok(res.body.errors);
    assert.ok(res.body.type.includes('validation_failed'));
  });

  it('Rejects zero amount with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/v1/payments')
      .send({ ...validBasePayload, amount: 0 });

    assert.equal(res.status, 400);
    assert.equal(res.body.status, 400);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
  });

  it('Rejects unsupported currency with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/v1/payments')
      .send({ ...validBasePayload, currency: 'JPY' });

    assert.equal(res.status, 400);
    assert.equal(res.body.title, 'ValidationError');
    assert.ok(res.body.errors?.currency);
  });

  it('Rejects invalid card expiry month (> 12) with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/v1/payments')
      .send({
        ...validBasePayload,
        card: { ...validBasePayload.card, expMonth: 13 },
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.title, 'ValidationError');
  });

  it('Rejects expired card year (< 2025) with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/v1/payments')
      .send({
        ...validBasePayload,
        card: { ...validBasePayload.card, expYear: 2020 },
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.title, 'ValidationError');
  });

  it('Rejects invalid CVV length with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/v1/payments')
      .send({
        ...validBasePayload,
        card: { ...validBasePayload.card, cvv: '12' }, // Needs 3-4 chars
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.title, 'ValidationError');
  });

  it('Rejects missing card number with 400 Bad Request', async () => {
    const invalidCard = { ...validBasePayload.card };
    // @ts-expect-error Testing missing property
    delete invalidCard.number;

    const res = await request(app)
      .post('/v1/payments')
      .send({
        ...validBasePayload,
        card: invalidCard,
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.title, 'ValidationError');
  });

  it('Rejects invalid country code length (!= 2) with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/v1/payments')
      .send({
        ...validBasePayload,
        billingCountry: 'USA', // Must be 2-letter ISO
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.title, 'ValidationError');
  });

  it('Rejects idempotency key reuse with mismatched payload with 422 Unprocessable Entity', async () => {
    const key = 'idem-val-test-key';

    // 1. Initial valid request
    const res1 = await request(app)
      .post('/v1/payments')
      .set('idempotency-key', key)
      .send(validBasePayload);
    assert.equal(res1.status, 201);

    // 2. Re-send same key with DIFFERENT amount ($200 instead of $100)
    const res2 = await request(app)
      .post('/v1/payments')
      .set('idempotency-key', key)
      .send({ ...validBasePayload, amount: 200 });

    assert.equal(res2.status, 422);
    assert.equal(res2.body.title, 'IdempotencyPayloadMismatchError');
    assert.equal(res2.body.status, 422);
    assert.equal(res2.body.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
    assert.ok(res2.body.detail.includes('Idempotency-Key'));
  });

  it('Returns 404 Not Found for non-existent payment trace', async () => {
    const res = await request(app).get('/v1/payments/pay_non_existent_12345/routing-trace');

    assert.equal(res.status, 404);
    assert.equal(res.body.title, 'NotFoundError');
    assert.equal(res.body.status, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
  });
});
