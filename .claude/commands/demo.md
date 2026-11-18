# /demo Command

Spawns the payment orchestrator and executes an automated end-to-end interactive demonstration of:
1. Standard cost-aware routing (USD).
2. Health floor failover (when primary connector is degraded).
3. Cascading fallback on soft decline.
4. Decision trace inspection (`/v1/payments/:id/routing-trace`).
5. Prometheus metrics inspection (`/metrics`).

```bash
npm run demo
```
