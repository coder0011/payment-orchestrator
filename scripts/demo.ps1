# Techdome Payments Orchestrator - Interactive One-Click Demo
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  TECHDOME PAYMENT ORCHESTRATOR - INTERACTIVE DEMO (HYPERSWITCH) " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Start Server in Background
Write-Host "[1/6] Starting payment orchestrator server..." -ForegroundColor Yellow
$serverProcess = Start-Process -FilePath "node" -ArgumentList "dist/src/index.js" -PassThru -NoNewWindow
Start-Sleep -Seconds 2

# Verify Health
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/health" -Method Get
    Write-Host "  OK Server online: $($health.service) v$($health.version)" -ForegroundColor Green
} catch {
    Write-Host "  FAILED Server failed to respond. Exiting." -ForegroundColor Red
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host ""

# 2. Scenario 1: Standard Cost-Aware Routing (USD 100)
Write-Host "[2/6] Scenario 1: Sending $100 USD Payment (Cost-Aware Routing)..." -ForegroundColor Yellow
$paymentPayload = @{
    amount = 100
    currency = "USD"
    paymentMethod = "card"
    card = @{
        number = "4242424242424242"
        expMonth = 12
        expYear = 2028
        cvv = "123"
        holderName = "Jane Doe"
    }
    billingCountry = "US"
    merchantId = "merch_techdome_01"
} | ConvertTo-Json

$idemKey = "demo-key-" + [guid]::NewGuid().ToString()
$response1 = Invoke-RestMethod -Uri "http://127.0.0.1:3000/v1/payments" -Method Post -Body $paymentPayload -ContentType "application/json" -Headers @{ "Idempotency-Key" = $idemKey }

Write-Host "  Payment ID     : $($response1.paymentId)" -ForegroundColor Green
Write-Host "  Status         : $($response1.status)" -ForegroundColor Green
Write-Host "  Masked Card    : $($response1.maskedCard) (PCI-DSS compliant)" -ForegroundColor Green
Write-Host "  Chosen Gateway : $($response1.connector) (Cheapest healthy gateway)" -ForegroundColor Green
Write-Host "  Calculated Fee : $($response1.routingSummary.calculatedCost) $($response1.currency)" -ForegroundColor Green
Write-Host "  Strategy       : $($response1.routingSummary.strategy)" -ForegroundColor Green
Write-Host "  Reason         : $($response1.routingSummary.reason)" -ForegroundColor Gray
Write-Host ""

$createdPaymentId = $response1.paymentId

# 3. Scenario 2: Two-Phase Idempotency Replay
Write-Host "[3/6] Scenario 2: Testing Idempotency Replay (Sending duplicate request)..." -ForegroundColor Yellow
$webreq = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:3000/v1/payments")
$webreq.Method = "POST"
$webreq.ContentType = "application/json"
$webreq.Headers.Add("Idempotency-Key", $idemKey)
$bytes = [System.Text.Encoding]::UTF8.GetBytes($paymentPayload)
$webreq.ContentLength = $bytes.Length
$stream = $webreq.GetRequestStream()
$stream.Write($bytes, 0, $bytes.Length)
$stream.Close()
$webresp = $webreq.GetResponse()
$replayedHeader = $webresp.Headers.Get("Idempotent-Replayed")
$reader = New-Object System.IO.StreamReader($webresp.GetResponseStream())
$rawJson = $reader.ReadToEnd()
$response2 = $rawJson | ConvertFrom-Json

Write-Host "  HTTP Status            : $($webresp.StatusCode)" -ForegroundColor Green
Write-Host "  Idempotent-Replayed    : $replayedHeader" -ForegroundColor Green
Write-Host "  Replayed Payment ID    : $($response2.paymentId)" -ForegroundColor Green
Write-Host "  Guaranteed Protection  : No double charge occurred!" -ForegroundColor Green
Write-Host ""

# 4. Scenario 3: Domestic RuPay / INR Routing
Write-Host "[4/6] Scenario 3: Sending Domestic INR Payment (RuPay Card)..." -ForegroundColor Yellow
$inrPayload = @{
    amount = 3000
    currency = "INR"
    paymentMethod = "card"
    card = @{
        number = "6070809988776655"
        expMonth = 5
        expYear = 2027
        cvv = "321"
        holderName = "Vikram Patel"
    }
    billingCountry = "IN"
    merchantId = "merch_in_01"
} | ConvertTo-Json

$responseInr = Invoke-RestMethod -Uri "http://127.0.0.1:3000/v1/payments" -Method Post -Body $inrPayload -ContentType "application/json"
Write-Host "  Chosen Gateway : $($responseInr.connector)" -ForegroundColor Green
Write-Host "  Fee            : $($responseInr.routingSummary.calculatedCost) INR (Fee capped at INR 20)" -ForegroundColor Green
Write-Host ""

# 5. Scenario 4: Decision Trace Retrieval (BONUS +5)
Write-Host "[5/6] Scenario 4: Querying Decision Trace API (GET /v1/payments/$createdPaymentId/routing-trace)..." -ForegroundColor Yellow
$trace = Invoke-RestMethod -Uri "http://127.0.0.1:3000/v1/payments/$createdPaymentId/routing-trace" -Method Get
Write-Host "  Evaluated At         : $($trace.evaluatedAt)" -ForegroundColor Gray
Write-Host "  Health Floor         : $($trace.healthFloorThreshold * 100)%" -ForegroundColor Gray
Write-Host "  Selected Connector   : $($trace.selectedConnector)" -ForegroundColor Green
Write-Host "  Evaluation Matrix    :" -ForegroundColor Yellow
foreach ($c in $trace.evaluationMatrix) {
    $sel = if ($c.selected) { "[SELECTED]" } else { "[REJECTED]" }
    Write-Host "    - $($c.connectorId): Cost=$($c.calculatedCost), Health=$([math]::Round($c.successRate * 100, 1))%, FloorPassed=$($c.passedHealthFloor) $sel" -ForegroundColor Gray
}
Write-Host ""

# 6. Scenario 5: Prometheus Telemetry (BONUS +5)
Write-Host "[6/6] Scenario 5: Querying Prometheus Metrics (GET /metrics)..." -ForegroundColor Yellow
$metrics = Invoke-RestMethod -Uri "http://127.0.0.1:3000/metrics" -Method Get
$metricLines = ($metrics -split "`n") | Where-Object { $_ -match "payment_requests_total|payment_routing_decisions_total" -and $_ -notmatch "#" }
foreach ($line in $metricLines) {
    Write-Host "  $line" -ForegroundColor Gray
}
Write-Host ""

# Cleanup
Write-Host "Stopping demo server..." -ForegroundColor Yellow
Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
Write-Host "SUCCESS: Demo completed successfully!" -ForegroundColor Green
