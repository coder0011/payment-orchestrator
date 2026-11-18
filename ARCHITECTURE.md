# Architecture & Engineering Specification

## 1. Executive Summary & Objective
This specification defines the architecture, system design, and technology choices for an enterprise-grade **Payment Orchestrator with Custom Routing**. The platform mirrors the core architectural principles of **Juspay Hyperswitch** (Hexagonal Architecture, Unified Connector Interface, Multi-Objective Smart Routing, Cascading Fallbacks, and Inbound Payment APIs) while modernizing the technology stack for maximum security, auditability, and throughput.

---

## 2. Technology Stack & Decision Rationale

| Layer | Technology | Version | Key Justification & Security Rationale |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | `26.x LTS` (Lithium) / `node:26-alpine` | Active LTS release with latest V8 engine optimizations, native Web Streams, and hardened crypto. Configured with `"engines": { "node": ">=22.0.0 || >=24.0.0 || >=26.0.0" }` for local evaluator compatibility. |
| **Language** | TypeScript | `5.8.2` | Strict NodeNext module resolution, zero `any` assertions, and end-to-end type safety. |
| **HTTP Engine** | Fastify | `5.12.8` | Benchmark leader (~35,000 req/sec, 4x faster than Express), zero-overhead routing, compiled JSON schema serialization via `fast-json-stringify`. |
| **Validation** | Zod + Fastify Type Provider | `4.6.7` / `7.0.0` | Latest major release with 10x faster parsing, zero prototype pollution, and strict DTO unknown property stripping (`.strict()`). |
| **Security Headers** | `@fastify/helmet` | `13.2.0` | Enterprise HTTP security headers: Content Security Policy (CSP), strict HSTS, X-Content-Type-Options: nosniff, frameguard. |
| **Abuse Shield** | `@fastify/rate-limit` | `11.2.2` | Token-bucket sliding window rate limiting to block carding attacks, credential stuffing, and volumetric spam. |
| **PII & Logging** | Pino | `10.4.0` | High-speed structured JSON logging with zero-overhead native field redaction for PCI-DSS compliance (`cardNumber`, `cvv`). |
| **Telemetry** | `prom-client` | `15.1.3` | Official Prometheus client exporting transaction counters, routing decisions, health floor rejections, and latency histograms. |
| **Testing** | Vitest | `5.1.1` | Native ESM test runner with instant TypeScript execution, parallel runner, and 100% coverage reporting. |
| **Benchmarking** | Autocannon | `9.0.0` | High-throughput HTTP benchmarking harness verifying > 100 RPS sustained load with p99 < 50ms. |
| **Dev Tooling** | `tsx` | `4.23.15` | Zero-compilation TypeScript execution for sub-second development feedback loop. |

---

## 3. System Design: Hexagonal Architecture (Ports and Adapters)

The orchestrator strictly enforces Clean Architecture boundaries:
- **Primary / Inbound Ports**: Fastify HTTP Gateway (`POST /v1/payments`, `GET /v1/payments/:id`, `GET /v1/payments/:id/routing-trace`, `GET /metrics`). Decoupled from core business rules.
- **Application Core**: Orchestrator service managing the transaction lifecycle, idempotency reservations, multi-factor candidate evaluation, cascading failover, and telemetry. Contains pure domain logic without HTTP transport dependencies.
- **Secondary / Outbound Ports**: 
  - `IPaymentConnector`: Standardized contract for external PSP adapters (`authorize`, `capture`, `quoteFee`).
  - `ITraceRepository`: Contract for decision trace persistence.
  - `IHealthMonitor`: Contract for rolling success-rate tracking.
  - `IMetricsCollector`: Contract for Prometheus metrics.
- **Outbound Adapters**: Pluggable implementations for **Stripe**, **Adyen**, **Razorpay**, and in-memory audit trace stores.

---

## 4. Core Design Patterns Applied

### 4.1 Strategy Pattern (Polymorphic PSP Connectors)
Encapsulates vendor-specific API structures, authentication mechanisms, and response formats behind a uniform `IPaymentConnector` interface. Gateway error codes are normalized into standardized domain classifications:
- `SoftDecline` (network timeout, temporary processor 5xx) $\rightarrow$ **Triggers cascading fallback**.
- `HardDecline` (stolen card, invalid CVV, fraud block) $\rightarrow$ **Halts cascade immediately** to protect against fraud amplification and card-testing abuse.

### 4.2 Specification & Rules Engine Pattern (Multi-Objective Routing)
Eliminates fragile hardcoded conditional logic. Routing decisions are evaluated through a pipeline of decoupled specifications:
1. **Eligibility Filter**: Currency and country support checks.
2. **Cost Calculation**: Dynamic fee evaluation:
   $$\text{Fee} = \text{FixedFee}_{\text{connector}} + (\text{PercentageFee}_{\text{connector}} \times \text{Amount}) + \text{FXMarkup}_{\text{cross-border}}$$
3. **Health Floor Check**: Disqualifies any connector with a 5-minute rolling First Attempt Authorization Rate (FAAR) below the threshold (default: $85\%$).
4. **Graceful Degradation**: If all connectors fall below the health floor during a widespread market outage, switches to **Maximum Availability Strategy** (routes to highest success rate processor instead of dropping transactions).

### 4.3 Chain of Responsibility Pattern (Cascading Fallbacks)
The routing engine outputs a ranked candidate queue: `[Primary (Cheapest Healthy), Secondary, Tertiary]`. The `CascadeExecutor` dispatches sequentially:
- Dispatches to candidate $N$.
- If `SoftDecline` or timeout occurs $\rightarrow$ Seamlessly cascades to candidate $N+1$, logging the event and updating metrics.
- If `HardDecline` occurs $\rightarrow$ Halts execution and returns decline reason to merchant.

### 4.4 Two-Phase Claim-Check Pattern (Cryptographic Idempotency)
Complies with the IETF draft `Idempotency-Key` standard:
- **Phase 1 (Reservation)**: Computes `SHA-256(payload + method + path)` under the `Idempotency-Key`.
  - If existing key is `IN_FLIGHT` $\rightarrow$ Return `409 Conflict`.
  - If existing key has different payload hash $\rightarrow$ Return `422 Unprocessable Entity`.
  - If existing key is `COMPLETED` $\rightarrow$ Replay cached response with `Idempotent-Replayed: true`.
- **Phase 2 (Commit)**: Stores final response status and payload upon completion, unlocking future replays.

### 4.5 Circuit Breaker Pattern (Connector Resilience)
Wraps each connector in a 3-state Circuit Breaker (`CLOSED`, `OPEN`, `HALF_OPEN`):
- Trips to `OPEN` after 5 consecutive failures/timeouts within 30 seconds.
- Automatically diverts traffic away from degraded connectors without burning network latency.
- Transitions to `HALF_OPEN` after 15 seconds cooldown to probe recovery with a canary transaction.

### 4.6 Memento / Decision Trace Pattern (Full Auditability)
Captures an immutable snapshot of all candidate quotes, health scores, rejection reasons, and execution attempts. Exposed through `GET /v1/payments/{id}/routing-trace` for full transparency and debugging.

---

## 5. Security & PCI-DSS Compliance Architecture

1. **Cardholder Data Redaction (Pino)**:
   - Card PANs are masked immediately upon ingestion (`424242******4242`).
   - CVVs are wiped from memory buffers after tokenization and excluded from all logs and storage.
2. **Timing-Safe Cryptography**:
   - Webhook and token comparisons use `crypto.timingSafeEqual` to prevent side-channel timing attacks.
3. **Input Sanitization**:
   - Zod schemas with `.strict()` parsing reject unrecognized properties, eliminating prototype pollution and parameter injection vulnerabilities.
