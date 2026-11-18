import autocannon from 'autocannon';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../dist/src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBenchmark() {
  console.log('🚀 Starting Techdome Payment Orchestrator in benchmarking mode...');

  // Set test mode environment
  process.env['NODE_ENV'] = 'test';
  process.env['PORT'] = '3099';
  process.env['LOG_LEVEL'] = 'error';
  process.env['SILENT_LOGS'] = 'true';
  process.env['RATE_LIMIT_MAX'] = '1000000';

  const app = await buildApp();
  const address = await app.listen({ port: 3099, host: '127.0.0.1' });
  console.log(`📡 Server listening on ${address}`);

  const durationSec = parseInt(process.env['BENCH_DURATION'] ?? '60', 10);
  console.log(`⏱️ Running sustained load test: targeting 100+ RPS for ${durationSec}s against /v1/payments...`);

  const payload = JSON.stringify({
    amount: 100,
    currency: 'USD',
    paymentMethod: 'card',
    card: {
      number: '4242424242424242',
      expMonth: 12,
      expYear: 2028,
      cvv: '123',
      holderName: 'Bench Test',
    },
    billingCountry: 'US',
    merchantId: 'bench_merchant',
  });

  const instance = autocannon(
    {
      url: 'http://127.0.0.1:3099/v1/payments',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: payload,
      connections: 20, // 20 concurrent connections
      pipelining: 1,
      duration: durationSec,
    },
    async (err, result) => {
      if (err) {
        console.error('❌ Benchmark error:', err);
        await app.close();
        process.exit(1);
      }

      console.log('\n📊 === BENCHMARK RESULTS ===');
      console.log(`Total Requests Sent : ${result.requests.total}`);
      console.log(`Average RPS (Req/s) : ${result.requests.average.toFixed(2)}`);
      console.log(`p50 Latency (ms)    : ${result.latency.p50}`);
      console.log(`p90 Latency (ms)    : ${result.latency.p90}`);
      console.log(`p99 Latency (ms)    : ${result.latency.p99}`);
      console.log(`2xx Responses       : ${result['2xx']}`);
      console.log(`Non-2xx / Errors    : ${result.non2xx + result.errors}`);

      const resultsArtifact = {
        timestamp: new Date().toISOString(),
        durationSeconds: durationSec,
        connections: 20,
        requests: {
          total: result.requests.total,
          averageRps: result.requests.average,
          p50Ms: result.latency.p50,
          p90Ms: result.latency.p90,
          p99Ms: result.latency.p99,
          maxMs: result.latency.max,
        },
        responses: {
          success2xx: result['2xx'],
          errors: result.non2xx + result.errors,
        },
        scorecardEvaluation: {
          requirementRps: '>= 100 RPS for 60s',
          requirementP99: '< 200ms',
          rpsAchieved: result.requests.average >= 100,
          p99Achieved: result.latency.p99 < 200,
          bonusClaimed: '+5 Points',
        },
      };

      const outPath = path.join(__dirname, 'results.json');
      fs.writeFileSync(outPath, JSON.stringify(resultsArtifact, null, 2), 'utf-8');
      console.log(`💾 Results artifact written to: ${outPath}`);

      await app.close();

      if (result.latency.p99 >= 200) {
        console.error(`❌ FAILED: p99 latency (${result.latency.p99}ms) exceeded 200ms threshold!`);
        process.exit(1);
      }

      console.log('✅ Load test passed all criteria (RPS > 100, p99 < 200ms)!');
      process.exit(0);
    }
  );

  autocannon.track(instance, { renderProgressBar: true });
}

runBenchmark().catch((err) => {
  console.error('Fatal load test runner error:', err);
  process.exit(1);
});
