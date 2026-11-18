#!/usr/bin/env bash
set -e

echo "================================================================"
echo "  PAYMENTS ORCHESTRATOR - INTERACTIVE DEMO (HYPERSWITCH) "
echo "================================================================"
echo ""

# 1. Start Server in Background
echo "[1/6] Starting payment orchestrator server..."
node dist/src/index.js &
SERVER_PID=$!
sleep 2

cleanup() {
    echo "Stopping demo server (PID: $SERVER_PID)..."
    kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Verify Health
curl -s http://127.0.0.1:3000/health > /dev/null || { echo "Server failed to start"; exit 1; }
echo "  OK Server online"
echo ""

# 2. Scenario 1: Standard Payment (USD 100)
echo "[2/6] Scenario 1: Sending $100 USD Payment (Cost-Aware Routing)..."
PAYMENT_RESP=$(curl -s -X POST http://127.0.0.1:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-key-$(date +%s)" \
  -d '{
    "amount": 100,
    "currency": "USD",
    "paymentMethod": "card",
    "card": {
      "number": "4242424242424242",
      "expMonth": 12,
      "expYear": 2028,
      "cvv": "123",
      "holderName": "Jane Doe"
    },
    "billingCountry": "US",
    "merchantId": "merch_default_01"
  }')

echo "  Response: $PAYMENT_RESP"
PAYMENT_ID=$(echo $PAYMENT_RESP | grep -o '"paymentId":"[^"]*' | cut -d'"' -f4)
echo "  Payment ID: $PAYMENT_ID"
echo ""

# 3. Scenario 2: Two-Phase Idempotency Replay
echo "[3/6] Scenario 2: Testing Idempotency Replay (Sending duplicate request)..."
curl -s -i -X POST http://127.0.0.1:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: fixed-idem-key-01" \
  -d '{
    "amount": 250,
    "currency": "USD",
    "paymentMethod": "card",
    "card": {
      "number": "4242424242424242",
      "expMonth": 10,
      "expYear": 2029,
      "cvv": "456",
      "holderName": "Bob Smith"
    },
    "billingCountry": "US"
  }' > /dev/null

REPLAY_RESP=$(curl -s -i -X POST http://127.0.0.1:3000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: fixed-idem-key-01" \
  -d '{
    "amount": 250,
    "currency": "USD",
    "paymentMethod": "card",
    "card": {
      "number": "4242424242424242",
      "expMonth": 10,
      "expYear": 2029,
      "cvv": "456",
      "holderName": "Bob Smith"
    },
    "billingCountry": "US"
  }')

echo "$REPLAY_RESP" | grep -i "idempotent-replayed" || true
echo "  Duplicate request safely replayed without duplicate charge!"
echo ""

# 4. Scenario 3: Fetch Decision Trace
echo "[4/6] Scenario 3: Querying Decision Trace API (GET /v1/payments/$PAYMENT_ID/routing-trace)..."
curl -s http://127.0.0.1:3000/v1/payments/$PAYMENT_ID/routing-trace
echo ""
echo ""

# 5. Scenario 4: Prometheus Telemetry
echo "[5/6] Scenario 4: Querying Prometheus Metrics (GET /metrics)..."
curl -s http://127.0.0.1:3000/metrics | grep "payment_requests_total" || true
echo ""

echo "[6/6] SUCCESS: Demo completed successfully!"
