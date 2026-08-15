
import mongoose from 'mongoose';
import { runTransaction, txError } from '../utils/dbTransaction.js';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import TreasuryBond from '../models/TreasuryBond.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculatePercent, calculateDailyDietz, safeValue, safePrice, QUANTITY_EPSILON, selectAnchorSnapshot, computeLiveQuota, benchmarkStep } from '../utils/mathUtils.js';
import { computeQuotaSharpe, computeQuotaBeta, snapshotDayKey, SHARPE_WINDOW_SNAPSHOTS } from '../utils/walletRisk.js';
import { countBusinessDays, isBusinessDay, toDateKey, startOfDay, parseCalendarDate } from '../utils/dateUtils.js';
import { assetDailyFactor, valueFixedIncomeAsset, PRICING_SOURCE, brazilToday, brazilDateOnly, isMatured } from '../utils/fixedIncome.js';
import { loadTreasuryPricing, EMPTY_TREASURY_PRICING } from '../services/treasuryPriceService.js';
import { isDollarized, resolveAssetCurrency, resolveTransactionCurrency, needsCurrencyFallback } from '../utils/assetCurrency.js';
import { positionCostBRL, positionRealizedProfitBRL } from '../utils/fxRate.js';
import { sumTransactionFlowBRL, transactionsAfterSnapshotFilter } from '../utils/walletSnapshot.js';
import { resolveAllocationClass } from '../utils/assetAllocation.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { cdiAnnualRateForYear, DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';
import { runDailySnapshot } from '../services/schedulerService.js'; // Importado

const getDailyFactorForDate = (date, currentConfigRate) => {
    // Resolução da taxa por ano centralizada em financialConstants. Fallback 10.0
    // preservado (legado desta curva de benchmark); o cálculo de risco usa outro.
    const rate = cdiAnnualRateForYear(date.getFullYear(), {
        currentRate: currentConfigRate || DEFAULT_SELIC_FALLBACK,
        fallback: 10.0,
    });
    return Math.pow(1 + (rate / 100), 1/252);
};

// HELPER: Calcula KPIs em tempo real (versão leve do getWalletData)
const calculateLiveKPIS = async (userId, currentCdi, walletId) => {
    const activeAssets = await UserAsset.find({ user: userId, wallet: walletId, quantity: { $gt: QUANTITY_EPSILON } });

    if (activeAssets.length === 0) return null;

    // Refresh rápido nos ativos voláteis
    const tickers = activeAssets.filter(a => !['FIXED_INCOME', 'CASH'].includes(a.type)).map(a => a.ticker);
    await marketDataService.refreshQuotesBatch(tickers);

    let totalEquity = 0;
    let totalInvested = 0;
    let totalDividends = 0;

    // (5.4 + 5.8) Dividendos, macro e cotações em lote (sem N+1): em vez de um
    // findOne por ativo, getMarketDataMap resolve todos os tickers de uma vez.
    const [divData, usdConfig, marketMap, treasuryPricing] = await Promise.all([
        financialService.calculateUserDividends(userId, walletId),
        SystemConfig.findOne({ key: 'MACRO_INDICATORS' }),
        marketDataService.getMarketDataMap(tickers),
        loadTreasuryPricing(activeAssets),
    ]);
    totalDividends = divData.totalAllTime;

    const usdRate = usdConfig?.dollar || 5.75;
    const selic = usdConfig?.selic;
    const ipca = usdConfig?.ipca;
    const calcDate = brazilToday();

    for (const asset of activeAssets) {
        const multiplier = isDollarized(asset) ? usdRate : 1;

        let val;
        if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
            // Fonte única de valorização (idêntica ao getWalletData) — antes este
            // caminho ignorava o rendimento (val = qty), divergindo do KPI.
            val = valueFixedIncomeAsset(asset, {
                cdiRate: currentCdi, selic, ipca, calcDate,
                history: treasuryPricing.historyFor(asset),
            }).value;
        } else {
            const mData = marketMap.get(asset.ticker);
            val = safeValue(asset.quantity, mData?.price || 0);
        }

        totalEquity += safeMult(val, multiplier);
        // Custo com o câmbio de cada compra congelado — o Valor Aplicado não pode
        // oscilar sozinho quando o dólar mexe (só o saldo é marcado a mercado).
        totalInvested += safeFloat(positionCostBRL(asset, usdRate));
    }

    return {
        totalEquity,
        totalInvested,
        totalDividends
    };
};

// (6.2) Limite de profundidade do auto-heal: getWalletData recursa no máximo
// MAX_WALLET_HEAL_DEPTH vezes para nunca entrar em loop infinito caso o
// recálculo de posições reporte sucesso mas não estabilize o estado.
const MAX_WALLET_HEAL_DEPTH = 1;

// (6.3) Helpers extraídos de getWalletData para que cada etapa seja pequena e
// testável isoladamente. A aritmética financeira é idêntica à versão monolítica.

// Carrega preferências (agora por carteira, Fase 2) + holdings e deriva targets/active/closed.
const loadWalletState = async (userId, walletId) => {
    // (5.4) Preferências e holdings dependem só do walletId → buscadas em paralelo.
    const [walletPrefs, userAssets] = await Promise.all([
        Wallet.findById(walletId).select('targetAllocation targetReserve targetMonthlyDividendIncome targetSubAllocation').lean(),
        UserAsset.find({ user: userId, wallet: walletId }),
    ]);

    // Carteira ideal (alocação-alvo + sub-metas) desta carteira — acompanha a resposta.
    const targets = {
        targetAllocation: walletPrefs?.targetAllocation || { STOCK: 40, FII: 30, STOCK_US: 20, ETF: 0, CRYPTO: 10, FIXED_INCOME: 0 },
        targetReserve: typeof walletPrefs?.targetReserve === 'number' ? walletPrefs.targetReserve : 10000,
        targetMonthlyDividendIncome: typeof walletPrefs?.targetMonthlyDividendIncome === 'number' ? walletPrefs.targetMonthlyDividendIncome : 0,
        targetSubAllocation: walletPrefs?.targetSubAllocation || {
            STOCK: { STOCK: 0, ETF: 0 },
            FIXED_INCOME: { IPCA: 0, POS: 0, PRE: 0 },
            STOCK_US: { STOCK: 0, REIT: 0, ETF: 0, DOLLAR: 0 },
        },
    };

    const activeAssets = userAssets.filter(a => a.quantity > QUANTITY_EPSILON);
    const closedAssets = userAssets.filter(a => a.quantity <= QUANTITY_EPSILON);

    return { userAssets, activeAssets, closedAssets, targets };
};

// Auto-Heal: sem ativos ativos mas com transações → reconstrói as posições.
// Retorna os ativos curados (>0) ou null se nada foi reconstruído.
const autoHealPositions = async (userId, walletId) => {
    const txCount = await AssetTransaction.countDocuments({ user: userId, wallet: walletId });
    if (txCount === 0) return null;

    const allTxs = await AssetTransaction.find({ user: userId, wallet: walletId });
    const distinctTickers = [...new Set(allTxs.map(t => t.ticker))];
    for (const ticker of distinctTickers) {
        await financialService.recalculatePosition(userId, ticker, null, null, null, walletId);
    }
    const healedAssets = await UserAsset.find({ user: userId, wallet: walletId, quantity: { $gt: QUANTITY_EPSILON } });
    return healedAssets.length > 0 ? healedAssets : null;
};

// Resposta para carteira vazia (sem holdings).
const buildEmptyWalletResponse = async (targets) => {
    const emptyConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    const emptyUsdRate = safeFloat(emptyConfig?.dollar || 5.75);
    return {
        assets: [],
        kpis: {
            totalEquity: 0, totalInvested: 0, totalResult: 0, totalResultPercent: 0,
            dayVariation: 0, dayVariationPercent: 0, totalDividends: 0, projectedDividends: 0,
            weightedRentability: 0,
            dataQuality: 'AUDITED',
            // Carteira vazia não tem risco medível — null, não zero.
            sharpeRatio: null,
            sharpeConfidence: null,
            sharpeStandardError: null,
            sharpeSample: 0,
            beta: null
        },
        ...targets,
        meta: { usdRate: emptyUsdRate }
    };
};

// (5.4 + 5.8) Quatro leituras independentes resolvidas num único lote:
// cotações (1 query em lote, sem N+1 — 5.8), macro, dividendos e os snapshots
// usados no TWRR/Sharpe. (5.3) Promise.allSettled: se uma falha (ex.: cálculo
// de dividendos), a carteira ainda renderiza com degradação graciosa.
const fetchWalletMarketContext = async (userId, liveTickers, walletId, activeAssets = []) => {
    const [assetMapR, configR, dividendsR, snapshotsR, riskSnapshotsR, treasuryR] = await Promise.allSettled([
        marketDataService.getMarketDataMap(liveTickers),
        SystemConfig.findOne({ key: 'MACRO_INDICATORS' }),
        financialService.calculateUserDividends(userId, walletId),
        WalletSnapshot.find({ user: userId, wallet: walletId }).sort({ date: -1 }).limit(30).lean(),
        // Série de risco (Sharpe): janela própria, MAIOR e com o mesmo filtro de
        // patrimônio do /performance — é o que garante que os dois caminhos vejam
        // o mesmo conjunto. Query separada de propósito: a busca acima define o
        // snapshot-âncora do TWRR e mexer no limite dela mudaria a cota exibida.
        // Projetada nos campos usados, então são documentos pequenos.
        WalletSnapshot.find({ user: userId, wallet: walletId, totalEquity: { $gt: 1 } })
            .sort({ date: -1 })
            .limit(SHARPE_WINDOW_SNAPSHOTS)
            .select('date quotaPrice totalEquity totalInvested')
            .lean(),
        // Séries de PU dos títulos públicos da carteira (marcação a mercado da RF).
        // Sem renda fixa na carteira, não vai ao banco.
        loadTreasuryPricing(activeAssets),
    ]);

    const assetMap = assetMapR.status === 'fulfilled' ? assetMapR.value : new Map();
    const config = configR.status === 'fulfilled' ? configR.value : null;
    const { totalAllTime: totalDividends = 0, projectedMonthly = 0, receivedByTicker = {} } =
        dividendsR.status === 'fulfilled' ? dividendsR.value : {};
    const snapshots = snapshotsR.status === 'fulfilled' ? snapshotsR.value : [];
    const riskSnapshots = riskSnapshotsR.status === 'fulfilled' ? riskSnapshotsR.value : [];
    // Falha ao carregar PU não derruba a carteira: a RF volta para o accrual.
    const treasuryPricing = treasuryR.status === 'fulfilled' ? treasuryR.value : EMPTY_TREASURY_PRICING;

    return { assetMap, config, totalDividends, projectedMonthly, receivedByTicker, snapshots, riskSnapshots, treasuryPricing };
};

// Processa um único ativo: resolve preço/variação e devolve o card pronto +
// as contribuições para os totais da carteira. Aritmética idêntica à original.
export const processWalletAsset = (asset, { assetMap, usdRate, usdChange, macroRates, isTodayBusinessDay, treasuryPricing = EMPTY_TREASURY_PRICING }) => {
    let currentPrice = 0;
    let dayChangePct = 0;
    // Renda fixa/caixa: valor TOTAL da posição (fonte da verdade). Guardado à parte
    // porque re-derivar via quantidade × preço unitário perde precisão — safeFloat
    // arredonda o preço a 4 casas e, numa reserva com muitas "unidades" (ex.: 15.000),
    // isso descarta centavos (R$15.000 a 100% CDI → 1,000525 vira 1,0005 → perde R$0,38).
    let accruedTotalValue = null;
    let matured = false; // C2: título de RF vencido (accrual congelado, sugere resgate)
    let pricing = null;  // diagnóstico da renda fixa (mercado × curva) para a UI

    if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
        // Fonte única (utils/fixedIncome): marca a mercado quando o título público
        // foi identificado, senão compõe a taxa. Idêntica ao calculateLiveKPIS e ao
        // snapshot, garantindo que KPI, ponto live do gráfico e histórico batam.
        const calcDate = brazilToday();
        const history = treasuryPricing.historyFor(asset);
        pricing = valueFixedIncomeAsset(asset, { ...macroRates, calcDate, history });

        const totalCurrentValue = pricing.value;
        accruedTotalValue = totalCurrentValue;
        const totalQuantity = asset.quantity;

        if (totalQuantity > 0) {
            currentPrice = totalCurrentValue / totalQuantity;
        } else {
            currentPrice = asset.type === 'CASH' ? 1 : safeDiv(asset.totalCost, asset.quantity);
        }

        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

        if (pricing.source === PRICING_SOURCE.MTM) {
            // Marcado: a variação do dia é a do PU — e só existe quando o PU
            // publicado é o de HOJE. A série oficial sai de manhã e é ingerida no
            // fim do dia; repetir a variação de ontem enquanto isso mostraria um
            // movimento que não aconteceu hoje.
            dayChangePct = (pricing.priceDate === todayStr && pricing.previousMarket > 0)
                ? ((pricing.value / pricing.previousMarket) - 1) * 100
                : 0;
        } else {
            const effectiveDailyFactor = assetDailyFactor(asset, macroRates);
            dayChangePct = isTodayBusinessDay ? (effectiveDailyFactor - 1) * 100 : 0;

            // Ativo comprado HOJE: zera a variação do dia (evita variação irreal).
            const lotDayStr = (d) => {
                const o = new Date(d);
                if (o.getUTCHours() === 0 && o.getUTCMinutes() === 0 && o.getUTCSeconds() === 0) return o.toISOString().split('T')[0];
                return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(o);
            };
            const boughtToday = asset.taxLots && asset.taxLots.length > 0 && asset.taxLots.every(lot => lotDayStr(lot.date) === todayStr);
            if (boughtToday) dayChangePct = 0;
        }

        // C2: título vencido não rende mais — zera a variação do dia (o valor já
        // vem congelado no vencimento). isMatured usa a mesma calcDate.
        matured = isMatured(asset, calcDate);
        if (matured) dayChangePct = 0;

    } else {
        const cached = assetMap.get(asset.ticker);
        if (cached && cached.price > 0) {
            currentPrice = safeFloat(Number(cached.price));
            if (asset.type === 'CRYPTO') {
                dayChangePct = safeFloat(Number(cached.change));
            } else {
                dayChangePct = isTodayBusinessDay ? safeFloat(Number(cached.change)) : 0;
            }

            // Ajuste para ativos comprados HOJE (evita variação irreal no dia da compra)
            const todayStr = toDateKey(new Date());
            const boughtToday = asset.taxLots && asset.taxLots.length > 0 && asset.taxLots.every(lot => toDateKey(lot.date) === todayStr);

            if (boughtToday && asset.quantity > 0) {
                const averagePrice = safePrice(asset.totalCost, asset.quantity);
                if (averagePrice > 0) {
                    dayChangePct = ((currentPrice / averagePrice) - 1) * 100;
                }
            }
        } else {
            currentPrice = 0;
            dayChangePct = 0;
        }
    }

    const dollarized = isDollarized(asset);
    const currentMultiplier = dollarized ? usdRate : 1;
    const prevMultiplier = dollarized ? (usdRate / (1 + usdChange/100)) : 1;

    const valueBase = asset.type === 'CASH' ? asset.quantity : safeValue(asset.quantity, currentPrice);
    // Renda fixa/caixa: multiplica o TOTAL acumulado (preciso) pelo câmbio, em vez de
    // reconstruir via quantidade × preço unitário arredondado (que perdia centavos).
    const totalValueBr = accruedTotalValue !== null
        ? safeMult(accruedTotalValue, currentMultiplier)
        : safeMult(valueBase, currentMultiplier);

    // Custo em BRL com o câmbio de CADA compra congelado. Reconverter o custo em
    // dólar pela cotação de hoje (comportamento anterior, hoje só fallback de
    // posição não migrada) cancelava o câmbio contra o saldo: o resultado passava
    // a ser o retorno em dólar, e um stablecoin ficava travado em 0,00% eterno.
    // safeFloat (4 casas) e não safeCurrency: o saldo do outro lado da conta
    // também é 4 casas, e arredondar só o custo criava um percentual fantasma de
    // ~0,05% em posições sem movimento. O arredondamento monetário acontece uma
    // única vez, na saída (`processed.totalCost`).
    const totalCostBr = safeFloat(positionCostBRL(asset, usdRate));

    // Cálculo robusto da variação diária em BRL
    // Considera tanto a variação do ativo quanto a variação cambial
    const priceStart = currentPrice / (1 + dayChangePct/100);
    // Valor de início do dia: renda fixa/caixa deriva do TOTAL acumulado ÷ fator do dia.
    // Divisão CRUA (sem safeDiv) de propósito: o fator ~1,0005 arredondado a 4 casas
    // reintroduziria a perda de centavos; arredonda-se só o resultado monetário final.
    const valueStartBr = accruedTotalValue !== null
        ? safeMult(accruedTotalValue / (1 + dayChangePct / 100), prevMultiplier)
        : safeMult(safeValue(asset.quantity, priceStart), prevMultiplier);

    const dayChangeValueBr = safeSub(totalValueBr, valueStartBr);
    const combinedChangePct = valueStartBr > 0 ? ((totalValueBr / valueStartBr) - 1) * 100 : 0;

    const unrealizedProfitBr = safeSub(totalValueBr, totalCostBr);
    // Cada venda convertida pelo câmbio do dia dela (não o de hoje).
    const realizedProfitBr = safeFloat(positionRealizedProfitBRL(asset, usdRate));
    const positionTotalResult = safeAdd(unrealizedProfitBr, realizedProfitBr);

    let profitPercent = 0;
    if (totalCostBr > 0) {
        // calculatePercent(atual, inicial) = variação entre DOIS VALORES. Passar o
        // lucro como "atual" devolvia lucro/custo − 100 (um ativo com +10% saía
        // como −90%). O valor atual da posição é saldo + realizado.
        profitPercent = calculatePercent(safeAdd(totalValueBr, realizedProfitBr), totalCostBr);
    }

    const processed = {
        id: asset._id,
        ticker: asset.ticker,
        // Nome ao vivo (mercado) → nome salvo (cofrinho/renda fixa) → ticker.
        name: assetMap.get(asset.ticker)?.name || asset.name || asset.ticker,
        type: asset.type,
        // Classe econômica independente do veículo/moeda. O fallback em tempo de
        // leitura corrige posições legadas mesmo antes do backfill persistido.
        allocationClass: resolveAllocationClass({
            ticker: asset.ticker,
            type: asset.type,
            allocationClass: asset.allocationClass || assetMap.get(asset.ticker)?.allocationClass,
            sector: assetMap.get(asset.ticker)?.sector,
        }),
        quantity: asset.quantity,
        averagePrice: asset.quantity > 0 ? safePrice(asset.totalCost, asset.quantity) : 0,
        currentPrice: asset.type === 'CASH' ? 1 : currentPrice,
        currency: asset.currency,
        totalValue: safeCurrency(totalValueBr),
        totalCost: safeCurrency(totalCostBr),
        profit: safeCurrency(positionTotalResult),
        profitPercent: safeFloat(profitPercent),
        sector: assetMap.get(asset.ticker)?.sector || (asset.type === 'FIXED_INCOME' ? 'Renda Fixa' : asset.type === 'CASH' ? 'Caixa' : 'Outros'),
        dayChangePct: safeFloat(combinedChangePct),
        tags: asset.tags, // Return tags
        // Sub-tipos usados pela ramificação da Carteira Ideal (real vs meta):
        // RF → índice (IPCA/SELIC/CDI/PRE); Exterior → usSubType (STOCK/ETF/REIT/DOLLAR).
        fixedIncomeIndex: asset.fixedIncomeIndex || null,
        // Taxa contratada — o front usa junto com o índice para classificar o sub-tipo
        // (%CDI manual sem índice: rate > 50 → pós-fixado, espelhando o accrual).
        fixedIncomeRate: asset.fixedIncomeRate ?? null,
        usSubType: asset.usSubType || null,
        // C1: reserva separada. Fallback p/ posições ainda não migradas: CASH é
        // reserva por natureza (mantém o comportamento antigo até a migração rodar).
        isReserve: asset.isReserve ?? (asset.type === 'CASH'),
        // C2: vencimento da RF + flag VENCIDO (accrual congelado; UI sugere resgate).
        maturityDate: asset.maturityDate || null,
        matured,
        // Renda fixa: como a posição foi precificada. 'MTM' = título público
        // marcado pelo PU oficial; 'ACCRUAL' = valor na curva (RF privada, título
        // com cupom semestral ou série indisponível). `accruedValue` acompanha
        // sempre, para a UI poder mostrar mercado × curva lado a lado.
        pricingSource: pricing ? pricing.source : null,
        accruedValue: pricing ? safeCurrency(safeMult(pricing.accrued, currentMultiplier)) : null,
        priceDate: pricing ? pricing.priceDate : null,
    };

    return { processed, totalValueBr, totalCostBr, dayChangeValueBr };
};

// --- CÁLCULO LIVE TWRR + VOLATILIDADE (SOURCE OF TRUTH BLINDADA) ---
// Beta omitido aqui pois exigiria buscar histórico do Ibovespa (pesado) —
// disponível em getWalletPerformance.
const computePendingFlowBRL = async ({ userId, walletId, anchor, currentUsd }) => {
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
    const getUsdRateForDate = await financialService._loadUsdRateResolver(currentUsd || 5.75);
    return sumTransactionFlowBRL(txs, assetsByTicker, getUsdRateForDate);
};

const computeWalletMetrics = async ({ userId, walletId, snapshots, riskSnapshots, safeTotalEquity, totalResultPercent, currentCdi, currentUsd }) => {
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
        // Se o snapshot encontrado for muito antigo (> 3 dias), a qualidade cai para Estimada
        const diffDays = (now.getTime() - new Date(lastSnapshot.date).getTime()) / (1000 * 3600 * 24);
        if (diffDays > 3) dataQuality = 'ESTIMATED';

        const periodFlow = await computePendingFlowBRL({
            userId, walletId, anchor: lastSnapshot, currentUsd,
        });

        // Fonte única da cota live (utils/mathUtils.computeLiveQuota) — mesmo
        // cálculo que getWalletPerformance usa no ponto live.
        const liveQuotaPrice = computeLiveQuota(lastSnapshot, safeTotalEquity, periodFlow);
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

/**
 * Monta o payload completo da carteira (assets processados + KPIs + targets +
 * meta) para um (userId, walletId). Fonte ÚNICA da verdade: tanto a rota
 * autenticada (getWalletData) quanto a rota pública (publicWalletController)
 * consomem daqui — os números da carteira pública são, por construção,
 * idênticos aos privados (a pública só projeta/mascara um subconjunto).
 */
export const buildWalletPayload = async (userId, walletId, _depth = 0) => {
    const { userAssets, activeAssets, closedAssets, targets } = await loadWalletState(userId, walletId);

    // Auto-Heal se não houver ativos mas houver transações (reconstrução forçada).
    if (activeAssets.length === 0) {
        const healed = await autoHealPositions(userId, walletId);
        if (healed) {
            // (6.2) Reprocessa com o estado curado, mas só até o limite de
            // profundidade — nunca recursa infinitamente.
            if (_depth < MAX_WALLET_HEAL_DEPTH) {
                return buildWalletPayload(userId, walletId, _depth + 1);
            }
            logger.warn(`buildWalletPayload: limite de auto-heal (${MAX_WALLET_HEAL_DEPTH}) atingido para ${userId}; renderizando estado atual.`);
        }
    }

    if (userAssets.length === 0) {
        return buildEmptyWalletResponse(targets);
    }

        const liveTickers = activeAssets.filter(a => a.type !== 'FIXED_INCOME' && a.type !== 'CASH').map(a => a.ticker);
        if (liveTickers.length > 0) {
            // Refresh em background: não bloqueia a resposta (usa cache atual). A
            // falha é logada em vez de silenciada — o card ainda renderiza.
            marketDataService.refreshQuotesBatch(liveTickers)
                .catch(err => logger.warn(`[Wallet] Refresh de cotações em background falhou: ${err.message}`));
        }

        const { assetMap, config, totalDividends, projectedMonthly, receivedByTicker, snapshots, riskSnapshots, treasuryPricing } =
            await fetchWalletMarketContext(userId, liveTickers, walletId, activeAssets);

        const usdRate = safeFloat(config?.dollar || 5.75);
        const usdChange = safeFloat(config?.dollarChange || 0);
        const currentCdi = (config?.cdi && config.cdi > 0) ? safeFloat(config.cdi) : ((config?.selic && config.selic > 0) ? safeFloat(config.selic) : DEFAULT_SELIC_FALLBACK);
        const macroRates = { cdiRate: currentCdi, selic: config?.selic, ipca: config?.ipca };

        const totalRealizedProfit = closedAssets.reduce((acc, curr) => {
            const mult = isDollarized(curr) ? usdRate : 1;
            const profitInBrl = safeMult((curr.realizedProfit || 0), mult);
            return safeAdd(acc, profitInBrl);
        }, 0);

        const brazilTodayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        const isTodayBusinessDay = isBusinessDay(new Date(brazilTodayStr + 'T00:00:00.000Z'));

        // Processa cada ativo e acumula os totais (mesma ordem/aritmética da versão monolítica).
        const assetCtx = { assetMap, usdRate, usdChange, macroRates, isTodayBusinessDay, treasuryPricing };
        const processedAssets = [];
        let totalEquity = 0;
        let totalInvested = 0;
        let totalDayVariation = 0;
        for (const asset of activeAssets) {
            const { processed, totalValueBr, totalCostBr, dayChangeValueBr } = processWalletAsset(asset, assetCtx);
            // Proventos recebidos (all-time, BRL) deste ativo — alimenta a
            // Rentabilidade total (preço + proventos) na Detalhamento por Classe,
            // distinta da Variação (só preço).
            processed.dividendsReceived = safeCurrency(receivedByTicker[asset.ticker] || 0);
            processedAssets.push(processed);
            totalEquity = safeAdd(totalEquity, totalValueBr);
            totalInvested = safeAdd(totalInvested, totalCostBr);
            totalDayVariation = safeAdd(totalDayVariation, dayChangeValueBr);
        }

        const currentUnrealized = safeSub(totalEquity, totalInvested);
        const totalCapitalGain = safeAdd(currentUnrealized, totalRealizedProfit);
        const totalResult = safeAdd(totalCapitalGain, totalDividends);

        const safeTotalEquity = safeCurrency(totalEquity);
        const safeTotalInvested = safeCurrency(totalInvested);
        const safeTotalResult = safeCurrency(totalResult);
        const safeTotalDayVariation = safeCurrency(totalDayVariation);

        let totalResultPercent = 0;
        if (safeTotalInvested > 0) {
            totalResultPercent = safeMult(safeDiv(safeTotalResult, safeTotalInvested), 100);
        }

        let dayVariationPercent = 0;
        if (safeTotalEquity > 0) {
            const denom = safeSub(safeTotalEquity, safeTotalDayVariation);
            if (denom !== 0) {
                dayVariationPercent = safeMult(safeDiv(safeTotalDayVariation, denom), 100);
            }
        }

        const { weightedRentability, dataQuality, sharpeRatio, sharpeConfidence, sharpeStandardError, sharpeSample, beta } =
            await computeWalletMetrics({
                userId, walletId, snapshots, riskSnapshots, safeTotalEquity, totalResultPercent, currentCdi, currentUsd: usdRate,
            });

        return {
            assets: processedAssets,
            kpis: {
                totalEquity: safeTotalEquity,
                totalInvested: safeTotalInvested,
                totalResult: safeTotalResult,
                totalResultPercent: totalResultPercent,
                dayVariation: safeTotalDayVariation,
                dayVariationPercent: dayVariationPercent,
                totalDividends: safeCurrency(totalDividends),
                projectedDividends: safeCurrency(projectedMonthly),
                weightedRentability: safeFloat(weightedRentability),
                dataQuality: dataQuality,
                // null preservado de propósito: safeFloat(null) viraria 0 e a UI
                // exibiria "sem risco" onde não houve medição.
                sharpeRatio: sharpeRatio === null ? null : safeFloat(sharpeRatio),
                // Acompanham o indicador para que a UI não transmita uma precisão
                // que a amostra não sustenta.
                sharpeConfidence,
                sharpeStandardError: sharpeStandardError === null ? null : safeFloat(sharpeStandardError),
                sharpeSample,
                beta: beta === null ? null : safeFloat(beta)
            },
            ...targets,
            meta: { usdRate, lastUpdate: new Date() }
        };
};

// GET /wallet — carteira ativa do usuário autenticado. Casca fina sobre
// buildWalletPayload (a matemática vive lá, compartilhada com a rota pública).
export const getWalletData = async (req, res, next) => {
    try {
        const payload = await buildWalletPayload(req.user.id, req.walletId);
        res.json(payload);
    } catch (error) {
        logger.error(`Erro ao processar carteira: ${error.message}`);
        next(error);
    }
};

// --- CORREÇÃO DE RENTABILIDADE (LIVE POINT + FILTRO AVANÇADO) ---
export const getWalletPerformance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });

        let history = await WalletSnapshot.find({
            user: userId,
            wallet: walletId,
            totalEquity: { $gt: 1 }
        }).sort({ date: 1 }).lean();
        
        if (history.length === 0) {
            return res.json([]);
        }

        // "Hoje" no fuso de São Paulo (mesma referência do KPI) — evita que o
        // relógio UTC do servidor anexe um ponto "do dia seguinte" e acumule um
        // dia extra de CDI no benchmark.
        const today = brazilToday();
        const todayStr = toDateKey(today);
        const lastSnapshot = history[history.length - 1];
        const lastSnapshotDate = toDateKey(brazilDateOnly(lastSnapshot.date));

        if (lastSnapshotDate !== todayStr) {
            const liveData = await calculateLiveKPIS(userId, config?.cdi || DEFAULT_SELIC_FALLBACK, walletId);

            if (liveData && liveData.totalEquity > 0) {
                // Mesma âncora do KPI (getWalletData): regra única compartilhada.
                const anchor = selectAnchorSnapshot([...history].reverse());

                // Fluxo de caixa desde o âncora (aportes/resgates) — Modified Dietz.
                const periodFlow = await computePendingFlowBRL({
                    userId,
                    walletId,
                    anchor,
                    currentUsd: config?.dollar || 5.75,
                });

                // Fonte única da cota live — idêntica ao KPI (weightedRentability).
                const liveQuotaPrice = computeLiveQuota(anchor, liveData.totalEquity, periodFlow);

                history.push({
                    date: today,
                    totalEquity: liveData.totalEquity,
                    totalInvested: liveData.totalInvested,
                    totalDividends: liveData.totalDividends,
                    quotaPrice: liveQuotaPrice,
                    isLive: true
                });
            }
        }

        const ibovHistory = await marketDataService.getBenchmarkHistory('^BVSP');
        const ibovMap = new Map();
        if (ibovHistory && Array.isArray(ibovHistory)) {
            ibovHistory.forEach(h => ibovMap.set(h.date, h.close || h.adjClose));
        }

        const startDateStr = snapshotDayKey(history[0]);
        let baseIbov = ibovMap.get(startDateStr);
        if (!baseIbov) {
             const fallback = ibovHistory?.find(h => h.date >= startDateStr);
             baseIbov = fallback ? (fallback.close || fallback.adjClose) : 120000;
        }
        // Último fechamento conhecido do índice, para dias sem cotação. Antes o
        // código caía no `baseIbov` (o fechamento do PRIMEIRO dia da série): além
        // de zerar o % daquele dia, virava a nova referência do passo seguinte e
        // a curva em R$ dava um salto artificial (fator = close/baseIbov).
        let lastKnownIbov = baseIbov;

        const currentRate = config?.cdi || DEFAULT_SELIC_FALLBACK;
        let accumulatedCDI = 1.0;
        let accumulatedIPCA = 1.0; // IPCA + 6%
        // (TZ) Ancora no DIA-CALENDÁRIO BR do snapshot, não em startOfDay(date). O
        // snapshot é gravado às 23:59 BRT (= 02:59 UTC do dia seguinte); startOfDay
        // num servidor UTC devolvia o dia SEGUINTE, e o countBusinessDays entre
        // snapshots perdia a sexta (o snapshot de sexta caía num "sábado"), fazendo
        // o CDI acumular 1 dia útil A MENOS que a carteira — que então "batia" o CDI
        // sendo 100% CDI (impossível). brazilDateOnly alinha benchmark e carteira.
        let previousDate = brazilDateOnly(history[0].date);

        // Taxas para IPCA+6%
        const ipcaRate = config?.ipca || 4.5;
        const realRate = 6.0;
        const totalIpcaRate = ipcaRate + realRate; // ex: 10.5% a.a.

        // Benchmarks cashflow-aware (modo R$): o capital cresce pelo índice e
        // recebe os MESMOS aportes/resgates nas datas reais — comparável à
        // carteira (que também inclui os aportes). Semente = invested inicial.
        let cdiVal = 0, ipcaVal = 0, ibovVal = 0;
        let prevInvested = history[0]?.totalInvested || 0;
        let prevIbovForVal = baseIbov;

        const result = history.map((point, index) => {
            const dateStr = snapshotDayKey(point);
            const currentDate = brazilDateOnly(point.date);

            const daysDelta = countBusinessDays(previousDate, currentDate);

            const periodFactorCDI = daysDelta > 0 ? Math.pow(getDailyFactorForDate(currentDate, currentRate), daysDelta) : 1;
            const periodFactorIPCA = daysDelta > 0 ? Math.pow(Math.pow(1 + (totalIpcaRate / 100), 1/252), daysDelta) : 1;
            accumulatedCDI *= periodFactorCDI;
            accumulatedIPCA *= periodFactorIPCA;
            previousDate = currentDate;

            // IBOV Acumulado
            let currentIbov = ibovMap.get(dateStr);
            if (point.isLive && !currentIbov) {
                currentIbov = config?.ibov;
            }
            // Dia sem cotação (feriado, dado faltante): repete o último fechamento
            // conhecido — o índice "anda de lado" em vez de saltar.
            if (!currentIbov) currentIbov = lastKnownIbov;
            if (currentIbov) lastKnownIbov = currentIbov;

            const ibovPercent = baseIbov && currentIbov ? ((currentIbov / baseIbov) - 1) * 100 : 0;
            const walletTWRR = point.quotaPrice ? ((point.quotaPrice/100)-1)*100 : 0;

            // --- Valores cashflow-aware dos benchmarks (modo R$) ---
            const periodFactorIbov = (prevIbovForVal > 0 && currentIbov) ? (currentIbov / prevIbovForVal) : 1;
            const flow = (point.totalInvested || 0) - prevInvested;
            if (index === 0) {
                cdiVal = ipcaVal = ibovVal = point.totalInvested || 0;
            } else {
                cdiVal = benchmarkStep(cdiVal, periodFactorCDI, flow);
                ipcaVal = benchmarkStep(ipcaVal, periodFactorIPCA, flow);
                ibovVal = benchmarkStep(ibovVal, periodFactorIbov, flow);
            }
            prevInvested = point.totalInvested || 0;
            if (currentIbov) prevIbovForVal = currentIbov;

            const walletROI = point.totalInvested > 0
                ? ((point.totalEquity - point.totalInvested + point.totalDividends) / point.totalInvested) * 100
                : 0;

            return {
                date: dateStr,
                wallet: walletTWRR,
                walletRoi: walletROI,
                equity: point.totalEquity ?? 0,
                invested: point.totalInvested ?? 0,
                cdi: (accumulatedCDI - 1) * 100,
                ipca: (accumulatedIPCA - 1) * 100,
                ibov: ibovPercent,
                cdiValue: safeCurrency(cdiVal),
                ipcaValue: safeCurrency(ipcaVal),
                ibovValue: safeCurrency(ibovVal),
            };
        });

        // (O forward-fill do Ibov % que existia aqui saiu: o carry-forward agora é
        // feito na fonte, sobre o FECHAMENTO do índice. Fazê-lo no percentual
        // final tratava "0%" como sinônimo de "sem dado" e apagava um dia em que
        // o índice genuinamente empatou com a base.)

        // Calcular Métricas Finais
        // Sharpe e Beta pela MESMA fonte do KPI (utils/walletRisk) e sobre a MESMA
        // série: janela rolante, corte no último evento de regime, espaçamento de
        // 1 pregão validado e ponto live fora. O histórico completo continua
        // alimentando o gráfico — só as métricas de risco usam a janela.
        // O índice é lido pelo dia-calendário BR: os snapshots fecham às 23:59 BRT
        // e a chave UTC crua apontaria para o pregão seguinte.
        const resolveIbovClose = (dayKey) => ibovMap.get(dayKey);
        const { sharpe, sample: sharpeSample, skippedGaps: sharpeSkippedGaps, confidence, standardError, regimeBreakAt } =
            computeQuotaSharpe(history, currentRate);
        const { beta, sample: betaSample } = computeQuotaBeta(history, resolveIbovClose);

        res.json({
            history: result,
            stats: {
                sharpe: sharpe === null ? null : safeFloat(sharpe),
                sharpeSample,
                sharpeSkippedGaps,
                sharpeConfidence: confidence,
                sharpeStandardError: standardError === null ? null : safeFloat(standardError),
                regimeBreakAt,
                beta: beta === null ? null : safeFloat(beta),
                betaSample
            }
        });
    } catch (error) {
        next(error);
    }
};

export const getWalletHistory = async (req, res, next) => {
    try {
        const snapshots = await WalletSnapshot.find({ user: req.user.id, wallet: req.walletId }).sort({ date: 1 });
        res.json(snapshots);
    } catch (error) {
        next(error);
    }
};

export const addAssetTransaction = async (req, res, next) => {
    const userId = req.user.id;
    const walletId = req.walletId;
    const { ticker, type, quantity, price, date, fixedIncomeRate, fixedIncomeIndex, fixedIncomeSpread, name, usSubType, currency, isReserve, maturityDate } = req.body;
    // `<input type=date>` envia YYYY-MM-DD. Parsing nativo interpreta isso como
    // meia-noite UTC e desloca para o dia anterior em Brasília; tratamos como dia
    // civil e ancoramos ao meio-dia UTC (parseCalendarDate).
    const txDate = date ? parseCalendarDate(date) : new Date();
    const transactionType = quantity >= 0 ? 'BUY' : 'SELL';
    let updatedAsset;
    try {
        if (!ticker || quantity === undefined || price === undefined) throw AppError.badRequest("Dados incompletos.");
        if (!txDate) throw AppError.badRequest("Data inválida.");
        const brazilTodayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        const transactionDayKey = toDateKey(txDate);
        if (date && transactionDayKey > brazilTodayKey) throw AppError.badRequest("Data futura não permitida.");
        await runTransaction(async (session) => {
            const newTx = new AssetTransaction({
                user: userId, wallet: walletId, ticker: ticker.toUpperCase(), type: transactionType,
                quantity: Math.abs(parseFloat(quantity)), price: Math.abs(parseFloat(price)),
                totalValue: Math.abs(parseFloat(quantity)) * Math.abs(parseFloat(price)),
                date: txDate, notes: name ? `Nome: ${name}` : ''
            });
            await newTx.save({ session });
            updatedAsset = await financialService.recalculatePosition(userId, ticker.toUpperCase(), type, session, currency, walletId);
            // Carimba a moeda NATIVA do lançamento. Só dá para fazer depois do
            // recálculo: é `recalculatePosition` que resolve a moeda autoritativa
            // (cadastro explícito > MarketAsset > BRL), e um ETF só se distingue
            // por ela (BOVA11 é R$, VOO é US$). Mesma sessão → atômico com o resto.
            if (updatedAsset) {
                const txCurrency = resolveAssetCurrency(updatedAsset);
                if (newTx.currency !== txCurrency) {
                    newTx.currency = txCurrency;
                    await newTx.save({ session });
                }
            }
            if (updatedAsset && (type === 'FIXED_INCOME' || type === 'CASH')) {
                if (fixedIncomeRate) updatedAsset.fixedIncomeRate = fixedIncomeRate;
                // Pós-fixados/indexados (Selic/CDI/IPCA): o rendimento é índice vivo +
                // spread, não a taxa cheia. Persiste índice+spread p/ accrual correto
                // (corrige o bug do Tesouro Selic render só o spread como prefixado).
                if (type === 'FIXED_INCOME') {
                    let idx = fixedIncomeIndex;
                    let spread = fixedIncomeSpread;
                    // Catálogo é a fonte autoritativa de índice E vencimento — busca
                    // uma vez quando falta qualquer um dos dois (evita 2 queries).
                    let bond = null;
                    if (!idx || (!maturityDate && !updatedAsset.maturityDate)) {
                        const safeTitle = String(ticker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        bond = await TreasuryBond.findOne({ title: new RegExp(`^${safeTitle}$`, 'i') }).session(session);
                    }
                    if (!idx && bond?.index) { idx = bond.index; if (spread == null) spread = bond.rate; }
                    if (idx === 'SELIC' || idx === 'CDI' || idx === 'IPCA') {
                        updatedAsset.fixedIncomeIndex = idx;
                        updatedAsset.fixedIncomeSpread = Number(spread) || 0;
                    } else if (idx === 'PRE') {
                        updatedAsset.fixedIncomeIndex = 'PRE';
                    }
                    // C2: vencimento — da UI (form) ou, quando ausente, do catálogo
                    // (string "dd/mm/aaaa"). Nunca reescreve um vencimento já salvo.
                    if (maturityDate) {
                        const md = new Date(maturityDate);
                        if (!isNaN(md.getTime())) updatedAsset.maturityDate = md;
                    } else if (!updatedAsset.maturityDate && bond?.maturityDate) {
                        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(bond.maturityDate).trim());
                        if (m) {
                            const parsed = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`);
                            if (!isNaN(parsed.getTime())) updatedAsset.maturityDate = parsed;
                        }
                    }
                }
                if (name) updatedAsset.name = name;
                // C1: CASH é reserva por natureza; FIXED_INCOME segue a escolha do
                // usuário ("Guardar como Reserva separada"). Só grava no primeiro
                // aporte (posição nova) ou quando o flag vem explícito — aportes
                // seguintes não devem silenciosamente reclassificar a posição.
                if (type === 'CASH') {
                    updatedAsset.isReserve = true;
                } else if (type === 'FIXED_INCOME' && isReserve !== undefined) {
                    updatedAsset.isReserve = !!isReserve;
                }
                if (transactionType === 'BUY' && (!updatedAsset.startDate || txDate < updatedAsset.startDate)) {
                    updatedAsset.startDate = txDate;
                }
                await updatedAsset.save({ session });
            }
            // Exterior: override manual do sub-tipo no cadastro. A auto-heurística
            // já rodou em recalculatePosition; aqui o usuário tem a última palavra.
            if (updatedAsset && type === 'STOCK_US' && usSubType) {
                updatedAsset.usSubType = usSubType;
                updatedAsset.usSubTypeManual = true;
                await updatedAsset.save({ session });
            }
        });
    } catch (error) {
        return next(error);
    }
    // Qualquer dia anterior ao dia-calendário atual exige reconstrução. A regra
    // anterior usava "agora - 24h" e podia não recalcular uma compra de ontem.
    if (toDateKey(txDate) < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())) {
        // Best-effort: a transação já foi persistida. Se o rebuild do histórico
        // falhar, logamos (sem silenciar) — o snapshot é corrigido no próximo
        // recálculo/job diário, mas a falha precisa ficar visível.
        try {
            await financialService.rebuildUserHistory(userId, walletId);
        } catch (err) {
            logger.warn(`[Wallet] Rebuild de histórico falhou após addAssetTransaction (user ${userId}): ${err.message}`);
        }
    }
    // Ingestão de proventos do ticker em background (não bloqueia a resposta).
    // Garante que compras novas já apareçam com proventos sem rodar o script.
    if (transactionType === 'BUY' && !['CRYPTO', 'FIXED_INCOME', 'CASH'].includes(type)) {
        financialService.syncDividends([{ ticker: ticker.toUpperCase(), type }])
            .catch(err => logger.warn(`[Wallet] Sync de proventos em background falhou para ${ticker}: ${err.message}`));
    }
    res.status(201).json({ message: "Transação registrada.", asset: updatedAsset });
};

export const updateAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { tags, name, usSubType, type, fixedIncomeRate, fixedIncomeIndex, fixedIncomeSpread, maturityDate, isReserve } = req.body;
        const userId = req.user.id;

        // wallet no filtro evita que um id de outra carteira do mesmo usuário
        // (ou de outro usuário) resolva aqui — posse é sempre {user, wallet, _id}.
        const asset = await UserAsset.findOne({ _id: id, user: userId, wallet: req.walletId });
        if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

        if (tags !== undefined) asset.tags = tags;
        // Renomear cofrinho (Reserva/Caixa) ou título de Renda Fixa.
        if (name !== undefined) asset.name = String(name).trim();
        // Override manual do sub-tipo de Exterior — só faz sentido para STOCK_US.
        // Marca usSubTypeManual para que a auto-heurística não sobrescreva depois.
        if (usSubType !== undefined && asset.type === 'STOCK_US') {
            asset.usSubType = usSubType;
            asset.usSubTypeManual = true;
        }

        // Reclassificar um Caixa/Reserva (CASH) em Renda Fixa (FIXED_INCOME) —
        // para posições cadastradas como "cofrinho" que na verdade são um título.
        // Só nessa direção: CASH guarda price=1, então o valor principal
        // (quantity×price = quantity) é idêntico à base do accrual de RF — a
        // reclassificação preserva o patrimônio e só troca a curva de rendimento.
        let reclassified = false;
        if (type === 'FIXED_INCOME' && asset.type === 'CASH') {
            asset.type = 'FIXED_INCOME';
            if (fixedIncomeRate !== undefined) asset.fixedIncomeRate = fixedIncomeRate;
            if (fixedIncomeIndex === 'SELIC' || fixedIncomeIndex === 'CDI' || fixedIncomeIndex === 'IPCA') {
                asset.fixedIncomeIndex = fixedIncomeIndex;
                asset.fixedIncomeSpread = Number(fixedIncomeSpread) || 0;
            } else if (fixedIncomeIndex === 'PRE') {
                asset.fixedIncomeIndex = 'PRE';
            }
            if (maturityDate) {
                const md = new Date(maturityDate);
                if (!isNaN(md.getTime())) asset.maturityDate = md;
            }
            // Ao virar título, passa a ser investimento por padrão (entra no donut
            // e no grupo "Renda Fixa"), salvo se o usuário pedir p/ manter na reserva.
            asset.isReserve = isReserve === undefined ? false : !!isReserve;
            reclassified = true;
        } else if (isReserve !== undefined && (asset.type === 'FIXED_INCOME' || asset.type === 'CASH')) {
            // Alternar "Reserva separada" sem mudar a classe.
            asset.isReserve = !!isReserve;
        }

        await asset.save();

        // Reclassificar muda a curva de rendimento (100% CDI → taxa do título),
        // inclusive retroativamente: reconstrói o histórico p/ os snapshots baterem.
        if (reclassified) {
            try {
                await financialService.rebuildUserHistory(userId, req.walletId);
            } catch (e) {
                logger.warn(`[Wallet] Rebuild pós-reclassificação falhou (user ${userId}): ${e.message}`);
            }
        }
        res.json({ message: reclassified ? "Ativo convertido em Renda Fixa." : "Ativo atualizado.", asset });
    } catch (error) {
        next(error);
    }
};

export const removeAsset = async (req, res, next) => {
    const userId = req.user.id;
    const walletId = req.walletId;
    const assetId = req.params.id;
    try {
        await runTransaction(async (session) => {
            const asset = await UserAsset.findOne({ _id: assetId, user: userId, wallet: walletId });
            if (!asset) throw txError(404, "Ativo não encontrado");
            await AssetTransaction.deleteMany({ user: userId, wallet: walletId, ticker: asset.ticker }).session(session);
            await UserAsset.deleteOne({ _id: assetId }).session(session);
        });
    } catch (error) {
        if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
        return next(error);
    }
    // Best-effort pós-commit (ver removeAsset/addAssetTransaction): loga em vez de silenciar.
    try {
        await financialService.rebuildUserHistory(userId, walletId);
    } catch (e) {
        logger.warn(`[Wallet] Rebuild de histórico falhou após remover ativo (user ${userId}): ${e.message}`);
    }
    res.json({ message: "Ativo removido." });
};

// Wipe completo da carteira ATIVA (ativos + lançamentos + histórico). Fase 2:
// escopado por wallet — o equivalente para conta inteira/todas as carteiras
// não existe mais aqui; a exclusão de UMA carteira específica vive em
// DELETE /api/wallets/:walletId (walletsController.js).
export const resetWallet = async (req, res, next) => {
    const userId = req.user.id;
    const walletId = req.walletId;
    try {
        await runTransaction(async (session) => {
            await UserAsset.deleteMany({ user: userId, wallet: walletId }).session(session);
            await AssetTransaction.deleteMany({ user: userId, wallet: walletId }).session(session);
            await WalletSnapshot.deleteMany({ user: userId, wallet: walletId }).session(session);
        });
    } catch (error) {
        return next(error);
    }
    res.json({ message: "Carteira resetada." });
};

// PUT /wallet/targets — salva a carteira ideal (alocação-alvo + reserva) DESTA
// carteira (Fase 2: cada carteira tem sua própria, não mais uma por conta).
export const updateWalletTargets = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const { targetAllocation, targetReserve, targetMonthlyDividendIncome, targetSubAllocation } = req.body;

        const update = {};
        if (targetAllocation !== undefined) {
            update.targetAllocation = {
                STOCK: safeFloat(targetAllocation.STOCK || 0),
                FII: safeFloat(targetAllocation.FII || 0),
                STOCK_US: safeFloat(targetAllocation.STOCK_US || 0),
                ETF: safeFloat(targetAllocation.ETF || 0),
                CRYPTO: safeFloat(targetAllocation.CRYPTO || 0),
                FIXED_INCOME: safeFloat(targetAllocation.FIXED_INCOME || 0),
            };
        }
        if (targetReserve !== undefined) {
            update.targetReserve = Math.max(0, safeFloat(targetReserve));
        }
        if (targetMonthlyDividendIncome !== undefined) {
            update.targetMonthlyDividendIncome = Math.max(0, safeFloat(targetMonthlyDividendIncome));
        }
        if (targetSubAllocation !== undefined) {
            const st = targetSubAllocation.STOCK || {};
            const fi = targetSubAllocation.FIXED_INCOME || {};
            const us = targetSubAllocation.STOCK_US || {};
            update.targetSubAllocation = {
                STOCK: {
                    STOCK: safeFloat(st.STOCK || 0),
                    ETF: safeFloat(st.ETF || 0),
                },
                FIXED_INCOME: {
                    IPCA: safeFloat(fi.IPCA || 0),
                    POS: safeFloat(fi.POS || 0),
                    PRE: safeFloat(fi.PRE || 0),
                },
                STOCK_US: {
                    STOCK: safeFloat(us.STOCK || 0),
                    REIT: safeFloat(us.REIT || 0),
                    ETF: safeFloat(us.ETF || 0),
                    DOLLAR: safeFloat(us.DOLLAR || 0),
                },
            };
        }

        // { _id, user } no filtro: defesa em profundidade além do já validado por
        // resolveWallet (nunca reconfia num walletId cru sem o par correto de user).
        const updated = await Wallet.findOneAndUpdate({ _id: walletId, user: userId }, { $set: update }, { new: true })
            .select('targetAllocation targetReserve targetMonthlyDividendIncome targetSubAllocation').lean();

        res.json({
            message: 'Carteira ideal atualizada.',
            targetAllocation: updated?.targetAllocation,
            targetReserve: updated?.targetReserve,
            targetMonthlyDividendIncome: updated?.targetMonthlyDividendIncome,
            targetSubAllocation: updated?.targetSubAllocation,
        });
    } catch (error) {
        next(error);
    }
};

export const searchAssets = async (req, res, next) => {
    try {
        const { q, type } = req.query;
        if (!q || q.length < 2) return res.json([]);

        const marketResults = await MarketAsset.find({
            $or: [{ ticker: { $regex: `^${q}`, $options: 'i' } }, { name: { $regex: q, $options: 'i' } }],
            isIgnored: { $ne: true }
        }).sort({ liquidity: -1 }).limit(8).select('ticker name type lastPrice rate index');

        if (type === 'FIXED_INCOME') {
            const bonds = await TreasuryBond.find({
                title: { $regex: q, $options: 'i' }
            }).sort({ type: 1, maturityDate: 1 }).limit(10);

            const formattedBonds = bonds.map(b => ({
                ticker: b.title,
                name: b.title,
                type: 'FIXED_INCOME',
                lastPrice: b.unitPrice,
                rate: b.rate,
                index: b.index,
                maturityDate: b.maturityDate,
                isTreasury: true
            }));

            return res.json([...marketResults, ...formattedBonds]);
        }

        res.json(marketResults);
    } catch (error) { next(error); }
};

export const getAssetTransactions = async (req, res, next) => {
    try {
        const { ticker } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const query = { user: req.user.id, wallet: req.walletId, ticker: ticker.toUpperCase() };
        const transactions = await AssetTransaction.find(query).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
        const total = await AssetTransaction.countDocuments(query);
        // Mesma resolução do extrato global: a moeda acompanha o lançamento, para o
        // cliente não precisar reimplementar a regra de dolarização. A posição só é
        // buscada se houver lançamento legado sem moeda gravada (ver getCashFlow).
        const asset = transactions.some(needsCurrencyFallback)
            ? await UserAsset.findOne(query).select('ticker type currency').lean()
            : null;
        res.json({
            transactions: transactions.map(t => ({ ...t.toObject(), currency: resolveTransactionCurrency(t, asset) })),
            pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit), hasMore: page * limit < total },
        });
    } catch (error) { next(error); }
};

export const deleteTransaction = async (req, res, next) => {
    const userId = req.user.id;
    const walletId = req.walletId;
    let txTicker;
    try {
        await runTransaction(async (session) => {
            const tx = await AssetTransaction.findOneAndDelete({ _id: req.params.id, user: userId, wallet: walletId }, { session });
            if (!tx) throw txError(404, "Transação não encontrada");
            txTicker = tx.ticker;
            // Recalcula a posição na MESMA transação: se o recálculo falhar (ex.: saldo
            // insuficiente), o delete é revertido — sem estado financeiro inconsistente.
            await financialService.recalculatePosition(userId, tx.ticker, null, session, null, walletId);
        });
    } catch (error) {
        if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
        return next(error);
    }
    // Best-effort pós-commit (ver acima): loga em vez de silenciar.
    try {
        await financialService.rebuildUserHistory(userId, walletId);
    } catch (e) {
        logger.warn(`[Wallet] Rebuild de histórico falhou após remover transação (user ${userId}): ${e.message}`);
    }
    res.json({ message: "Transação removida." });
};

// Throttle do self-heal de dividendos (1h por usuário) — evita re-scraping a
// cada poll do Cofre enquanto os dados ainda estão zerados.
const DIVIDEND_HEAL_TTL = 60 * 60 * 1000;
const dividendHealAt = new Map();

// (F9) Expurgo oportunístico: sem isto o Map cresce 1 entrada por usuário para
// sempre (vazamento lento). Remove marcas de heal já expiradas quando o Map
// passa de um teto — barato e limita o uso de memória do processo.
const DIVIDEND_HEAL_MAX = 50_000;
const pruneDividendHeal = () => {
    if (dividendHealAt.size < DIVIDEND_HEAL_MAX) return;
    const cutoff = Date.now() - DIVIDEND_HEAL_TTL;
    for (const [uid, ts] of dividendHealAt) if (ts < cutoff) dividendHealAt.delete(uid);
};

export const getWalletDividends = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        // Meta de renda passiva é por carteira (Fase 2) — busca dedicada em Wallet,
        // em paralelo com o cálculo de proventos.
        const [data, walletDoc] = await Promise.all([
            financialService.calculateUserDividends(userId, walletId),
            Wallet.findById(walletId).select('targetMonthlyDividendIncome').lean(),
        ]);
        const history = Array.from(data.dividendMap.entries()).map(([month, val]) => ({ month, value: val.total, breakdown: val.breakdown })).sort((a, b) => a.month.localeCompare(b.month));

        // Meta é MENSAL → `current` precisa ser uma grandeza mensal, nunca o
        // acumulado vitalício (`totalAllTime`), senão a barra estoura em 100%.
        // Espelha o que o card exibe (displayDividends): soma das provisões do
        // mês corrente quando houver, senão o fluxo mensal projetado.
        const target = walletDoc?.targetMonthlyDividendIncome || 0;
        const provisionedSum = (data.provisioned || []).reduce((acc, p) => safeAdd(acc, p.amount || 0), 0);
        const current = provisionedSum > 0 ? provisionedSum : data.projectedMonthly;
        const goal = {
            target,
            current,
            progressPercent: target > 0 ? Math.min(100, safeDiv(safeMult(current, 100), target)) : null,
        };

        res.json({
            history,
            provisioned: data.provisioned,
            totalAllTime: data.totalAllTime,
            projectedMonthly: data.projectedMonthly,
            yieldOnCost: data.yieldOnCost,
            goal,
        });

        // Self-heal: se o usuário tem ativos pagadores mas TUDO está zerado, é
        // sinal de que faltou sincronizar proventos e/ou popular dy. Dispara em
        // background (sem travar a resposta) sincronização de DividendEvent +
        // refresh de fundamentos (dy/preço). Throttle por usuário evita repetição.
        const isEmpty = data.totalAllTime === 0 && data.projectedMonthly === 0 && (data.provisioned?.length || 0) === 0;
        if (isEmpty) {
            const last = dividendHealAt.get(userId) || 0;
            if (Date.now() - last > DIVIDEND_HEAL_TTL) {
                pruneDividendHeal();
                dividendHealAt.set(userId, Date.now());
                (async () => {
                    try {
                        const eligible = await UserAsset.find({ user: userId, wallet: walletId, quantity: { $gt: QUANTITY_EPSILON } }).select('ticker type').lean();
                        const payers = eligible.filter(a => !['CRYPTO', 'CASH', 'FIXED_INCOME'].includes(a.type));
                        if (payers.length === 0) return;
                        await marketDataService.refreshFundamentals(payers.map(a => a.ticker));
                        await financialService.syncDividends(payers.map(a => ({ ticker: a.ticker, type: a.type })));
                        logger.info(`[Dividends] Self-heal concluído p/ ${userId} (${payers.length} ativos).`);
                    } catch (e) {
                        logger.warn(`[Dividends] Self-heal falhou p/ ${userId}: ${e.message}`);
                    }
                })();
            }
        }
    } catch (error) { next(error); }
};

export const getCashFlow = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, filterType } = req.query;
        const userId = req.user.id;
        const walletId = req.walletId;

        // Cofrinhos (Reserva/Caixa) desta carteira: cada um é um UserAsset type=CASH
        // com ticker próprio. Mapa ticker→nome para rotular o extrato e set para filtrar.
        const cashAssets = await UserAsset.find({ user: userId, wallet: walletId, type: 'CASH' }).select('ticker name type currency').lean();
        const cashTickers = cashAssets.map(a => a.ticker);
        const cashNameByTicker = new Map(cashAssets.map(a => [a.ticker, a.name || 'Reserva']));

        const query = { user: userId, wallet: walletId };
        if (filterType === 'CASH') query.ticker = { $in: cashTickers };
        else if (filterType === 'TRADE') query.ticker = { $nin: cashTickers };
        const transactions = await AssetTransaction.find(query).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
        const total = await AssetTransaction.countDocuments(query);

        // Moeda: `price`/`totalValue` são gravados na moeda NATIVA do ativo (US$ para
        // STOCK_US/CRYPTO), então sem isso o extrato exibia US$ 400 como "R$ 400,00".
        // O campo é gravado na criação desde a migração, e a busca de posições só
        // acontece se ESTA PÁGINA tiver lançamento legado sem moeda — com a base
        // migrada, custo zero. O escopo é limitado aos tickers da página (≤ limit),
        // então nem uma carteira gigante amplia a consulta. Continua auto-curável:
        // se dado legado reaparecer (restore de backup antigo), o fallback volta
        // sozinho sem precisar rodar o backfill de novo.
        const legacyTickers = [...new Set(transactions.filter(needsCurrencyFallback).map(t => t.ticker))];
        const assetByTicker = new Map(cashAssets.map(a => [a.ticker, a]));
        if (legacyTickers.length > 0) {
            const legacyAssets = await UserAsset.find({
                user: userId, wallet: walletId, ticker: { $in: legacyTickers },
            }).select('ticker type currency').lean();
            legacyAssets.forEach(a => assetByTicker.set(a.ticker, a));
        }

        res.json({
            transactions: transactions.map(t => {
                const isCashOp = cashNameByTicker.has(t.ticker);
                return {
                    ...t.toObject(),
                    isCashOp,
                    cashName: isCashOp ? cashNameByTicker.get(t.ticker) : undefined,
                    // Gravada > posição atual > BRL.
                    currency: resolveTransactionCurrency(t, assetByTicker.get(t.ticker)),
                };
            }),
            pagination: { total, hasMore: page * limit < total }
        });
    } catch (error) { next(error); }
};

export const runCorporateAction = async (req, res, next) => {
    try {
        const { ticker, type } = req.body;
        res.json({ message: "Comando recebido.", details: { updates: 0 } });
    } catch (error) { next(error); }
};

export const fixWalletSnapshots = async (req, res, next) => {
    try {
        const deletedCount = await WalletSnapshot.deleteMany({
            $or: [{ quotaPrice: { $lte: 0.1 } }, { quotaPrice: { $gte: 1000000 } }]
        });
        
        // Fase 2: agrupa por CARTEIRA (não mais por usuário) — cada carteira tem
        // sua própria cadeia de cotas/TWRR independente.
        const wallets = await WalletSnapshot.distinct('wallet');
        let resetDeletions = 0;

        for (const walletId of wallets) {
            const snaps = await WalletSnapshot.find({ wallet: walletId }).sort({ date: 1 });
            const toDelete = [];
            for (let i = 1; i < snaps.length; i++) {
                const prev = snaps[i-1];
                const curr = snaps[i];
                if (Math.abs(curr.quotaPrice - 100) < 0.01 && Math.abs(prev.quotaPrice - 100) > 5) {
                    toDelete.push(curr._id);
                }
            }
            if (toDelete.length > 0) {
                await WalletSnapshot.deleteMany({ _id: { $in: toDelete } });
                resetDeletions += toDelete.length;
            }
        }

        res.json({ 
            message: "Limpeza de snapshots concluída.", 
            deletedZeros: deletedCount.deletedCount,
            deletedResets: resetDeletions
        });
    } catch (error) {
        next(error);
    }
};

export const getSnapshotHealth = async (req, res, next) => {
    try {
        const today = startOfDay(new Date());

        // Fase 2: cobertura esperada é 1 snapshot/dia por CARTEIRA (não por usuário).
        const totalWallets = await Wallet.countDocuments({});
        const snapshotsToday = await WalletSnapshot.countDocuments({ date: { $gte: today } });
        const lastRun = await WalletSnapshot.findOne().sort({ createdAt: -1 }).select('createdAt');

        res.json({
            totalWallets,
            snapshotsToday,
            coverage: totalWallets > 0 ? ((snapshotsToday / totalWallets) * 100).toFixed(1) + '%' : '0%',
            lastRun: lastRun?.createdAt,
            status: snapshotsToday > (totalWallets * 0.9) ? 'HEALTHY' : 'WARNING'
        });
    } catch (error) {
        next(error);
    }
};

// NOVO: Ação Manual de Snapshot (Admin)
export const forceSnapshot = async (req, res, next) => {
    try {
        const { force } = req.body;
        // Chama a função isolada do scheduler
        const result = await runDailySnapshot(!!force);
        
        if (result.status === 'ERROR') throw new Error(result.error);
        if (result.status === 'SKIPPED') {
            return res.status(200).json({ message: "Snapshot ignorado (Feriado ou Fim de semana). Use force=true para obrigar." });
        }
        
        res.json({ message: "Snapshot executado com sucesso.", stats: result.stats });
    } catch (error) {
        next(error);
    }
};
