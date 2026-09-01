/**
 * Baseline local do build estático usando o Chromium já fornecido pelo
 * Playwright. Serve client/dist em uma porta efêmera e não acessa a API.
 */
/* global process, URL, window, PerformanceObserver, performance, console */
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const runs = Math.max(1, Math.min(10, Number(process.env.BENCHMARK_WEB_RUNS) || 3));
const route = String(process.env.BENCHMARK_WEB_ROUTE || '/');
const externalUrl = String(process.env.BENCHMARK_WEB_URL || '').trim();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = path.resolve(distDir, `.${pathname}`);
    if (!filePath.startsWith(distDir)) throw new Error('invalid path');
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      filePath = path.join(distDir, 'index.html');
    }
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const percentile = (values, p) => {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  return Number(valid[Math.max(0, Math.ceil((p / 100) * valid.length) - 1)].toFixed(2));
};

let url = externalUrl;
if (!url) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  url = `http://127.0.0.1:${address.port}${route.startsWith('/') ? route : `/${route}`}`;
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__verticeVitals = { lcp: null, inp: null };
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          if (last) window.__verticeVitals.lcp = last.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch { /* navegador sem suporte */ }
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.interactionId && (!window.__verticeVitals.inp || entry.duration > window.__verticeVitals.inp)) {
              window.__verticeVitals.inp = entry.duration;
            }
          }
        }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
      } catch { /* navegador sem suporte */ }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.mouse.click(20, 20);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(750);

    samples.push(await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const resources = performance.getEntriesByType('resource');
      return {
        ttfbMs: nav ? nav.responseStart - nav.requestStart : null,
        domContentLoadedMs: nav?.domContentLoadedEventEnd ?? null,
        loadMs: nav?.loadEventEnd ?? null,
        fcpMs: fcp?.startTime ?? null,
        lcpMs: window.__verticeVitals?.lcp ?? null,
        inpMs: window.__verticeVitals?.inp ?? null,
        resourceCount: resources.length,
        transferKb: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) / 1024,
      };
    }));
    await context.close();
  }

  const metricNames = ['ttfbMs', 'domContentLoadedMs', 'loadMs', 'fcpMs', 'lcpMs', 'inpMs', 'resourceCount', 'transferKb'];
  const summary = {};
  for (const name of metricNames) {
    const values = samples.map((sample) => sample[name]);
    summary[name] = { p50: percentile(values, 50), p95: percentile(values, 95) };
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    target: externalUrl ? new URL(url).origin : 'local-static-build',
    route,
    runs,
    summary,
    samples,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
