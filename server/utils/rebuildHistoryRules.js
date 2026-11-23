/**
 * Regras puras do rebuild de histórico da carteira (`financialService.rebuildUserHistory`).
 *
 * Tudo aqui é decisão sem banco: taxas correntes, profundidade de série exigida,
 * janela de dias, provento do dia, cota TWRR e o formato do snapshot. A
 * orquestração (carregar contexto, aplicar movimentações, marcar a mercado,
 * gravar) continua no serviço. Comportamento idêntico ao método monolítico
 * anterior (guarda: tests/financial_rebuild_characterization.spec.js).
 */
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';
import { isDollarized } from './assetCurrency.js';
import { toDateKey } from './dateUtils.js';
import { calculateDailyDietz, resolveCurrentCdiRate, safeCurrency, safeFloat } from './mathUtils.js';
import { isTwrrReturnAnomalous, snapshotInstantForDay } from './walletSnapshot.js';

/** Versão do cálculo gravada em cada snapshot reconstruído. */
const CALCULATION_VERSION = 5;

/**
 * Taxas correntes da macro, com a mesma cadeia do card e do snapshot (CDI → Selic → fallback).
 *
 * IPCA e câmbio ausentes ficam NULOS (regra 13). Até 22/11/2026 viravam 4,5 e
 * 5,75 fixos, e esses números iam parar nos snapshots gravados como se fossem
 * medição — uma carteira com Tesouro IPCA+ rendia por um IPCA inventado. Quem
 * precisa da taxa e não a tem aborta o rebuild (ver `missingRebuildRates`).
 */
export const resolveRebuildRates = (sysConfig) => ({
    currentCdiRate: resolveCurrentCdiRate(sysConfig, DEFAULT_SELIC_FALLBACK),
    currentIpcaRate: (sysConfig?.ipca && sysConfig.ipca > 0) ? sysConfig.ipca : null,
    currentSelicRate: (sysConfig?.selic && sysConfig.selic > 0) ? sysConfig.selic : undefined,
    currentUsdRate: (sysConfig?.dollar && sysConfig.dollar > 0) ? sysConfig.dollar : null,
});

/**
 * Taxas que FALTAM e de que a carteira PRECISA. Vazio = pode reconstruir.
 *
 *  - IPCA: só renda fixa indexada ao IPCA o usa; sem ele o acúmulo renderia 0
 *    (ou, antes, um 4,5 inventado).
 *  - Câmbio: só exposição em dólar (posição dolarizada ou lançamento em USD,
 *    inclusive de ativo já vendido) o usa, e só falta de verdade quando também
 *    não há série USD/BRL — com série, o resolvedor usa candle real.
 */
export const missingRebuildRates = (rates, { txs = [], userAssets = [], usdSeries = false }) => {
    const missing = [];
    const needsIpca = userAssets.some((a) => String(a?.fixedIncomeIndex || '').toUpperCase() === 'IPCA');
    if (needsIpca && rates.currentIpcaRate == null) missing.push('IPCA');
    const needsUsd = txs.some((t) => t?.currency === 'USD') || userAssets.some((a) => isDollarized(a));
    if (needsUsd && rates.currentUsdRate == null && !usdSeries) missing.push('câmbio USD/BRL');
    return missing;
};

/**
 * Primeiro dia em que cada ticker entrou na carteira — é a profundidade de
 * série que o rebuild exige para marcar a mercado sem inventar preço. Renda
 * fixa e caixa não têm série de preço e ficam de fora.
 */
export const requiredFromByTicker = (txs, assetMetadataMap) => {
    const requiredFrom = new Map();
    for (const tx of txs) {
        const meta = assetMetadataMap.get(tx.ticker);
        if (meta?.type === 'FIXED_INCOME' || meta?.type === 'CASH' || tx.ticker === 'RESERVA') continue;
        const dayKey = toDateKey(tx.date);
        const known = requiredFrom.get(tx.ticker);
        if (!known || dayKey < known) requiredFrom.set(tx.ticker, dayKey);
    }
    return requiredFrom;
};

/** Frase do erro de cobertura: um trecho por ticker sem série suficiente. */
export const describeCoverageGaps = (gaps) => gaps
    .map(g => `${g.ticker} (posição desde ${g.requiredFrom}, série desde ${g.availableFrom || 'nenhuma'})`)
    .join('; ');

/**
 * Janela do rebuild: do dia da primeira transação até `throughDayKey` ou, sem
 * ele, até a VÉSPERA do dia corrente em Brasília. O rebuild nunca antecipa o
 * snapshot do dia: o cron das 23:59 é o único dono desse fechamento; durante o
 * dia, KPI/gráfico usam o ponto live com os fluxos pendentes.
 */
export const rebuildWindow = (firstTxDate, throughDayKey, currentDayKey) => {
    const defaultEnd = new Date(`${currentDayKey}T12:00:00.000Z`);
    defaultEnd.setUTCDate(defaultEnd.getUTCDate() - 1);
    const endDayKey = throughDayKey || defaultEnd.toISOString().slice(0, 10);
    return {
        startDate: new Date(`${toDateKey(firstTxDate)}T12:00:00.000Z`),
        today: new Date(`${endDayKey}T12:00:00.000Z`),
    };
};

/** Fator diário do CDI no dia; sem ele, o do ano (cache) e, por fim, 1.0003. */
export const cdiFactorForDay = (dailyFactorsMap, cdiFactorsCacheFallback, cursor, cursorIso) =>
    dailyFactorsMap.get(cursorIso) || cdiFactorsCacheFallback[cursor.getFullYear()] || 1.0003;

/**
 * Caixa de proventos do dia, sobre a posição de ANTES das movimentações do dia
 * (no dia-ex quem compra não tem direito e quem vende tem). Provento em dólar
 * entra em reais pelo câmbio do dia-ex.
 */
export const dayDividendCash = (dayDividends, portfolio, dividendFx, cursorIso) => {
    let cash = 0;
    for (const div of dayDividends) {
        if (portfolio[div.ticker] && portfolio[div.ticker].qty > 0) {
            cash += (portfolio[div.ticker].qty * div.amount * dividendFx(div.ticker, cursorIso));
        }
    }
    return cash;
};

/**
 * Cota TWRR do dia (Modified Dietz diário) em espaço NOMINAL + provento
 * explícito — mesma metodologia do snapshot diário (schedulerService). Retorno
 * anômalo (dado sujo) não move a cota.
 */
export const nextQuota = (currentQuota, { previousEquity, equity, flow, dividendCash }) => {
    if (!(previousEquity > 0 || flow > 0 || dividendCash > 0)) return currentQuota;
    const dailyReturn = calculateDailyDietz(previousEquity, equity, flow, dividendCash);
    return isTwrrReturnAnomalous(dailyReturn) ? currentQuota : currentQuota * (1 + dailyReturn);
};

/** Snapshot reconstruído de um dia útil. */
export const buildRebuildSnapshot = ({ userId, walletId, cursorIso, source, calculatedAt, equity, invested, dividends, quota }) => ({
    user: userId,
    wallet: walletId,
    date: snapshotInstantForDay(cursorIso),
    dayKey: cursorIso,
    source,
    calculationVersion: CALCULATION_VERSION,
    calculatedAt,
    totalEquity: safeCurrency(equity),
    totalInvested: safeCurrency(invested),
    totalDividends: safeCurrency(dividends),
    profit: safeCurrency(equity - invested + dividends),
    profitPercent: safeFloat(invested > 0 ? ((equity - invested + dividends) / invested) * 100 : 0),
    quotaPrice: safeFloat(quota),
});
