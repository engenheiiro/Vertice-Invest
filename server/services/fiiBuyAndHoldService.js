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
import { maxDrawdownPct } from '../utils/assetHistory.js';



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
      consistency: { maxDrawdownPct: maxDrawdownPct(histByTicker.get(rawAsset.ticker), FII_BUY_AND_HOLD_CONFIG.consistency) },
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
  // `vacancy` null = leitura da fonte descartada por implausível (o motivo diz
  // qual era). Nunca confundir com vacância zero.
  vacancy: round1(item.vacancy?.value),
  vacancyRaw: round1(item.vacancy?.raw),
  // Presente só quando o fundo seria COMPRAR e foi segurado pelo teto de
  // composição da lista publicável (papel ou gestora).
  publicationLimit: item.publicationLimit,
  currentPrice: item.currentPrice ?? null,
  targetPrice: item.targetPrice ?? null,
  // Travamentos de AGUARDAR que NÃO são o limiar de score. A histerese da
  // publicação cede no score e em mais nada — precisa saber distinguir.
  expensive: !!item.entry.expensive,
  payoutUncovered: !!item.payoutUncovered,
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
  // O motor é função pura de SCORE e não devolve preço; a tela âncora precisa
  // mostrar preço atual x preço justo, então recolamos os dois do candidato.
  const priceByTicker = new Map(candidates.map(c => [c.ticker, c]));
  for (const item of result.ranking) {
    const source = priceByTicker.get(item.ticker);
    item.currentPrice = source?.currentPrice ?? null;
    item.targetPrice = source?.targetPrice ?? null;
  }

  const excludedByReason = Object.entries(
    result.excluded.reduce((counts, item) => {
      const key = item.gate.failures[0] || 'desconhecido';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
  ).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));

  const managers = new Set(result.ranking.map(item => item.manager));

  // Composição da lista PUBLICÁVEL — é ela que o assinante vê, e é sobre ela que
  // o teto de papel/gestora incide. Contar só os elegíveis escondia o problema.
  const buyList = result.ranking.filter(item => item.action === 'BUY');
  const heldByLimit = result.ranking.filter(item => item.publicationLimit);

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
      publication: FII_BUY_AND_HOLD_CONFIG.publication,
    },
    macro,
    counts: {
      ...result.counts,
      distinctManagers: managers.size,
      buyPaper: buyList.filter(item => item.subType === 'PAPEL').length,
      buyManagers: new Set(buyList.map(item => item.manager)).size,
      heldByPublicationLimit: heldByLimit.length,
    },
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
