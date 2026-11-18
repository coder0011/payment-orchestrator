import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { PaymentResult } from '../../src/domain/entities.js';
import { IdempotencyConflictError, IdempotencyPayloadMismatchError } from '../../src/domain/errors.js';
import { IdempotencyService } from '../../src/security/idempotency.js';

describe('Security: Two-Phase Cryptographic Idempotency Shield', () => {
  let idempotency: IdempotencyService;

  const samplePayloadA = {
    amount: 100,
    currency: 'USD',
    cardLast4: '4242',
  };

  const samplePayloadB = {
    amount: 200, // Different amount!
    currency: 'USD',
    cardLast4: '4242',
  };

  const sampleResult: PaymentResult = {
    paymentId: 'pay_idemp_01',
    status: 'succeeded',
    amount: 100,
    currency: 'USD',
    connector: 'adyen',
    maskedCard: '424242******4242',
    routingSummary: {
      selectedConnector: 'adyen',
      calculatedCost: 1.21,
      currency: 'USD',
      reason: 'Cheapest healthy connector',
      strategy: 'least_cost',
    },
    attempts: [],
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    idempotency = new IdempotencyService();
  });

  it('Phase 1: Successfully acquires in-flight claim for new key', async () => {
    const claim = await idempotency.claim('idem-key-1', samplePayloadA);
    assert.equal(claim.status, 'ACQUIRED');
  });

  it('Rejects concurrent in-flight mutation with 409 Conflict', async () => {
    await idempotency.claim('idem-key-2', samplePayloadA);

    await assert.rejects(
      async () => {
        await idempotency.claim('idem-key-2', samplePayloadA);
      },
      (err: unknown) => {
        assert.ok(err instanceof IdempotencyConflictError);
        assert.equal((err as IdempotencyConflictError).statusCode, 409);
        return true;
      }
    );
  });

  it('Rejects reused key with different payload with 422 Unprocessable Entity', async () => {
    await idempotency.claim('idem-key-3', samplePayloadA);

    await assert.rejects(
      async () => {
        await idempotency.claim('idem-key-3', samplePayloadB);
      },
      (err: unknown) => {
        assert.ok(err instanceof IdempotencyPayloadMismatchError);
        assert.equal((err as IdempotencyPayloadMismatchError).statusCode, 422);
        return true;
      }
    );
  });

  it('Phase 2: Replays completed payment response without re-executing', async () => {
    await idempotency.claim('idem-key-4', samplePayloadA);
    await idempotency.commit('idem-key-4', sampleResult);

    const replayClaim = await idempotency.claim('idem-key-4', samplePayloadA);
    assert.equal(replayClaim.status, 'REPLAYED');
    if (replayClaim.status === 'REPLAYED') {
      assert.equal(replayClaim.result.paymentId, 'pay_idemp_01');
      assert.equal(replayClaim.result.connector, 'adyen');
    }
  });
});
