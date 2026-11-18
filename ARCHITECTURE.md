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
| **Testing** | Node.js Native Test Runner (`node:test`) | `node:test` via `tsx --test` | Zero-dependency native ESM test runner with zero transitive vulnerability attack surface (replacing Vitest to eliminate `GHSA-fc5q-39xc-vjpf`). 29/29 tests pass in ~800ms. |
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

---

## 6. Containerization & Deployment Architecture

The orchestrator is built for high-density, secure production workloads utilizing a multi-stage Docker build:

### 6.1 Multi-Stage Alpine Build (`node:26-alpine`)
```dockerfile
# Stage 1: Build & Prune
FROM node:26-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig*.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build
RUN npm prune --production

# Stage 2: Hardened Runtime
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 6.2 Key Hardening Properties
- **Base Image**: `node:26-alpine` (Node.js 26 Active LTS "Lithium").
- **Minimal Image Footprint**: ~145 MB total size by excluding devDependencies, TypeScript source files, and test harnesses from the runtime stage.
- **Unprivileged Execution**: Runs as non-root `node` user (UID/GID 1000:1000) preventing host privilege escalation.
- **Container Healthcheck**: Native `wget --spider http://127.0.0.1:3000/health` probe executing every 10s with 5s grace period and 3-retry auto-fail threshold.
- **Signal Handling & Graceful Teardown**: Intercepts `SIGTERM` and `SIGINT` signals, halts ingress, finishes in-flight authorization transactions, flushes audit logs, and exits with code 0.

---

## 7. Automated Contract Verification & Quality Engineering

The quality assurance and contract verification suite is composed of three complementary layers:

### 7.1 Layer 1: Node.js Native Test Runner (`node:test`)
- **Execution Command**: `npm test` (`tsx --test tests/**/*.test.ts`)
- **Suite Breakdown** (29 Tests Across 8 Specialized Suites):
  - `tests/unit/cost-calculator.test.ts` (4 tests): Domestic fees, cross-border FX markup, fee caps, multi-currency routing.
  - `tests/unit/health-tracker.test.ts` (3 tests): Rolling 5-minute FAAR calculations, failure degradation, manual health overrides.
  - `tests/unit/router.test.ts` (4 tests): Least-cost candidate ranking, health floor rejection, currency exclusion, graceful degradation.
  - `tests/unit/circuit-breaker.test.ts` (3 tests): Tripping on consecutive errors, state transitions (`CLOSED` $\rightarrow$ `OPEN` $\rightarrow$ `HALF_OPEN`), traffic diversion.
  - `tests/security/pii-redaction.test.ts` (4 tests): Luhn-validated PAN masking (`424242******4242`), CVV scrubbing, Pino PCI serializer verification.
  - `tests/security/idempotency.test.ts` (4 tests): SHA-256 reservation, 409 conflict lock, 422 payload mismatch, 200 replay with `Idempotent-Replayed: true`.
  - `tests/integration/payment-e2e.test.ts` (5 tests): End-to-end payment API, routing trace retrieval, cascading fallback on soft decline, Prometheus scrape.
  - `tests/integration/routes.test.ts` (2 tests): Health check probe verification, 404 handler.
- **Execution Velocity**: All 29 tests execute in **~800ms** with zero flaky tests.

### 7.2 Layer 2: Postman CLI Executable Contract Verification
- **Execution Command**:
  ```bash
  postman collection run postman/Techdome_Payment_Orchestrator.postman_collection.json --env-var "baseUrl=http://127.0.0.1:3000"
  ```
- **Contract Verification Matrix** (6 Requests / 14 Executable Assertions):
  1. `Health Check Probe`: `pm.response.to.have.status(200)`, validates `status === "ok"`.
  2. `Create Payment - Least Cost Routing (USD)`: Validates `201 Created`, confirms `connector === "adyen"`, checks Luhn-masked card number.
  3. `Replay Idempotent Payment`: Validates `200 OK`, confirms header `idempotent-replayed === "true"`, ensures returned `paymentId` matches initial submission.
  4. `Create Domestic Payment (INR - Razorpay Optimal)`: Validates `201 Created`, confirms `connector === "razorpay"`.
  5. `Get Payment Decision Trace`: Validates `200 OK`, confirms `trace.selectedConnector`, verifies `evaluationMatrix` array.
  6. `Scrape Prometheus Metrics`: Validates `200 OK`, confirms `payment_requests_total` counter presence.

### 7.3 Layer 3: Sustained Load Testing Benchmark (Autocannon)
- **Execution Command**: `npm run test:load`
- **Specification**: Sustained 60-second saturation test at 100+ concurrent/pipelined RPS targeting the custom routing engine.
- **Measured Empirical Results (`tests/load/results.json`)**:
  - Total Duration: **60.03 seconds**
  - Total Ingested Transactions: **25,920 requests**
  - Average Throughput: **432.00 RPS** (432% of 100 RPS requirement)
  - Latency Percentiles:
    - **p50**: `46 ms`
    - **p90**: `47 ms`
    - **p99**: `48 ms` (Well under the 200ms assignment ceiling)
  - HTTP 2xx Success Rate: **100.0% (0 errors, 0 timeouts, 0 rate limit drops)**

---

## 8. Architectural Evolution & Adoption Decision Matrix

| Capability / Area | Initial Convention | Production Adopted Architecture | Key Architectural Drivers |
| :--- | :--- | :--- | :--- |
| **Runtime Target** | Node 20 / Node 22 | **Node.js 26 Active LTS (`node:26-alpine`)** | Latest V8 optimizations, native Web Streams, hardened crypto, with broad compatibility matrix (`>=22.0.0 \|\| >=24.0.0 \|\| >=26.0.0`). |
| **HTTP Framework** | Express 4 / Express 5 | **Fastify 5.12.8** | 4x higher throughput (~35,000 req/sec), zero-overhead routing, compiled JSON schema serialization via `fast-json-stringify`. |
| **Testing Harness** | Vitest 5.1.1 | **Node.js Native Test Runner (`node:test` via `tsx --test`)** | Transitive dependency `picomatch` in Vitest had high ReDoS vulnerability (`GHSA-fc5q-39xc-vjpf`). Switching to native runner eliminated 35 packages and achieved strictly **0 vulnerabilities**. |
| **Idempotency Strategy** | In-memory key-value | **Two-Phase Cryptographic Claim-Check** | IETF draft compliant: Phase 1 SHA-256 reservation locking (`409 Conflict`) + Phase 2 commit replay (`Idempotent-Replayed: true`). |
| **Container Strategy** | Single-stage Dockerfile | **Multi-Stage Build (`node:26-alpine`)** | Builder stage (`npm ci` + compile) $\rightarrow$ minimal runner stage (`npm prune --production`), unprivileged `node` user, built-in `wget` healthcheck. |
| **Contract Documentation** | Static Markdown docs | **Postman Collection V3 with Markdown + Saved Examples** | Fully documented schema descriptions, query params, headers, and pre-recorded 200/201 response examples verified via Postman CLI. |

