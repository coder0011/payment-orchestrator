import crypto from 'node:crypto';
import type { PaymentResult } from '../domain/entities.js';
import { IdempotencyConflictError, IdempotencyPayloadMismatchError } from '../domain/errors.js';

export interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  status: 'IN_FLIGHT' | 'COMPLETED';
  createdAt: number;
  result?: PaymentResult;
}

export type ClaimResult =
  | { status: 'ACQUIRED' }
  | { status: 'REPLAYED'; result: PaymentResult };

export class IdempotencyService {
  private readonly store = new Map<string, IdempotencyRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Generates a deterministic SHA-256 fingerprint of request parameters
   */
  static generateFingerprint(payload: unknown): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Phase 1: Atomically attempts to acquire the idempotency claim
   */
  async claim(key: string, payload: unknown): Promise<ClaimResult> {
    const fingerprint = IdempotencyService.generateFingerprint(payload);
    const existing = this.store.get(key);

    if (existing) {
      // Check expiration
      if (Date.now() - existing.createdAt > this.ttlMs) {
        this.store.delete(key);
      } else {
        // Payload mismatch check
        if (existing.fingerprint !== fingerprint) {
          throw new IdempotencyPayloadMismatchError(key);
        }

        // Concurrent mutation check
        if (existing.status === 'IN_FLIGHT') {
          throw new IdempotencyConflictError(key);
        }

        // Replay completed result
        if (existing.status === 'COMPLETED' && existing.result) {
          return { status: 'REPLAYED', result: existing.result };
        }
      }
    }

    // Acquire in-flight reservation
    this.store.set(key, {
      key,
      fingerprint,
      status: 'IN_FLIGHT',
      createdAt: Date.now(),
    });

    return { status: 'ACQUIRED' };
  }

  /**
   * Phase 2: Commits the final payment result to allow future replays
   */
  async commit(key: string, result: PaymentResult): Promise<void> {
    const existing = this.store.get(key);
    if (existing) {
      existing.status = 'COMPLETED';
      existing.result = result;
    }
  }

  /**
   * Releases an in-flight reservation on failure (e.g. system exception)
   */
  async release(key: string): Promise<void> {
    const existing = this.store.get(key);
    if (existing && existing.status === 'IN_FLIGHT') {
      this.store.delete(key);
    }
  }

  /**
   * Clears all stored records (useful for test isolation)
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Returns current count of stored idempotency keys
   */
  size(): number {
    return this.store.size;
  }
}

export const idempotencyService = new IdempotencyService();
