/**
 * Benchmark HTTP somente leitura para as rotas críticas do Vértice.
 *
 * Exemplo (PowerShell):
 *   $env:BENCHMARK_AUTH_TOKEN='...'
 *   $env:BENCHMARK_WALLET_ID='...'
 *   npm run benchmark:http
 */
const baseUrl = String(process.env.BENCHMARK_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const token = String(process.env.BENCHMARK_AUTH_TOKEN || '').trim();
const walletId = String(process.env.BENCHMARK_WALLET_ID || '').trim();
const iterations = Math.max(1, Number(process.env.BENCHMARK_ITERATIONS) || 30);
const warmup = Math.max(0, Number(process.env.BENCHMARK_WARMUP) || 3);
const concurrency = Math.max(1, Math.min(20, Number(process.env.BENCHMARK_CONCURRENCY) || 1));

const defaultScenarios = [
  { name: 'health', path: '/api/health', auth: false },
  { name: 'wallets', path: '/api/wallets', auth: true },
  { name: 'wallet', path: `/api/wallet${walletId ? `?walletId=${encodeURIComponent(walletId)}` : ''}`, auth: true },
  { name: 'wallet-history', path: `/api/wallet/history${walletId ? `?walletId=${encodeURIComponent(walletId)}` : ''}`, auth: true },
  { name: 'wallet-performance', path: `/api/wallet/performance${walletId ? `?walletId=${encodeURIComponent(walletId)}` : ''}`, auth: true },
  { name: 'research-stock', path: '/api/research/latest?assetClass=STOCK', auth: true },
  { name: 'research-fii', path: '/api/research/latest?assetClass=FII', auth: true },
  { name: 'research-macro', path: '/api/research/macro', auth: true },
  { name: 'research-signals', path: '/api/research/signals', auth: true },
];

const selected = process.env.BENCHMARK_SCENARIOS
  ? new Set(process.env.BENCHMARK_SCENARIOS.split(',').map((value) => value.trim()).filter(Boolean))
  : null;
const scenarios = defaultScenarios.filter((scenario) => !selected || selected.has(scenario.name));

const pct = (values, percentile) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)].toFixed(2));
};

const requestOnce = async (scenario) => {
  const headers = { Accept: 'application/json' };
  if (scenario.auth) headers.Authorization = `Bearer ${token}`;
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}${scenario.path}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    const bytes = (await response.arrayBuffer()).byteLength;
    return { ms: performance.now() - startedAt, status: response.status, bytes, error: null };
  } catch (error) {
    return { ms: performance.now() - startedAt, status: 0, bytes: 0, error: error?.name || 'Error' };
  }
};

const runBatch = async (scenario, count) => {
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < count) {
      cursor += 1;
      results.push(await requestOnce(scenario));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
  return results;
};

if (!token && scenarios.some((scenario) => scenario.auth)) {
  console.error('BENCHMARK_AUTH_TOKEN é obrigatório para os cenários autenticados. Use BENCHMARK_SCENARIOS=health para executar apenas o probe público.');
  process.exitCode = 2;
} else {
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    config: { iterations, warmup, concurrency },
    scenarios: [],
  };

  for (const scenario of scenarios) {
    if (warmup) await runBatch(scenario, warmup);
    const results = await runBatch(scenario, iterations);
    const durations = results.map((result) => result.ms);
    const statuses = {};
    for (const result of results) statuses[result.status || result.error] = (statuses[result.status || result.error] || 0) + 1;
    report.scenarios.push({
      name: scenario.name,
      requests: results.length,
      errors: results.filter((result) => result.error || result.status >= 500).length,
      statuses,
      avgMs: Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(2)),
      p50Ms: pct(durations, 50),
      p95Ms: pct(durations, 95),
      p99Ms: pct(durations, 99),
      maxMs: Number(Math.max(...durations).toFixed(2)),
      avgBytes: Math.round(results.reduce((sum, result) => sum + result.bytes, 0) / results.length),
    });
  }

  console.log(JSON.stringify(report, null, 2));
}
