/**
 * Serviço do ranking âncora de FIIs (estratégia BUY_AND_HOLD) — shadow.
 * Par do buyAndHoldService.js (ações).
 *
 * Gera o ranking a partir dos dados ATUAIS (read-only): não persiste
 * MarketAnalysis nem toca em publicação. Centraliza a montagem de candidatos
 * usada tanto pelo endpoint admin quanto pelo script de auditoria, evitando duas
 * versões divergentes do mesmo cálculo.
 */
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from './marketDataService.js';
import { scoringEngine } from './engines/scoringEngine.js';
import { buildBuyAndHoldRanking } from './engines/fiiBuyAndHoldEngine.js';
import { FII_BUY_AND_HOLD_CONFIG } from '../config/fiiBuyAndHold.js';
import { DEFAULT_NTNB_FALLBACK, DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';

// Máximo drawdown (%) a partir da série de fechamentos ajustados (pico→vale).
const maxDrawdownPct = history => {
  const closes = (history || [])
    .map(point => Number(point.adjClose ?? point.close))
    .filter(Number.isFinite);
  if (closes.length < 2) return null;
  let peak = closes[0];
  let worst = 0;
  for (const close of closes) {
    if (close > peak) peak = close;
    if (peak > 0) worst = Math.max(worst, (peak - close) / peak);
  }
  return Math.round(worst * 1000) / 10;
};

/** Constrói os candidatos processados (scoring estrutural + metadados + drawdown). */
const buildCandidates = async () => {
  const [rawData, macroConfig] = await Promise.all([
    marketDataService.getMarketData('FII'),
    SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean(),
  ]);

  const context = {
    MACRO: macroConfig ? {
      SELIC: macroConfig.selic, IPCA: macroConfig.ipca, RISK_FREE: macroConfig.riskFree,
      NTNB_LONG: macroConfig.ntnbLong, RATES_STALE: !!macroConfig.ratesStale,
    } : {
      SELIC: DEFAULT_SELIC_FALLBACK, IPCA: 4.5, RISK_FREE: DEFAULT_SELIC_FALLBACK,
      NTNB_LONG: DEFAULT_NTNB_FALLBACK, RATES_STALE: true,
    },
  };

  const tickers = rawData.map(asset => asset.ticker);
  const [dbRows, histRows] = await Promise.all([
    MarketAsset.find({ ticker: { $in: tickers }, type: 'FII' })
      .select('ticker fiiSubType isTier1').lean(),
    AssetHistory.find({ ticker: { $in: tickers } }).select('ticker history').lean(),
  ]);
  const metaByTicker = new Map(dbRows.map(row => [row.ticker, row]));
  const histByTicker = new Map(histRows.map(row => [row.ticker, row.history]));

  const candidates = [];
  for (const rawAsset of rawData) {
    const meta = metaByTicker.get(rawAsset.ticker) || {};
    const processed = scoringEngine.processAsset(rawAsset, context);
    if (!processed || processed._discarded) continue;

    candidates.push({
      ticker: processed.ticker,
      name: processed.name,
      sector: processed.sector,
      fiiSubType: meta.fiiSubType ?? rawAsset.fiiSubType ?? null,
      isTier1: !!meta.isTier1,
      metrics: processed.metrics,
      currentPrice: processed.currentPrice,
      targetPrice: processed.targetPrice,
      // `distributionStreakYears`/`dyVolatility` ficam ausentes de propósito: o
      // FundamentalSnapshot ainda não tem profundidade (1 leitura por FII) e
      // inventar o streak seria pior que assumir o teto de confiança.
      consistency: { maxDrawdownPct: maxDrawdownPct(histByTicker.get(rawAsset.ticker)) },
    });
  }

  return { candidates, macro: context.MACRO };
};

const round1 = value => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);

const compactRow = item => ({
  position: item.position,
  ticker: item.ticker,
  name: item.name,
  sector: item.sector,
  subType: item.subType,
  manager: item.manager,
  score: item.score,
  action: item.action,
  axes: item.axes,
  composite: item.composite,
  entryPenalty: item.entry.penalty,
  spreadPp: item.entry.spread,
  pFfo: round1(item.entry.pFfo),
  ffoCoverage: round1(item.ffoCoverage),
  reason: item.reason,
});

/**
 * Gera o ranking âncora de FIIs a partir dos dados atuais. Read-only.
 * @param {object} [opts]
 * @param {boolean} [opts.includeExcluded] inclui a lista detalhada de exclusões.
 */
export const generateFiiBuyAndHoldRanking = async ({ includeExcluded = false } = {}) => {
  const { candidates, macro } = await buildCandidates();
  const result = buildBuyAndHoldRanking(candidates, { MACRO: macro }, FII_BUY_AND_HOLD_CONFIG);

  const excludedByReason = Object.entries(
    result.excluded.reduce((counts, item) => {
      const key = item.gate.failures[0] || 'desconhecido';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
  ).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));

  const managers = new Set(result.ranking.map(item => item.manager));

  return {
    version: result.version,
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    config: {
      minMarketCap: FII_BUY_AND_HOLD_CONFIG.gate.minMarketCap,
      minAvgLiquidity: FII_BUY_AND_HOLD_CONFIG.gate.minAvgLiquidity,
      maxVacancy: FII_BUY_AND_HOLD_CONFIG.gate.maxVacancy,
      weights: FII_BUY_AND_HOLD_CONFIG.weights,
      entry: FII_BUY_AND_HOLD_CONFIG.entry,
    },
    macro,
    counts: { ...result.counts, distinctManagers: managers.size },
    ranking: result.ranking.map(compactRow),
    excludedByReason,
    excluded: includeExcluded
      ? result.excluded
        .map(item => ({ ticker: item.ticker, failures: item.gate.failures }))
        .sort((a, b) => a.ticker.localeCompare(b.ticker))
      : undefined,
  };
};

export const fiiBuyAndHoldService = { generateFiiBuyAndHoldRanking };
