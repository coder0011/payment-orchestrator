---
name: project-conventions
description: "Coding conventions, architecture patterns, testing workflows, and style guidelines for payment-orchestrator"
---

# Project Conventions & Architecture Guide

This skill documents the design patterns, coding conventions, testing strategies, and security guardrails for the **Payments Orchestrator**. Future agents must follow these patterns to maintain architectural integrity, zero-vulnerability hygiene, and high performance.

---

## 1. Architectural Philosophy & Layer Boundaries

The codebase follows **Hexagonal Architecture (Ports and Adapters)** and Clean Architecture principles. Dependencies point inward:
`routes` $\rightarrow$ `services` $\rightarrow$ `domain` $\leftarrow$ `connectors / repositories`.

```
src/
├── domain/            # Pure entities, value objects, error hierarchies (zero external dependencies)
├── config/            # Environment and static connector pricing configurations
├── security/          # PCI-DSS PII masking & cryptographic idempotency claim-check
├── connectors/        # Strategy pattern: Outbound PSP adapters (Stripe, Adyen, Razorpay)
├── routing/           # Specification pattern: Cost evaluation & rolling health tracking
├── services/          # Orchestration layer coordinating payments, cascading, and traces
├── observability/     # Hardened Pino logging with redaction & Prometheus metrics
└── routes/            # Express 5 HTTP transport routers (Inbound ports)
```

### Strict Architectural Invariants
1. **Routes never contain business logic**: Routes only validate DTOs, invoke application services, and map HTTP status codes.
2. **Services never import HTTP types**: Services take pure domain types (`PaymentIntent`) and return domain results (`PaymentResult`). Never pass Express `Request` or `Response` objects into services.
3. **Connectors are polymorphic**: Every upstream gateway must implement `IPaymentConnector`.
4. **Errors extend DomainError**: All application errors inherit from `DomainError` in `src/domain/errors.ts` and format according to RFC 7807 Problem Details.

---

## 2. Core Design Patterns to Follow When Adding Features

### 2.1 Strategy Pattern (Adding a New PSP Connector)
When integrating a new payment connector (e.g. PayPal, Checkout.com):
1. Add its fee structure and supported currencies to `src/config/connectors.config.ts`.
2. Extend `BaseConnector` in `src/connectors/<name>.connector.ts`.
3. Wrap operations in a `CircuitBreaker`.
4. Classify error responses:
   - `SoftDecline`: Gateway timeouts, rate limits, temporary 5xx errors $\rightarrow$ **Permits cascading**.
   - `HardDecline`: Stolen card, invalid CVV, fraud rejection $\rightarrow$ **Halts cascade immediately**.

### 2.2 Specification & Rules Engine (Smart Routing)
When adding new routing criteria (e.g., MCC-based routing, volume split):
1. Implement the evaluation logic in `src/routing/cost-aware-router.ts`.
2. Evaluate rules in order:
   - Eligibility filter (currency & country support).
   - Net processing fee calculation ($Fee = Fixed + \% + FX$).
   - Dynamic health floor check ($\ge 85\%$).
   - Graceful degradation fallback if all connectors are degraded.
3. Record candidate pass/fail status and reasons in `EvaluatedCandidate` so the decision trace remains 100% transparent.

### 2.3 Two-Phase Claim-Check Pattern (Idempotency)
Any mutating endpoint must support the `Idempotency-Key` header:
- **Phase 1 (Reservation)**: Compute `SHA-256(payload)`. Acquire lock. If already in flight, throw `IdempotencyConflictError` (409). If payload differs, throw `IdempotencyPayloadMismatchError` (422). If completed, return cached response with header `Idempotent-Replayed: true`.
- **Phase 2 (Commit)**: On successful execution, store response payload and status. On unexpected system exception, call `release(key)`.

---

## 3. Security & PCI-DSS Guardrails

1. **Cardholder Data Masking**:
   - Never store or log raw Primary Account Numbers (PAN).
   - Use `PiiService.maskCardNumber()`: format must be `BIN + ****** + Last4` (e.g. `424242******4242`).
2. **Zero CVV Retention**:
   - CVV numbers must be scrubbed from memory buffers immediately after connector tokenization.
   - Never include CVVs in logs, traces, or database records.
3. **Log Redaction**:
   - All logging uses the configured `logger` from `src/observability/logger.ts`.
   - Pino is configured with strict redaction paths: `card.number`, `card.cvv`, `req.headers.authorization`. Never bypass this by `console.log`ging raw request objects.

---

## 4. TypeScript & Styling Guidelines

- **Native ESM**: Always use explicit `.js` extensions in imports (e.g., `import { env } from './config/env.js';`).
- **Exact Optional Property Types**: With `exactOptionalPropertyTypes: true` in `tsconfig.json`, optional properties must explicitly accept `| undefined` if `undefined` can be passed (e.g., `idempotencyKey?: string | undefined;`).
- **No Type Assertions**: Avoid `as any` or `@ts-ignore`. Model domain types strictly.
- **Zod Validation**: Use `z.infer<typeof Schema>` as the single source of truth for request DTOs. Enforce `.strict()` on schemas to prevent prototype pollution.

---

## 5. Testing Standards & Execution

The project uses Node's native test runner (`node:test` + `node:assert/strict`) executed via `tsx --test`. This eliminates third-party test dependencies (like Vite/Vitest) and guarantees **0 vulnerabilities** on `npm audit`.

### Writing New Tests
- **Unit tests** (`tests/unit/`): Test pure domain logic, fee calculations, and routing decisions in isolation.
- **Security tests** (`tests/security/`): Verify idempotency locks and PII masking.
- **Integration tests** (`tests/integration/`): Use `supertest(app)` to test HTTP routes, status codes, and headers against the Express application without binding to physical network ports.

```typescript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('Feature Test', () => {
  it('verifies expected outcome', async () => {
    assert.equal(actual, expected);
  });
});
```

### Test & Verification Commands
```bash
# Typecheck with zero errors
npm run typecheck

# Run full test suite
npm test

# Run unit tests only
npm run test:unit

# Run security tests only
npm run test:security

# Run integration tests only
npm run test:e2e

# Run 60s load test benchmark (100+ RPS target)
npm run test:load

# Run interactive one-click demo
npm run demo

# Verify zero npm vulnerabilities
npm run audit
```

---

## 6. Step-by-Step Checklist for Implementing a New Feature

1. **Domain First**: Define types and entities in `src/domain/` with strict type annotations.
2. **Ports & Interfaces**: Define or update contracts in `src/connectors/` or `src/routing/`.
3. **Core Logic**: Implement business logic adhering to the Strategy or Specification pattern.
4. **Telemetry**: Emit relevant Prometheus metrics in `src/observability/metrics.ts`.
5. **Route Binding**: Expose HTTP endpoints in `src/routes/` with strict Zod validation.
6. **Automated Tests**: Write matching unit and integration tests using `node:test`.
7. **Verify**: Ensure `npm run typecheck`, `npm test`, and `npm run audit` all pass with 0 errors.
