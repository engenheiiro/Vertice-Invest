/**
 * Serviço do ranking "Buy-and-Hold" (estratégia BUY_AND_HOLD) — shadow.
 *
 * Gera o ranking a partir dos dados ATUAIS (read-only): não persiste
 * MarketAnalysis nem toca em publicação. Centraliza a montagem de candidatos
 * usada tanto pelo endpoint admin quanto pelo script de auditoria, evitando
 * duas versões divergentes do mesmo cálculo.
 */
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from './marketDataService.js';
import { scoringEngine } from './engines/scoringEngine.js';
import { buildBuyAndHoldRanking } from './engines/buyAndHoldEngine.js';
import { BUY_AND_HOLD_CONFIG } from '../config/buyAndHold.js';
import { DEFAULT_NTNB_FALLBACK, DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';

/**
 * Máximo drawdown (%) pico→vale, medido numa JANELA COMUM a todo o universo.
 *
 * A janela não é detalhe de implementação: o drawdown entra no eixo de
 * consistência, que é comparado entre ativos numa lista única. Medir cada um na
 * série inteira compara janelas de tamanhos diferentes, e o número deixa de
 * dizer "quem caiu mais" para dizer "quem tem série mais longa".
 *
 * Não é hipótese — é o que a base faz hoje (medição de 22/08/2026): o
 * timeSeriesWorker guarda `ASSET_HISTORY_MAX_POINTS` (400) candles por ticker,
 * mas 4 documentos de STOCK escaparam do corte e ainda têm 1653 (CMIG4, ITSA4,
 * PETR4, SHUL4). Dois deles estão no universo âncora, e a janela extra alcança
 * o crash de março/2020:
 *
 *   ITSA4  série inteira 44,8%  ·  últimos 400 candles 17,7%
 *   CMIG4  série inteira 50,4%  ·  últimos 400 candles 25,1%
 *
 * Ou seja: a Itaúsa aparecia como o ativo mais instável da lista (consistência
 * 34/100, que derrubava o score de 76 para 67 e o tirava de COMPRAR) por ter
 * série mais funda que os pares, não por ter caído mais que eles no mesmo
 * período. Truncar todo mundo na mesma janela devolve a comparação.
 *
 * Série curta demais para cobrir a janela vira AUSENTE (null) — peso
 * redistribuído —, nunca nota. Sem esse piso, um ticker com 70 candles exibiria
 * um drawdown pequeno só porque quase não foi observado, e ausência de dado
 * viraria nota alta (o defeito de `Number(null) === 0` pela ponta oposta).
 *
 * Quando a profundidade da série crescer para o universo INTEIRO, a janela deve
 * crescer junto: 400 candles (~1,6 ano) não contêm um ciclo completo, e ciclo
 * completo é exatamente o que um ranking de âncora quer medir.
 */
export const maxDrawdownPct = (history, config = BUY_AND_HOLD_CONFIG) => {
  const { drawdownWindowCandles, drawdownMinCandles } = config.consistency;
  const closes = (history || [])
    .slice(-drawdownWindowCandles)
    .map(point => Number(point.adjClose ?? point.close))
    .filter(Number.isFinite);
  if (closes.length < drawdownMinCandles) return null;
  let peak = closes[0];
  let worst = 0;
  for (const close of closes) {
    if (close > peak) peak = close;
    if (peak > 0) worst = Math.max(worst, (peak - close) / peak);
  }
  return Math.round(worst * 1000) / 10;
};

/** Constrói os candidatos processados (scoring + metadados setoriais + drawdown). */
const buildCandidates = async () => {
  const [rawData, macroConfig] = await Promise.all([
    marketDataService.getMarketData('STOCK'),
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
    MarketAsset.find({ ticker: { $in: tickers }, type: 'STOCK' })
      .select('ticker stockArchetype sectorMetrics isTier1').lean(),
    AssetHistory.find({ ticker: { $in: tickers } }).select('ticker history').lean(),
  ]);
  const metaByTicker = new Map(dbRows.map(row => [row.ticker, row]));
  const histByTicker = new Map(histRows.map(row => [row.ticker, row.history]));

  const candidates = [];
  for (const rawAsset of rawData) {
    const meta = metaByTicker.get(rawAsset.ticker) || {};
    const processed = scoringEngine.processAsset(
      { ...rawAsset, stockArchetype: meta.stockArchetype, sectorMetrics: meta.sectorMetrics || {} },
      context,
    );
    if (!processed || processed._discarded) continue;

    candidates.push({
      ticker: processed.ticker,
      name: processed.name,
      sector: processed.sector,
      stockArchetype: meta.stockArchetype,
      isTier1: meta.isTier1,
      sectorMetrics: meta.sectorMetrics || {},
      metrics: processed.metrics,
      currentPrice: processed.currentPrice,
      targetPrice: processed.targetPrice,
      consistency: { maxDrawdownPct: maxDrawdownPct(histByTicker.get(rawAsset.ticker)) },
    });
  }

  return { candidates, macro: context.MACRO };
};

const compactRow = item => ({
  position: item.position,
  ticker: item.ticker,
  name: item.name,
  sector: item.sector,
  archetype: item.archetype,
  score: item.score,
  action: item.action,
  axes: item.axes,
  premiumPct: item.entry.premium === null || item.entry.premium === undefined
    ? null
    : Math.round(item.entry.premium * 1000) / 10,
  reason: item.reason,
});

/**
 * Gera o ranking Buy-and-Hold a partir dos dados atuais. Read-only.
 * @param {object} [opts]
 * @param {boolean} [opts.includeExcluded] inclui a lista detalhada de exclusões.
 */
export const generateBuyAndHoldRanking = async ({ includeExcluded = false } = {}) => {
  const { candidates, macro } = await buildCandidates();
  const result = buildBuyAndHoldRanking(candidates, BUY_AND_HOLD_CONFIG);

  const excludedByReason = Object.entries(
    result.excluded.reduce((counts, item) => {
      const key = item.gate.failures[0] || 'desconhecido';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
  ).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));

  return {
    version: result.version,
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    config: {
      minMarketCap: BUY_AND_HOLD_CONFIG.gate.minMarketCap,
      maxBeta: BUY_AND_HOLD_CONFIG.gate.maxBeta,
      maxBetaByArchetype: BUY_AND_HOLD_CONFIG.gate.maxBetaByArchetype,
      weights: BUY_AND_HOLD_CONFIG.weights,
    },
    macro,
    counts: result.counts,
    ranking: result.ranking.map(compactRow),
    excludedByReason,
    excluded: includeExcluded
      ? result.excluded
        .map(item => ({ ticker: item.ticker, failures: item.gate.failures }))
        .sort((a, b) => a.ticker.localeCompare(b.ticker))
      : undefined,
  };
};

export const buyAndHoldService = { generateBuyAndHoldRanking };
