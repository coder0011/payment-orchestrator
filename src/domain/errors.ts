export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      type: `https://api.payments.io/errors/${this.code.toLowerCase()}`,
      title: this.name,
      status: this.statusCode,
      detail: this.message,
      code: this.code,
    };
  }
}

export class ValidationError extends DomainError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_FAILED';

  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = 'ValidationError';
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      errors: this.details,
    };
  }
}

export class IdempotencyConflictError extends DomainError {
  readonly statusCode = 409;
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(key: string) {
    super(`A concurrent transaction with Idempotency-Key '${key}' is currently in progress`);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyPayloadMismatchError extends DomainError {
  readonly statusCode = 422;
  readonly code = 'IDEMPOTENCY_PAYLOAD_MISMATCH';

  constructor(key: string) {
    super(`Idempotency-Key '${key}' was previously used with a different request payload`);
    this.name = 'IdempotencyPayloadMismatchError';
  }
}

export class PaymentDeclinedError extends DomainError {
  readonly statusCode = 402;
  readonly code = 'PAYMENT_DECLINED';

  constructor(
    message: string,
    readonly connectorId: string,
    readonly declineType: 'soft' | 'hard',
    readonly rawCode?: string
  ) {
    super(message);
    this.name = 'PaymentDeclinedError';
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      connector: this.connectorId,
      declineType: this.declineType,
      rawCode: this.rawCode,
    };
  }
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';

  constructor(resource: string, identifier: string) {
    super(`${resource} with identifier '${identifier}' not found`);
    this.name = 'NotFoundError';
  }
}

export class NoEligibleConnectorError extends DomainError {
  readonly statusCode = 503;
  readonly code = 'NO_ELIGIBLE_CONNECTOR';

  constructor(message: string = 'No eligible or healthy payment connector is available for this transaction') {
    super(message);
    this.name = 'NoEligibleConnectorError';
  }
}
