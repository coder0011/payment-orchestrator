---
name: payment-routing
description: "Intelligent multi-objective cost and health routing skill for payment switches modeled after Juspay Hyperswitch"
---

# Payment Routing Skill

This project skill provides instructions and context for evaluating, testing, and debugging the **Cost-Aware Routing with Min-Success-Rate Floor** engine.

## Core Evaluation Pipeline

1. **Tuple Ingestion**: `(Amount, Currency, CardBIN, BillingCountry, MerchantCountry)`
2. **Eligibility Filter**: Disqualify candidate connectors if currency or country is unsupported.
3. **Fee Calculation**:
   $$\text{Fee} = \text{FixedFee}_{\text{connector}} + (\text{PercentageFee}_{\text{connector}} \times \text{Amount}) + \text{FXMarkup}_{\text{cross-border}}$$
4. **Health Floor Check**: Minimum 5-minute rolling success rate $\ge 85\%$.
5. **Candidate Ranking**:
   - Primary: Lowest calculated fee among connectors passing the health floor.
   - Fallbacks: Remaining passing connectors ranked in ascending cost order.
   - Degradation: If all connectors fall below 85% floor, rank by highest success rate (availability > cost).

## Verification Commands

- Run full test suite: `npm test`
- Run load benchmark: `npm run test:load`
- Run one-click interactive demo: `npm run demo`
- Inspect metrics: `curl http://localhost:3000/metrics`
- Inspect routing trace: `curl http://localhost:3000/v1/payments/:id/routing-trace`
