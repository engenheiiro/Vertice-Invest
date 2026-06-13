
import axios from 'axios';
import AssetLogo from '../models/AssetLogo.js';
import logger from '../config/logger.js';
import { withRetry, createCircuitBreaker } from '../utils/resilience.js';

/**
 * Serviço de logos: baixa a logo de um ativo da CDN apropriada (server-to-server,
 * sem referer/CORS que bloqueiam o navegador em produção), cacheia uma única vez no
 * MongoDB (`AssetLogo`) e devolve os bytes para o controller servir do nosso domínio.
 *
 * Estratégia "lazy": busca-e-cacheia na primeira requisição de cada ticker.
 * Cache negativo (`status: 'MISSING'`) evita rebater a CDN para tickers sem logo.
 */

// Limite de segurança por imagem (SVGs têm ~1–5KB; PNGs do Parqet ~5–30KB).
const MAX_BYTES = 256 * 1024;
// Re-tenta um MISSING (404 na CDN) apenas após esta janela — a logo pode passar a existir.
const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Um breaker por provedor: num lote (backfill), pula o provedor caído em vez de
// esperar o timeout de cada chamada.
const breakers = {
  brapi: createCircuitBreaker({ name: 'logo-brapi', failureThreshold: 8, cooldownMs: 60_000 }),
  jsdelivr: createCircuitBreaker({ name: 'logo-jsdelivr', failureThreshold: 8, cooldownMs: 60_000 }),
  parqet: createCircuitBreaker({ name: 'logo-parqet', failureThreshold: 8, cooldownMs: 60_000 }),
};

/** Normaliza um ticker para uso em URL: maiúsculo, sem espaços/sufixo de cotação. */
function normalizeTicker(ticker) {
  return (ticker || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-USD$/i, ''); // cripto às vezes vem como BTC-USD
}

/**
 * Resolve a URL da CDN + provedor para um ticker/tipo. Espelha o mapeamento que
 * antes vivia no frontend (`client/src/utils/assetLogo.ts`).
 * Retorna null quando não há fonte adequada (FII, renda fixa, caixa).
 */
function resolveSource(symbol, type) {
  switch (type) {
    case 'STOCK':
      return { url: `https://icons.brapi.dev/icons/${symbol}.svg`, provider: 'brapi' };
    case 'CRYPTO':
      return {
        url: `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@latest/svg/color/${symbol.toLowerCase()}.svg`,
        provider: 'jsdelivr',
      };
    case 'STOCK_US':
      return { url: `https://assets.parqet.com/logos/symbol/${symbol}`, provider: 'parqet' };
    case 'FII':
    case 'FIXED_INCOME':
    case 'CASH':
      return null;
    default:
      // Tipo desconhecido: trata como ação B3 (fonte mais provável neste app).
      return { url: `https://icons.brapi.dev/icons/${symbol}.svg`, provider: 'brapi' };
  }
}

/**
 * Baixa a imagem da CDN com retry + circuit breaker.
 * @returns {{ data: Buffer, contentType: string } | { notFound: true }}
 *
 * 404 / content-type inválido NÃO são tratados como falha do provedor: são "logo
 * inexistente", retornados como `{ notFound: true }` (o breaker registra sucesso —
 * a CDN está no ar). Só timeouts/5xx/erros de rede contam para abrir o circuito,
 * evitando que uma rajada de 404 legítimos bloqueie tickers válidos no backfill.
 */
async function downloadLogo({ url, provider }) {
  const breaker = breakers[provider];
  return breaker.exec(() =>
    withRetry(
      async () => {
        const res = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 8000,
          maxContentLength: MAX_BYTES,
          // Tratamos os status nós mesmos (404 = sem logo, não erro a re-tentar).
          validateStatus: () => true,
          headers: { 'User-Agent': 'Vertice/1.0 (+logo-cache)' },
        });

        if (res.status === 404) return { notFound: true };
        if (res.status !== 200) {
          // 5xx/429/etc.: falha transitória do provedor → re-tenta e conta no breaker.
          throw new Error(`Logo HTTP ${res.status}: ${url}`);
        }

        const contentType = String(res.headers['content-type'] || '').split(';')[0].trim();
        if (!/^image\//i.test(contentType) && !/svg/i.test(contentType)) {
          return { notFound: true }; // resposta não é imagem → trata como ausente
        }

        const data = Buffer.from(res.data);
        if (!data.length || data.length > MAX_BYTES) {
          return { notFound: true };
        }

        return { data, contentType: contentType || 'image/svg+xml' };
      },
      { retries: 2, baseDelayMs: 250 }
    )
  );
}

/**
 * Devolve a logo de um ativo a partir do cache (ou busca-e-cacheia na 1ª vez).
 * @returns {Promise<{ data: Buffer, contentType: string, bytes: number } | null>}
 *          null quando não há logo (tipo sem fonte, 404 na CDN ou falha persistente).
 */
export async function getOrFetch(ticker, type) {
  const symbol = normalizeTicker(ticker);
  if (!symbol) return null;

  const source = resolveSource(symbol, type);
  if (!source) return null; // FII / renda fixa / caixa → front usa iniciais

  // Tipo efetivo gravado no cache (default → STOCK, igual ao resolveSource).
  const cacheType = ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type)
    ? type
    : 'STOCK';

  const existing = await AssetLogo.findOne({ ticker: symbol, type: cacheType });

  if (existing) {
    if (existing.status === 'OK' && existing.data?.length) {
      return { data: existing.data, contentType: existing.contentType, bytes: existing.bytes };
    }
    // MISSING ainda fresco → não rebate a CDN.
    if (existing.status === 'MISSING' && Date.now() - existing.fetchedAt.getTime() < MISSING_TTL_MS) {
      return null;
    }
    // MISSING stale → cai pro refetch abaixo.
  }

  const markMissing = () =>
    AssetLogo.findOneAndUpdate(
      { ticker: symbol, type: cacheType },
      { status: 'MISSING', data: null, contentType: null, bytes: 0, source: source.url, fetchedAt: new Date() },
      { upsert: true, new: true }
    );

  try {
    const result = await downloadLogo(source);

    if (result.notFound) {
      // Logo inexistente (404/não-imagem) → cache negativo, sem ruído de log.
      await markMissing();
      return null;
    }

    const { data, contentType } = result;
    await AssetLogo.findOneAndUpdate(
      { ticker: symbol, type: cacheType },
      { status: 'OK', data, contentType, bytes: data.length, source: source.url, fetchedAt: new Date() },
      { upsert: true, new: true }
    );
    return { data, contentType, bytes: data.length };
  } catch (err) {
    // Falha de infra (timeout/5xx/rede) ou circuito aberto → cache negativo + log.
    await markMissing();
    if (err?.code !== 'ERR_CIRCUIT_OPEN') {
      logger.warn(`🖼️  Logo indisponível para ${symbol} (${cacheType}): ${err.message}`);
    }
    return null;
  }
}

export const logoService = { getOrFetch };
export default logoService;
