# Project Rules & Invariants

These rules are strictly enforced for all agent operations in this workspace:

1. **Git Commit Restriction**:
   - **Never run `git commit` without explicit user permission.**
   - Stage files or keep them in the working tree, but do not execute commits autonomously.

2. **Zero-Vulnerability Dependency Hygiene**:
   - Only use pinned, secure dependencies.
   - Any new package must pass `npm audit` with 0 vulnerabilities.
   - Prefer Node.js native core libraries (`node:test`, `node:crypto`) over heavy transitive dependencies.

3. **PCI-DSS Level 1 Data Governance**:
   - Card Primary Account Numbers (PAN) must be masked immediately upon ingestion (`BIN + ****** + Last4`).
   - CVVs must never be written to logs, stored in state, or exposed in API traces.
   - Use configured Pino logger with native redaction paths. Never use `console.log` with raw request bodies.

4. **Hexagonal Architecture Boundaries**:
   - Routes only handle HTTP transport, schema parsing, and status code mapping.
   - Services contain pure domain logic and must never import HTTP transport types (e.g. Express `Request`, `Response`, or framework-specific types).
   - All external gateways must implement the polymorphic `IPaymentConnector` interface.
   - Domain errors must inherit from `DomainError` in `src/domain/errors.ts` (RFC 7807 Problem Details).

5. **Two-Phase Idempotency Requirement**:
   - Any mutating endpoint (`POST /payments`) must enforce the `Idempotency-Key` header with SHA-256 payload fingerprinting and race condition locking (`409 Conflict`, `Idempotent-Replayed: true`).
