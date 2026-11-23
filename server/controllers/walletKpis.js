// KPIs live da carteira, fluxo do período e métricas TWRR/Sharpe. Extraído de walletController.js.
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeAdd, safeMult, safeValue, QUANTITY_EPSILON, selectAnchorSnapshot, computeLiveQuota } from '../utils/mathUtils.js';
import { computeQuotaSharpe, snapshotDayKey } from '../utils/walletRisk.js';
import { brazilDateKey, toDateKey } from '../utils/dateUtils.js';
import { valueFixedIncomeAsset, brazilToday } from '../utils/fixedIncome.js';
import { loadTreasuryPricing } from '../services/treasuryPriceService.js';
import { loadDisplayUsdRate, positionCostBRL, positionRealizedProfitBRL, usdMultiplierFor } from '../utils/fxRate.js';
import { businessDaysBetween, sumTransactionFlowBRL, transactionsAfterSnapshotFilter } from '../utils/walletSnapshot.js';
import { loadCdiCurveForAssets, EMPTY_CDI_CURVE } from '../utils/cdiCurve.js';
import { cdiAnnualRateForYear, DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';

export const getDailyFactorForDate = (date, currentConfigRate, cdiCurve = EMPTY_CDI_CURVE) => {
    // Taxa VIGENTE no dia pela curva do CDI (série SELIC gravada) — a mesma fonte
    // da renda fixa. Antes este benchmark só lia a média anual da tabela: o ano
    // corrente inteiro rendia a taxa de HOJE, e um ano fechado fora da tabela
    // (2025) caía no legado de 10%, encolhendo o CDI contra a carteira.
    // Sem curva, a resolução por ano de financialConstants segue valendo.
    const fromCurve = cdiCurve.annualRateFor(date.toISOString().slice(0, 10));
    const rate = Number.isFinite(fromCurve) && fromCurve > 0
        ? fromCurve
        : cdiAnnualRateForYear(date.getUTCFullYear(), {
            currentRate: currentConfigRate || DEFAULT_SELIC_FALLBACK,
            fallback: 10.0,
        });
    return Math.pow(1 + (rate / 100), 1/252);
};

// Valor da posição na MOEDA NATIVA para o KPI live (antes do câmbio).
const liveNativeValue = (asset, { currentCdi, selic, ipca, calcDate, cdiCurve, treasuryPricing, marketMap }) => {
    if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
        // Fonte única de valorização (idêntica ao getWalletData) — antes este
        // caminho ignorava o rendimento (val = qty), divergindo do KPI.
        return valueFixedIncomeAsset(asset, {
            cdiRate: currentCdi, selic, ipca, calcDate, cdiCurve,
            history: treasuryPricing.historyFor(asset),
        }).value;
    }
    const mData = marketMap.get(asset.ticker);
    // Sem cotação marca no CUSTO médio, como o rebuild e o snapshot diário
    // (`computeEquityAt`) — zerar o saldo aqui e manter o custo fazia o
    // ponto live despencar contra o snapshot de ontem.
    return mData?.price > 0
        ? safeValue(asset.quantity, mData.price)
        : safeFloat(asset.totalCost);
};

const liveDividendTotals = (divData, sinceDayKey) => ({
    totalDividends: divData?.total ?? 0,
    dividendsSinceAnchor: sinceDayKey ? (divData?.sinceTotal ?? 0) : 0,
});

// HELPER: Calcula KPIs em tempo real (versão leve do getWalletData)
// `sinceDayKey` = dia do snapshot-âncora da cota live: devolve também os proventos
// com ex-date DEPOIS dele (`dividendsSinceAnchor`), a renda que `computeLiveQuota`
// credita — mesma janela e mesma conta que o card usa.
export const calculateLiveKPIS = async (userId, currentCdi, walletId, { sinceDayKey = null } = {}) => {
    const activeAssets = await UserAsset.find({ user: userId, wallet: walletId, quantity: { $gt: QUANTITY_EPSILON } });

    if (activeAssets.length === 0) return null;

    // Refresh rápido nos ativos voláteis
    const tickers = activeAssets.filter(a => !['FIXED_INCOME', 'CASH'].includes(a.type)).map(a => a.ticker);
    await marketDataService.refreshQuotesBatch(tickers);

    let totalEquity = 0;
    let totalInvested = 0;

    // (5.4 + 5.8) Dividendos, macro e cotações em lote (sem N+1): em vez de um
    // findOne por ativo, getMarketDataMap resolve todos os tickers de uma vez.
    //
    // Proventos pelo ACCRUAL (ex-date × quantidade da época), a mesma definição do
    // card, do snapshot diário e do rebuild. Aqui morava `calculateUserDividends()
    // .totalAllTime` (data de PAGAMENTO × quantidade de HOJE): o ponto live do
    // gráfico saltava em relação ao último snapshot sem nada ter acontecido.
    const todayKey = toDateKey(brazilToday());
    const [divData, usdConfig, marketMap, treasuryPricing] = await Promise.all([
        financialService.accrueDividendsByTicker(userId, walletId, todayKey, { sinceDayKey }),
        SystemConfig.findOne({ key: 'MACRO_INDICATORS' }),
        marketDataService.getMarketDataMap(tickers),
        loadTreasuryPricing(activeAssets),
    ]);
    const { totalDividends, dividendsSinceAnchor } = liveDividendTotals(divData, sinceDayKey);

    const { rate: usdRate } = await loadDisplayUsdRate(usdConfig);
    const selic = usdConfig?.selic;
    const ipca = usdConfig?.ipca;
    const calcDate = brazilToday();
    const cdiCurve = await loadCdiCurveForAssets(activeAssets, { currentRate: currentCdi });

    const valuationCtx = { currentCdi, selic, ipca, calcDate, cdiCurve, treasuryPricing, marketMap };
    for (const asset of activeAssets) {
        const multiplier = usdMultiplierFor(asset, usdRate);
        const val = liveNativeValue(asset, valuationCtx);

        totalEquity += safeMult(val, multiplier);
        // Custo com o câmbio de cada compra congelado — o Valor Aplicado não pode
        // oscilar sozinho quando o dólar mexe (só o saldo é marcado a mercado).
        totalInvested += safeFloat(positionCostBRL(asset, usdRate));
    }

    return {
        totalEquity,
        totalInvested,
        totalDividends,
        dividendsSinceAnchor,
    };
};

/**
 * Lucro realizado da carteira em BRL: TODAS as posições (encerradas e abertas
 * com venda parcial), cada venda no câmbio do dia dela via positionRealizedProfitBRL
 * (regra 8 do CLAUDE.md). Exportada para o teste travar a regra.
 */
export const sumRealizedProfitBRL = (userAssets, usdRate) =>
    (userAssets || []).reduce((acc, a) => safeAdd(acc, safeFloat(positionRealizedProfitBRL(a, usdRate))), 0);

// --- CÁLCULO LIVE TWRR + VOLATILIDADE (SOURCE OF TRUTH BLINDADA) ---
// Beta omitido aqui pois exigiria buscar histórico do Ibovespa (pesado) —
// disponível em getWalletPerformance.
/**
 * Carregador da série USD-BRL com UMA leitura por requisição.
 *
 * `loadUsdRateResolver` puxa o documento `USD-BRL` inteiro e remonta Map + sort
 * da série toda — e ele é a série que `HISTORY_CAP_EXEMPT_TICKERS` isenta do teto
 * de 400 candles, logo a mais longa que a carteira lê. O caminho de `GET /wallet`
 * pedia isso DUAS vezes: uma para resolver um único dia (o câmbio do dia-âncora) e
 * outra lá no fim, dentro do fluxo do período. Duas idas ao banco, dois Maps, para
 * o mesmo dado imutável dentro da requisição.
 *
 * Preguiçoso de propósito: carteira sem snapshot e sem dia-âncora não precisa da
 * série, e neste caso nenhuma leitura acontece.
 *
 * Exportado para teste: "quantas vezes foi ao banco" é o contrato, e ele não
 * aparece em nenhum valor de retorno de `buildWalletPayload`.
 */
export const usdRateLoaderOnce = (currentUsd) => {
    let pending = null;
    return () => {
        if (!pending) pending = financialService._loadUsdRateResolver(currentUsd);
        return pending;
    };
};

export const computePendingFlowBRL = async ({ userId, walletId, anchor, currentUsd, loadUsdRate = null }) => {
    if (!anchor) return 0;
    const txs = await AssetTransaction.find({
        user: userId,
        wallet: walletId,
        ...transactionsAfterSnapshotFilter(anchor),
    }).lean();
    if (txs.length === 0) return 0;

    const tickers = [...new Set(txs.map((tx) => tx.ticker))];
    const assets = await UserAsset.find({ user: userId, wallet: walletId, ticker: { $in: tickers } }).lean();
    const assetsByTicker = new Map(assets.map((asset) => [asset.ticker, asset]));
    // O chamador que já vai ler a série passa o carregador dele; quem não tem um
    // (o /performance) carrega por conta, como sempre carregou.
    const getUsdRateForDate = loadUsdRate
        ? await loadUsdRate()
        : await financialService._loadUsdRateResolver(currentUsd);
    return sumTransactionFlowBRL(txs, assetsByTicker, getUsdRateForDate);
};

export const computeWalletMetrics = async ({
    userId, walletId, snapshots, riskSnapshots, safeTotalEquity, totalResultPercent, currentCdi, currentUsd,
    pendingFlow = null, dividendsSinceAnchor = null,
}) => {
    const now = new Date();
    let weightedRentability = 0;
    let dataQuality = 'AUDITED'; // Default Audited
    // Beta exigiria o histórico do Ibovespa (fetch extra numa rota quente) e hoje
    // nada na UI o consome. `null` = "não medido aqui"; o /performance calcula.
    // Antes ia como 0, que se lê como "carteira imune ao mercado" — uma afirmação
    // que este caminho nunca fez.
    const beta = null;

    // Snapshots (últimos 30) já carregados no lote paralelo acima (5.4).
    // Âncora via regra única compartilhada (paridade KPI × gráfico).
    const lastSnapshot = selectAnchorSnapshot(snapshots);

    if (lastSnapshot && lastSnapshot.quotaPrice) {
        // SELO: a cota live é "Auditada" enquanto estiver ancorada no ÚLTIMO
        // fechamento que deveria existir. O que degrada a medida é fechamento que
        // FALTA — não tempo de calendário.
        //
        // Media-se em DIAS ÚTEIS BR, pela mesma lista que o backfill usa para
        // decidir o que reconstruir: se não há nada a preencher, não há buraco.
        // A régua antiga (`> 3 dias corridos`) não conhecia fim de semana nem
        // feriado, e por isso acusava a carteira sadia em todo feriadão — numa
        // terça após o 7 de Setembro, o âncora legítimo (sexta) tinha 3,6 dias de
        // idade e o selo caía para "Estimado" com ZERO fechamentos faltando.
        const anchorDayKey = lastSnapshot.dayKey || snapshotDayKey(lastSnapshot);
        const missedCloses = businessDaysBetween(anchorDayKey, brazilDateKey(now));
        if (missedCloses.length > 0) dataQuality = 'ESTIMATED';

        // O fluxo do período costuma vir pronto: quem chama já o disparou lá em
        // cima, junto do resto, porque ele não depende de NADA que o laço de
        // ativos produz. Aqui ele só é colhido. Sem a promessa (chamador que não
        // pôde adiantar), busca na hora — mesmo resultado, três idas ao banco
        // enfileiradas na cauda da requisição.
        const periodFlow = pendingFlow !== null
            ? await pendingFlow
            : await computePendingFlowBRL({ userId, walletId, anchor: lastSnapshot, currentUsd });

        // Fonte única da cota live (utils/mathUtils.computeLiveQuota) — mesmo
        // cálculo que getWalletPerformance usa no ponto live.
        //
        // Renda do período: proventos com ex-date depois do âncora. Só vale se foi
        // recortada a partir DESTE âncora — depois das 23:59 o snapshot de hoje
        // vira âncora e já contém os proventos do dia; somá-los de novo dobraria.
        const periodIncome = dividendsSinceAnchor && dividendsSinceAnchor.dayKey === anchorDayKey
            ? dividendsSinceAnchor.total
            : 0;
        const liveQuotaPrice = computeLiveQuota(lastSnapshot, safeTotalEquity, periodFlow, periodIncome);
        weightedRentability = ((liveQuotaPrice / 100) - 1) * 100;
    } else {
        weightedRentability = totalResultPercent;
        dataQuality = 'ESTIMATED'; // Sem histórico, é apenas ROI simples
    }

    // --- CÁLCULO DE VOLATILIDADE (Sharpe) ---
    // Janela, corte de regime, validação de espaçamento e guardas de amostra
    // vivem em utils/walletRisk — fonte ÚNICA compartilhada com
    // getWalletPerformance. `sharpe` vem null quando não é calculável (≠ zero,
    // que é valor legítimo). Usa a série de risco, não os snapshots do âncora.
    const { sharpe: sharpeRatio, confidence, standardError, sample } =
        computeQuotaSharpe(riskSnapshots, currentCdi);

    return {
        weightedRentability,
        dataQuality,
        sharpeRatio,
        sharpeConfidence: confidence,
        sharpeStandardError: standardError,
        sharpeSample: sample,
        beta,
    };
};
