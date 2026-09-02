
import { runTransaction, txError } from '../utils/dbTransaction.js';
import Wallet from '../models/Wallet.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import MarketAsset from '../models/MarketAsset.js';
import TreasuryBond from '../models/TreasuryBond.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import { safeFloat, safeCurrency, safeAdd, safeSub, safeMult, safeDiv, calculatePercent, safeValue, safePrice, safeQuantity, percentOf, reconcileRoundedParts, QUANTITY_EPSILON, selectAnchorSnapshot, computeLiveQuota, benchmarkStep } from '../utils/mathUtils.js';
import { computeQuotaSharpe, computeQuotaBeta, snapshotDayKey, SHARPE_WINDOW_SNAPSHOTS } from '../utils/walletRisk.js';
import { brazilDateKey, countBusinessDays, isBusinessDay, toDateKey, startOfDay, parseCalendarDate } from '../utils/dateUtils.js';
import { assetDailyFactor, valueFixedIncomeAsset, PRICING_SOURCE, brazilToday, brazilDateOnly, isMatured } from '../utils/fixedIncome.js';
import { resolveFixedIncomeIndexing } from '../utils/fixedIncomeIndexing.js';
import { escapeRegex } from '../utils/regexEscape.js';
import { loadTreasuryPricing, EMPTY_TREASURY_PRICING } from '../services/treasuryPriceService.js';
import { isDollarized, resolveAssetCurrency, resolveTransactionCurrency, needsCurrencyFallback } from '../utils/assetCurrency.js';
import { positionCostBRL, positionRealizedProfitBRL } from '../utils/fxRate.js';
import { sumTransactionFlowBRL, transactionsAfterSnapshotFilter } from '../utils/walletSnapshot.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { loadClosesForDay } from '../utils/dayCloses.js';
import { DAY_CHANGE_REASON } from '../utils/dayChangeReason.js';
import { createSettledReader } from '../utils/settledReader.js';
import { recordError } from '../services/errorLogService.js';
import { loadCdiCurve, earliestFixedIncomeLotDate } from '../utils/cdiCurve.js';
import { allocationBucket, resolveAllocationClass } from '../utils/assetAllocation.js';
import { cashFlowTickerCondition } from '../utils/cashFlowFilter.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { cdiAnnualRateForYear, DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';
import { runDailySnapshot } from '../services/schedulerService.js'; // Importado
import {
    boundedPointLimit,
    boundedPageLimit,
    DEFAULT_HISTORY_POINTS,
    DEFAULT_PERFORMANCE_POINTS,
    downsampleTimeSeries,
} from '../utils/timeSeriesDownsample.js';

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
    const cdiCurve = await loadCdiCurve({
        since: earliestFixedIncomeLotDate(activeAssets),
        currentRate: currentCdi,
    });

    for (const asset of activeAssets) {
        const multiplier = isDollarized(asset) ? usdRate : 1;

        let val;
        if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
            // Fonte única de valorização (idêntica ao getWalletData) — antes este
            // caminho ignorava o rendimento (val = qty), divergindo do KPI.
            val = valueFixedIncomeAsset(asset, {
                cdiRate: currentCdi, selic, ipca, calcDate, cdiCurve,
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
            dayVariation: 0, dayVariationPercent: 0, dayAnchorDate: null, dayDividends: 0,
            totalDividends: 0, projectedDividends: 0,
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

/**
 * Dia-âncora da Variação Hoje: o último snapshot ANTERIOR a hoje.
 *
 * Regra ÚNICA, compartilhada por quem mede a variação (o card), quem recorta os
 * proventos da mesma janela e o TWRR — os três têm de concordar sobre o que
 * "hoje" está sendo comparado, senão a tela exibe um card, um gráfico e uma cota
 * discordando sobre o mesmo dia.
 *
 * Um snapshot do PRÓPRIO dia não serve: ele já é "hoje", e medir contra ele daria
 * zero. Devolve `null` quando não há snapshot anterior (carteira nova).
 */
const resolveAnchorDayKey = (snapshots, todayKey) => {
    const anchor = selectAnchorSnapshot(
        (snapshots || []).filter((s) => (s.dayKey || snapshotDayKey(s)) < todayKey)
    );
    return anchor ? (anchor.dayKey || snapshotDayKey(anchor)) : null;
};

const fetchWalletMarketContext = async (userId, liveTickers, walletId, activeAssets = []) => {
    const todayKey = toDateKey(brazilToday());
    // Os snapshots definem o dia-âncora, e o accrual precisa dele para recortar a
    // janela de proventos. Em vez de serializar as duas coisas (uma ida a mais ao
    // banco antes de tudo), o accrual ENCADEIA nesta promessa e as outras cinco
    // seguem em paralelo: só o accrual espera, e ele não é o caminho crítico.
    //
    // `.exec()` NÃO é decoração: sem ele, `find().lean()` devolve uma QUERY do
    // Mongoose, não uma Promise. Query executa no primeiro `.then()` e rejeita no
    // segundo ("Query was already executed") — e consumimos esta duas vezes (o
    // encadeamento do accrual e o `allSettled` abaixo). O `allSettled` engole a
    // rejeição, `snapshots` chega vazio, e a carteira inteira degrada em silêncio:
    // sem snapshot não há âncora de TWRR (a Rentabilidade Real vira ROI simples e
    // o selo cai para "Estimado") nem dia-âncora para a Variação Hoje.
    const snapshotsPromise = WalletSnapshot.find({ user: userId, wallet: walletId })
        .sort({ date: -1 }).limit(30).lean().exec();

    const [assetMapR, configR, dividendsR, accruedR, snapshotsR, riskSnapshotsR, treasuryR] = await Promise.allSettled([
        marketDataService.getMarketDataMap(liveTickers),
        SystemConfig.findOne({ key: 'MACRO_INDICATORS' }),
        financialService.calculateUserDividends(userId, walletId),
        // Proventos acumulados do KPI: MESMA definição que o snapshot diário grava
        // (soma por EX-DATE, com a quantidade da época). Antes o card lia
        // `totalAllTime`, que credita na DATA DE PAGAMENTO — e entre o dia-ex e o
        // pagamento o preço do ativo já caiu sem a renda ter entrado, exibindo um
        // prejuízo inexistente em `totalResult`. Era a mesma fuga que o TWRR já
        // havia fechado, e deixava o card divergindo do próprio gráfico patrimonial
        // (carteira real, 29/08/2026: card R$ 5,71 × snapshot R$ 7,87).
        //
        // `sinceDayKey` abre o recorte da MESMA janela que a Variação Hoje mede —
        // é ele que explica a queda do dia-ex no detalhamento do dia.
        snapshotsPromise.then((snaps) => financialService.accrueDividendsByTicker(
            userId, walletId, todayKey, { sinceDayKey: resolveAnchorDayKey(snaps, todayKey) },
        )),
        snapshotsPromise,
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

    // Degradação graciosa REGISTRADA. Cada uma das sete buscas acima tem um padrão
    // de fallback — está certo, a carteira precisa renderizar mesmo se os proventos
    // caírem. O que estava errado era o silêncio: qualquer uma podia falhar e o
    // usuário só via números piores, para sempre, sem sinal nenhum em lugar nenhum.
    //
    // Aconteceu: uma promessa consumida duas vezes derrubou `snapshots`, e com ela o
    // TWRR (Rentabilidade Real virou ROI simples) e o dia-âncora da Variação Hoje. O
    // único sintoma visível foi o selo do card trocando "Auditado" por "Estimado" —
    // achado no olho, não pelo log nem pelos testes.
    const settled = createSettledReader();

    const assetMap = settled.or(assetMapR, new Map(), 'quotes');
    const config = settled.or(configR, null, 'macro');
    const { totalAllTime = 0, projectedMonthly = 0, receivedByTicker: paidByTicker = {} } =
        settled.or(dividendsR, {}, 'dividends');
    // Fail-open para a definição ANTIGA (caixa) se o accrual cair: um número um pouco
    // defasado é melhor que zerar os proventos do card. Nunca o contrário — o accrual
    // é a definição correta, e é dele que o snapshot vive.
    const { total: accruedTotal, byTicker: accruedByTicker, sinceTotal, sinceByTicker } =
        settled.or(accruedR, { total: null, byTicker: null }, 'dividendAccrual');
    const totalDividends = accruedTotal ?? totalAllTime;
    const receivedByTicker = accruedByTicker ?? paidByTicker;
    // Proventos da janela do dia. Sem fail-open: não há definição antiga para cair,
    // e inventar um número aqui poria uma nota falsa no detalhamento.
    const dayDividendsTotal = sinceTotal ?? 0;
    const dayDividendsByTicker = sinceByTicker ?? {};
    const snapshots = settled.or(snapshotsR, [], 'snapshots');
    const riskSnapshots = settled.or(riskSnapshotsR, [], 'riskSnapshots');
    // Falha ao carregar PU não derruba a carteira: a RF volta para o accrual.
    const treasuryPricing = settled.or(treasuryR, EMPTY_TREASURY_PRICING, 'treasuryPricing');

    if (settled.failures.length > 0) {
        // UMA linha por requisição, nomeando o que caiu. Sete linhas separadas
        // inundariam o log justamente quando o banco inteiro está fora — que é
        // quando ele mais precisa ser legível.
        //
        // Ids vão como METADADO estruturado, nunca interpolados na mensagem
        // (mesma regra do access log: entrada em linha de log permite forjar linha).
        logger.warn('[Wallet] Payload montado com dados incompletos', {
            userId: String(userId),
            walletId: walletId ? String(walletId) : null,
            failed: settled.failed(),
            errors: settled.failures,
        });

        // Log não basta: o dono não usa Sentry e não lê `combined.log` todo dia —
        // aviso tem que ser VISUAL. Registrado aqui, a sentinela horária conta as
        // ocorrências e a aba Saúde do Admin mostra "Carteiras com dados
        // incompletos", com quais buscas caíram.
        //
        // `code` leva as buscas que falharam: o fingerprint do ErrorLog é
        // origin+source+code+mensagem normalizada, então cada combinação vira UM
        // documento com contador — "snapshots" e "treasuryPricing" são problemas
        // diferentes e merecem linhas diferentes. Sem await: registrar não pode
        // atrasar a carteira, e `recordError` já engole o próprio erro (nunca
        // lança) e desiste em silêncio se o banco estiver fora.
        recordError({
            origin: 'HTTP',
            source: 'wallet.payload',
            code: settled.failed(),
            message: settled.failures.map((f) => `${f.source}: ${f.error}`).join(' | '),
        }).catch(() => {});
    }

    return {
        assetMap, config, totalDividends, projectedMonthly, receivedByTicker,
        dayDividendsTotal, dayDividendsByTicker, snapshots, riskSnapshots, treasuryPricing,
    };
};

/**
 * O dia BR de um lote. Data "pura" (meia-noite UTC, como vem de um input
 * YYYY-MM-DD) é lida como está; instante com hora é convertido para o fuso de
 * São Paulo.
 */
const lotDayStr = (d) => {
    const o = new Date(d);
    if (o.getUTCHours() === 0 && o.getUTCMinutes() === 0 && o.getUTCSeconds() === 0) {
        return o.toISOString().split('T')[0];
    }
    return brazilDateKey(o);
};

/**
 * TODOS os lotes da posição são do dia `dayKey`? É a guarda que impede uma compra
 * de hoje de exibir a variação do pregão inteiro (a posição não existia na
 * abertura) — e agora a que garante que ela ancore no CUSTO, não no candle.
 *
 * O dia vem do fuso BR (`todayKey`), nunca de `toDateKey(new Date())`: aquele é
 * UTC, e das 21h à meia-noite de Brasília já aponta para o dia seguinte. A guarda
 * ficava morta justamente nas três horas em que o usuário confere a carteira
 * depois do pregão.
 */
const isBoughtOnDay = (asset, dayKey) =>
    Array.isArray(asset.taxLots) && asset.taxLots.length > 0
    && asset.taxLots.every((lot) => lotDayStr(lot.date) === dayKey);

// Processa um único ativo: resolve preço/variação e devolve o card pronto +
// as contribuições para os totais da carteira. Aritmética idêntica à original.
//
// ÂNCORA DO DIA (`anchorDayKey`/`anchorCloses`/`anchorUsdRate`): o "início do dia"
// de cada posição é o MESMO dado que o snapshot-âncora usou para gravar o
// patrimônio daquele dia — fechamento do candle e câmbio do dia-âncora. É isso
// que faz valer a identidade
//
//     patrimônio do último snapshot + Variação Hoje === patrimônio de hoje
//
// Antes cada ponta lia uma fonte: o snapshot marcava pelo candle gravado e o card
// reconstruía o início do dia por `preço ÷ (1 + change do provedor)`. As duas só
// coincidem quando o provedor não mexe na referência — e ele mexe. Em 01/09/2026,
// seis FIIs ficaram ex-provento e o Yahoo baixou `regularMarketPreviousClose` pelo
// valor do provento (TRXF11: candle 79,30 × prevClose 78,37 = exatamente os R$ 0,93
// que o fundo distribui todo mês), enquanto o candle guardava o fechamento cheio.
// Resultado: a queda do dia-ex entrava no patrimônio e sumia da variação, e a tela
// exibia "+R$ 7,97 hoje" com o patrimônio R$ 8,14 MENOR que o de ontem.
//
// Cripto sofria do mesmo mal por outro caminho: negocia 24h, e o `previousClose` do
// provedor corta o dia numa hora e o candle gravado noutra.
//
// Sem âncora (carteira nova, ativo sem candle no dia) cai no caminho antigo: um
// número reconstruído é melhor que zerar a variação da carteira inteira.
export const processWalletAsset = (asset, { assetMap, usdRate, usdChange, macroRates, isTodayBusinessDay, treasuryPricing = EMPTY_TREASURY_PRICING, todayKey = brazilDateKey(), anchorDayKey = null, anchorCloses = null, anchorUsdRate = 0 }) => {
    let currentPrice = 0;
    let dayChangePct = 0;
    // Valor da posição na MOEDA NATIVA no dia-âncora. `null` = sem âncora
    // utilizável; o cálculo cai na reconstrução por percentual (comportamento
    // anterior). Quando presente, é ele — e não `dayChangePct` — quem define o
    // início do dia, porque é o número que o snapshot realmente gravou.
    let anchorValueNative = null;
    // Renda fixa/caixa: valor TOTAL da posição (fonte da verdade). Guardado à parte
    // porque re-derivar via quantidade × preço unitário perde precisão — safeFloat
    // arredonda o preço a 4 casas e, numa reserva com muitas "unidades" (ex.: 15.000),
    // isso descarta centavos (R$15.000 a 100% CDI → 1,000525 vira 1,0005 → perde R$0,38).
    let accruedTotalValue = null;
    let matured = false; // C2: título de RF vencido (accrual congelado, sugere resgate)
    let pricing = null;  // diagnóstico da renda fixa (mercado × curva) para a UI
    // Qual régua produziu `dayChangePct` (ver utils/dayChangeReason.js). Atribuído
    // em CADA ramo abaixo, na mesma ordem em que o valor é sobrescrito: um motivo
    // fora de ordem faz a linha exibir um número e explicar outro.
    let dayChangeReason = null;

    if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
        // Fonte única (utils/fixedIncome): marca a mercado quando o título público
        // foi identificado, senão compõe a taxa. Idêntica ao calculateLiveKPIS e ao
        // snapshot, garantindo que KPI, ponto live do gráfico e histórico batam.
        const calcDate = brazilToday();
        const history = treasuryPricing.historyFor(asset);
        pricing = valueFixedIncomeAsset(asset, { ...macroRates, calcDate, history });

        const totalCurrentValue = pricing.value;
        accruedTotalValue = totalCurrentValue;

        // Renda fixa no dia-âncora pela MESMA porta (`valueFixedIncomeAsset`), com a
        // data de cálculo daquele dia: curva ou PU oficial, exatamente como o
        // snapshot marcou. Substitui a heurística de "um fator diário se hoje é dia
        // útil", que errava sempre que o âncora não era o dia útil imediatamente
        // anterior (segunda-feira, feriado, buraco no histórico).
        if (anchorDayKey) {
            const anchorValue = valueFixedIncomeAsset(asset, {
                ...macroRates,
                calcDate: new Date(`${anchorDayKey}T00:00:00.000Z`),
                history,
            }).value;
            if (anchorValue > 0) anchorValueNative = anchorValue;
        }
        const totalQuantity = asset.quantity;

        if (totalQuantity > 0) {
            currentPrice = totalCurrentValue / totalQuantity;
        } else {
            currentPrice = asset.type === 'CASH' ? 1 : safeDiv(asset.totalCost, asset.quantity);
        }

        // Mesmo dia BR que o resto da função usa (`todayKey`), em vez de recalcular
        // o fuso aqui — duas leituras do "hoje" na mesma função é como elas passam
        // a discordar na virada.
        const todayStr = todayKey;

        if (pricing.source === PRICING_SOURCE.MTM) {
            // Marcado: a variação do dia é a do PU — e só existe quando o PU
            // publicado é o de HOJE. A série oficial sai de manhã e é ingerida no
            // fim do dia; repetir a variação de ontem enquanto isso mostraria um
            // movimento que não aconteceu hoje.
            const puIsFromToday = pricing.priceDate === todayStr;
            const hasPreviousMark = pricing.previousMarket > 0;
            dayChangePct = (puIsFromToday && hasPreviousMark)
                ? ((pricing.value / pricing.previousMarket) - 1) * 100
                : 0;

            if (puIsFromToday && hasPreviousMark) {
                dayChangeReason = DAY_CHANGE_REASON.FIXED_INCOME_MTM;
            } else if (!hasPreviousMark && isBoughtOnDay(asset, todayKey)) {
                // Não há marcação anterior porque a POSIÇÃO não existia no PU
                // anterior — é compra do dia, não série atrasada. É a mesma guarda
                // que o ramo da curva faz explicitamente; aqui ela cai por
                // consequência, e sem esta distinção a linha diria "PU de hoje não
                // publicado" com o PU de hoje publicado na tela ao lado.
                dayChangeReason = DAY_CHANGE_REASON.BOUGHT_TODAY;
            } else {
                dayChangeReason = DAY_CHANGE_REASON.FIXED_INCOME_MTM_PENDING;
            }
        } else {
            const effectiveDailyFactor = assetDailyFactor(asset, macroRates);
            dayChangePct = isTodayBusinessDay ? (effectiveDailyFactor - 1) * 100 : 0;
            dayChangeReason = DAY_CHANGE_REASON.FIXED_INCOME_CURVE;

            // Ativo comprado HOJE: zera a variação do dia (evita variação irreal).
            // Só no ramo da CURVA — no marcado a mercado o código não zera por
            // compra do dia, e a etiqueta acompanha essa assimetria.
            const boughtToday = isBoughtOnDay(asset, todayKey);
            if (boughtToday) {
                dayChangePct = 0;
                dayChangeReason = DAY_CHANGE_REASON.BOUGHT_TODAY;
            }
        }

        // C2: título vencido não rende mais — zera a variação do dia (o valor já
        // vem congelado no vencimento). isMatured usa a mesma calcDate.
        matured = isMatured(asset, calcDate);
        if (matured) {
            dayChangePct = 0;
            dayChangeReason = DAY_CHANGE_REASON.MATURED;
        }

        // Com âncora, a variação exibida é a MEDIDA contra o dia-âncora — não a
        // estimada por um fator. Cobre curva e marcação a mercado com uma régua só.
        if (anchorValueNative !== null && !matured) {
            dayChangePct = ((totalCurrentValue / anchorValueNative) - 1) * 100;
        }

    } else {
        const cached = assetMap.get(asset.ticker);
        if (cached && cached.price > 0) {
            currentPrice = safeFloat(Number(cached.price));
            const anchorClose = safeFloat(Number(anchorCloses?.get(historyStorageKey(asset.ticker, asset.type)) || 0));
            // Fechamento GRAVADO do dia-âncora: o mesmo número que virou patrimônio
            // no snapshot. Vale para todas as classes — ação, FII, ETF e cripto — e
            // é o que impede que um ajuste de referência do provedor (dia-ex) ou um
            // corte de dia diferente (cripto 24h) abra vão entre o card e o gráfico.
            if (anchorClose > 0) {
                dayChangePct = ((currentPrice / anchorClose) - 1) * 100;
                anchorValueNative = safeValue(asset.quantity, anchorClose);
                dayChangeReason = DAY_CHANGE_REASON.ANCHOR_CLOSE;
            } else if (asset.type === 'CRYPTO') {
                // Cripto não tem pregão para datar: negocia 24h. Mas o `change` do
                // provedor é uma janela DESLIZANTE de 24 horas, e isso não é "hoje":
                // à 00h48 ele ainda carregava o dia inteiro de ontem — movimento que
                // já está dentro do patrimônio de ontem e passava a ser contado duas
                // vezes. Numa carteira real: R$ 5,09 no card contra R$ 1,34 de ganho
                // efetivo, e o card divergia do gráfico exatamente nessa diferença.
                //
                // O fechamento anterior do provedor é a âncora fixa que falta — o
                // mesmo "desde ontem" que as outras classes usam (BTC em 01/09:
                // +1,18% na janela de 24h contra +0,13% desde o fechamento).
                // Sem previousClose, mantém a janela do provedor: defasada, mas é
                // a única leitura disponível.
                const previousClose = safeFloat(Number(cached.previousClose) || 0);
                const hasPreviousClose = previousClose > 0 && currentPrice > 0;
                dayChangePct = hasPreviousClose
                    ? ((currentPrice / previousClose) - 1) * 100
                    : safeFloat(Number(cached.change));
                dayChangeReason = hasPreviousClose
                    ? DAY_CHANGE_REASON.PREVIOUS_CLOSE
                    : DAY_CHANGE_REASON.PROVIDER_WINDOW;
            } else {
                // A variação só é de HOJE se a SESSÃO que a produziu for a de hoje.
                // O updatedAt não responde isso: ele diz quando NÓS perguntamos ao
                // provedor. À 00:23 de um dia útil o refresh regrava a linha com o
                // fechamento da véspera, e o card exibia o pregão de ontem como
                // "variação hoje" até a B3 abrir — todo dia, por ~10 horas, com o
                // mesmo movimento contado duas vezes (ontem às 23h59 e hoje de
                // madrugada). É a MESMA guarda que o PU do Tesouro já faz acima.
                //
                // Sem priceDate (fonte que não publica horário, ou documento
                // anterior à migração) cai no teste antigo de dia útil: um número
                // defasado é melhor que zerar a variação da carteira inteira, e o
                // campo se preenche sozinho no primeiro refresh.
                const isTodaySession = cached.priceDate
                    ? cached.priceDate === todayKey
                    : isTodayBusinessDay;
                dayChangePct = isTodaySession ? safeFloat(Number(cached.change)) : 0;
                dayChangeReason = isTodaySession
                    ? DAY_CHANGE_REASON.PROVIDER_SESSION
                    : DAY_CHANGE_REASON.STALE_QUOTE;
            }

            // Ajuste para ativos comprados HOJE (evita variação irreal no dia da compra)
            const boughtToday = isBoughtOnDay(asset, todayKey);

            if (boughtToday && asset.quantity > 0) {
                const averagePrice = safePrice(asset.totalCost, asset.quantity);
                if (averagePrice > 0) {
                    dayChangePct = ((currentPrice / averagePrice) - 1) * 100;
                    // Sobrescreve QUALQUER um dos quatro motivos acima: o início do
                    // dia deixou de ser um fechamento e passou a ser o custo.
                    dayChangeReason = DAY_CHANGE_REASON.BOUGHT_TODAY;
                    // Posição que não existia no dia-âncora: o início do dia é o
                    // custo, não o fechamento de um candle em que ela não estava.
                    // Precede a âncora — senão o movimento do dia inteiro entraria
                    // como variação de uma posição comprada à tarde.
                    anchorValueNative = safeValue(asset.quantity, averagePrice);
                }
            }
        } else {
            currentPrice = 0;
            dayChangePct = 0;
            dayChangeReason = DAY_CHANGE_REASON.NO_QUOTE;
        }
    }

    const dollarized = isDollarized(asset);
    const currentMultiplier = dollarized ? usdRate : 1;
    // Câmbio do DIA-ÂNCORA, da mesma série histórica que o snapshot consultou.
    // `usdRate / (1 + usdChange/100)` é uma reconstrução a partir da variação
    // intraday do provedor e responde outra pergunta ("quanto o dólar subiu nas
    // últimas 24h"), então descolava do câmbio com que o patrimônio de ontem foi
    // efetivamente gravado — sobrava um resíduo cambial no lugar de zero.
    const prevMultiplier = dollarized
        ? (anchorUsdRate > 0 ? anchorUsdRate : (usdRate / (1 + usdChange / 100)))
        : 1;

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
    // Valor de início do dia. Com âncora é o valor MEDIDO no dia-âncora (candle
    // gravado / RF avaliada naquela data), o mesmo que compôs o snapshot — e é daí
    // que vem a identidade "patrimônio de ontem + variação de hoje = hoje".
    //
    // Sem âncora, o caminho antigo: renda fixa/caixa deriva do TOTAL acumulado ÷
    // fator do dia. Divisão CRUA (sem safeDiv) de propósito: o fator ~1,0005
    // arredondado a 4 casas reintroduziria a perda de centavos; arredonda-se só o
    // resultado monetário final.
    let valueStartBr;
    if (anchorValueNative !== null) {
        valueStartBr = safeMult(anchorValueNative, prevMultiplier);
    } else if (accruedTotalValue !== null) {
        valueStartBr = safeMult(accruedTotalValue / (1 + dayChangePct / 100), prevMultiplier);
    } else {
        valueStartBr = safeMult(safeValue(asset.quantity, priceStart), prevMultiplier);
    }

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
        // Contribuição da posição para a Variação Hoje, em BRL. É o MESMO número
        // que `buildWalletPayload` acumula no total do card — exposto para o
        // detalhamento do dia poder explicar o total sem recalculá-lo por outra
        // régua, que é como as duas pontas voltariam a discordar.
        //
        // O arredondamento aqui é só de exibição: o total soma os valores CRUS e
        // arredonda uma vez. `reconcileRoundedParts` fecha o resíduo depois do laço.
        dayChangeValue: safeCurrency(dayChangeValueBr),
        // Qual régua produziu o número acima (utils/dayChangeReason.js). Sem ele,
        // o zero de "não temos cotação de hoje" é indistinguível do zero de "o
        // ativo fechou estável", e a tela some com a diferença.
        dayChangeReason,
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
        // PU OFICIAL do título (hoje e o médio de compra) + a fração implícita.
        //
        // Existem porque `averagePrice`/`currentPrice` não servem para renda fixa:
        // são custo÷quantidade e saldo÷quantidade, e a quantidade da RF não segue
        // convenção — o cadastro manual pede só o valor investido e grava 1, o
        // extrato da B3 traz a fração real. O mesmo Tesouro IPCA+ 2032 aparecia
        // com "preço médio" R$ 735,92 numa carteira e R$ 2.943,68 na outra.
        // Derivados do PU oficial, estes três não dependem da digitação e batem
        // com o extrato do Tesouro Direto.
        //
        // Só existem no caminho MTM: sem PU público (CDB, LCI, cupom semestral)
        // não há preço de título para exibir, e a UI omite a coluna.
        treasuryUnitPrice: pricing?.unitPrice ? safeCurrency(pricing.unitPrice) : null,
        treasuryUnits: pricing?.units ? safeQuantity(pricing.units) : null,
        // `safePrice` e não `safeDiv`: a fração pode ter 8 casas, e safeDiv trunca
        // o divisor a 4 — numa fração pequena isso deslocaria o PU médio.
        treasuryAverageUnitPrice: pricing?.units ? safeCurrency(safePrice(asset.totalCost, pricing.units)) : null,
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

        const { assetMap, config, totalDividends, projectedMonthly, receivedByTicker,
            dayDividendsTotal, dayDividendsByTicker, snapshots, riskSnapshots, treasuryPricing } =
            await fetchWalletMarketContext(userId, liveTickers, walletId, activeAssets);

        const usdRate = safeFloat(config?.dollar || 5.75);
        const usdChange = safeFloat(config?.dollarChange || 0);
        const currentCdi = (config?.cdi && config.cdi > 0) ? safeFloat(config.cdi) : ((config?.selic && config.selic > 0) ? safeFloat(config.selic) : DEFAULT_SELIC_FALLBACK);
        // Curva histórica do CDI junto do macro: `processWalletAsset` já repassa
        // `macroRates` inteiro a `valueFixedIncomeAsset`, então a renda fixa do card
        // rende pela taxa vigente em cada dia — a mesma régua do rebuild.
        const cdiCurve = await loadCdiCurve({
            since: earliestFixedIncomeLotDate(activeAssets),
            currentRate: currentCdi,
        });
        const macroRates = { cdiRate: currentCdi, selic: config?.selic, ipca: config?.ipca, cdiCurve };

        const totalRealizedProfit = closedAssets.reduce((acc, curr) => {
            const mult = isDollarized(curr) ? usdRate : 1;
            const profitInBrl = safeMult((curr.realizedProfit || 0), mult);
            return safeAdd(acc, profitInBrl);
        }, 0);

        const brazilTodayStr = brazilDateKey();
        const isTodayBusinessDay = isBusinessDay(new Date(brazilTodayStr + 'T00:00:00.000Z'));

        // ÂNCORA DO DIA: o snapshot contra o qual a Variação Hoje é medida é o MESMO
        // que ancora o TWRR (`selectAnchorSnapshot`), o ponto anterior do gráfico e o
        // recorte de proventos do dia. Fixar os quatro no mesmo dia é o que impede a
        // tela de mostrar um card, um gráfico e uma cota discordando sobre hoje.
        const anchorDayKey = resolveAnchorDayKey(snapshots, brazilTodayStr);
        const [anchorCloses, anchorUsdRate] = anchorDayKey
            ? await Promise.all([
                loadClosesForDay(activeAssets, anchorDayKey),
                financialService._loadUsdRateResolver(usdRate)
                    .then((resolve) => safeFloat(resolve(anchorDayKey)))
                    .catch(() => 0),
            ])
            : [new Map(), 0];

        // Processa cada ativo e acumula os totais (mesma ordem/aritmética da versão monolítica).
        const assetCtx = {
            assetMap, usdRate, usdChange, macroRates, isTodayBusinessDay, treasuryPricing,
            todayKey: brazilTodayStr, anchorDayKey, anchorCloses, anchorUsdRate,
        };
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
            // Provento com data-ex DENTRO da janela do dia (posterior ao dia-âncora).
            // Não entra em `dayChangeValue`: somá-lo quebraria a identidade
            // "patrimônio de ontem + variação de hoje = hoje", que é medida só em
            // preço. Existe para a tela poder explicar a queda do dia-ex, que sem
            // ele aparece como prejuízo puro.
            processed.dayDividends = safeCurrency(dayDividendsByTicker[asset.ticker] || 0);
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

        // O total soma os valores CRUS e arredonda uma vez; as contribuições por
        // ativo já saíram arredondadas. Sem este ajuste, a soma das linhas do
        // detalhamento erra o card em até meio centavo por posição — e o painel
        // existe justamente para provar que as linhas fecham o total.
        const reconciledDayValues = reconcileRoundedParts(
            processedAssets.map((a) => a.dayChangeValue), safeTotalDayVariation,
        );
        processedAssets.forEach((a, i) => { a.dayChangeValue = reconciledDayValues[i]; });

        let totalResultPercent = 0;
        if (safeTotalInvested > 0) {
            totalResultPercent = percentOf(safeTotalResult, safeTotalInvested);
        }

        let dayVariationPercent = 0;
        if (safeTotalEquity > 0) {
            const denom = safeSub(safeTotalEquity, safeTotalDayVariation);
            if (denom !== 0) {
                dayVariationPercent = percentOf(safeTotalDayVariation, denom);
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
                // Dia do snapshot contra o qual a variação foi medida. Não é
                // cosmético: numa segunda após feriado a âncora é quinta, e o rótulo
                // "Hoje" sozinho mente sobre a janela que o número cobre.
                dayAnchorDate: anchorDayKey,
                // Proventos com data-ex na MESMA janela. Fora de `dayVariation` de
                // propósito — ver `processed.dayDividends`.
                dayDividends: safeCurrency(dayDividendsTotal),
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
/**
 * Série de rentabilidade (carteira × CDI × IPCA+6% × Ibov) + métricas de risco.
 * Extraído do handler pelo mesmo motivo de buildWalletPayload: o link público
 * renderiza a MESMA aba Rentabilidade, então precisa da mesma matemática — não
 * de uma segunda implementação que possa divergir.
 */
export const buildWalletPerformancePayload = async (userId, walletId) => {
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });

        let history = await WalletSnapshot.find({
            user: userId,
            wallet: walletId,
            totalEquity: { $gt: 1 }
        })
            .sort({ date: 1 })
            .select('date dayKey totalEquity totalInvested totalDividends quotaPrice calculatedAt')
            .lean();
        
        if (history.length === 0) {
            return [];
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

        return {
            history: downsampleTimeSeries(result, { maxPoints: DEFAULT_PERFORMANCE_POINTS }),
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
        };
};

// GET /wallet/performance — casca fina sobre buildWalletPerformancePayload.
export const getWalletPerformance = async (req, res, next) => {
    try {
        res.json(await buildWalletPerformancePayload(req.user.id, req.walletId));
    } catch (error) {
        next(error);
    }
};

export const buildWalletHistoryPayload = async (
    userId,
    walletId,
    { maxPoints = DEFAULT_HISTORY_POINTS, before = null, pageLimit = null } = {},
) => {
    const filter = { user: userId, wallet: walletId };
    if (before) filter.date = { $lt: before };

    const projection = 'date dayKey totalEquity totalInvested totalDividends profit profitPercent quotaPrice allocation calculatedAt source calculationVersion';
    if (pageLimit) {
        const page = await WalletSnapshot.find(filter)
            .sort({ date: -1 })
            .limit(pageLimit)
            .select(projection)
            .lean();
        return page.reverse();
    }

    const history = await WalletSnapshot.find(filter).sort({ date: 1 }).select(projection).lean();
    return downsampleTimeSeries(history, { maxPoints });
};

export const getWalletHistory = async (req, res, next) => {
    try {
        const maxPoints = boundedPointLimit(req.query.maxPoints, DEFAULT_HISTORY_POINTS);
        const requestedLimit = req.query.limit ? boundedPageLimit(req.query.limit) : null;
        const beforeDate = req.query.before ? new Date(req.query.before) : null;
        const before = beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null;
        res.json(await buildWalletHistoryPayload(req.user.id, req.walletId, {
            maxPoints,
            before,
            pageLimit: requestedLimit,
        }));
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
            const transactionQuantity = safeQuantity(Math.abs(Number(quantity)));
            const transactionPrice = safeFloat(Math.abs(Number(price)));
            const newTx = new AssetTransaction({
                user: userId, wallet: walletId, ticker: ticker.toUpperCase(), type: transactionType,
                quantity: transactionQuantity,
                price: transactionPrice,
                totalValue: safeValue(transactionQuantity, transactionPrice),
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
                    const idx = fixedIncomeIndex;
                    const spread = fixedIncomeSpread;
                    // Catálogo é a fonte autoritativa de índice E vencimento — busca
                    // uma vez quando falta qualquer um dos dois (evita 2 queries).
                    let bond = null;
                    if (!idx || (!maturityDate && !updatedAsset.maturityDate)) {
                        bond = await TreasuryBond.findOne({ title: new RegExp(`^${escapeRegex(ticker)}$`, 'i') }).session(session);
                    }
                    const indexing = resolveFixedIncomeIndexing({ index: idx, spread, bond });
                    if (indexing) {
                        updatedAsset.fixedIncomeIndex = indexing.index;
                        if (indexing.spread !== null) updatedAsset.fixedIncomeSpread = indexing.spread;
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

        // O termo é texto digitado, não padrão: "Tesouro IPCA+ 2037" sem escapar
        // vira `IPCA+` = um ou mais "A", e a busca não devolvia nenhum título.
        const term = escapeRegex(q);

        const marketResults = await MarketAsset.find({
            $or: [{ ticker: { $regex: `^${term}`, $options: 'i' } }, { name: { $regex: term, $options: 'i' } }],
            isIgnored: { $ne: true }
        }).sort({ liquidity: -1 }).limit(8).select('ticker name type lastPrice rate index');

        if (type === 'FIXED_INCOME') {
            const bonds = await TreasuryBond.find({
                title: { $regex: term, $options: 'i' }
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
    try {
        await runTransaction(async (session) => {
            const tx = await AssetTransaction.findOneAndDelete({ _id: req.params.id, user: userId, wallet: walletId }, { session });
            if (!tx) throw txError(404, "Transação não encontrada");
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

/**
 * Proventos da carteira (histórico mensal, provisionados, yield on cost, meta).
 * Puro leitura — o self-heal fica no handler autenticado de propósito: um
 * visitante do link público não deve disparar sincronização em background.
 */
export const buildWalletDividendsPayload = async (userId, walletId) => {
        // Meta de renda passiva é por carteira (Fase 2) — busca dedicada em Wallet,
        // em paralelo com o cálculo de proventos.
        const [data, walletDoc, accrued] = await Promise.all([
            financialService.calculateUserDividends(userId, walletId),
            Wallet.findById(walletId).select('targetMonthlyDividendIncome').lean(),
            // A MESMA soma do card "Prov. Acumulados", quebrada em pago e a pagar.
            // Vai junto para que a tela de Proventos consiga explicar por que o
            // gráfico de pagamentos mostra menos que o card, em vez de deixar o
            // usuário concluir que um dos dois está errado.
            financialService.accrueDividendsByTicker(userId, walletId, toDateKey(brazilToday())),
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

        return {
            history,
            provisioned: data.provisioned,
            totalAllTime: data.totalAllTime,
            projectedMonthly: data.projectedMonthly,
            yieldOnCost: data.yieldOnCost,
            // `total` é, por construção, o mesmo número do card; `paid`/`pending` o
            // quebram sem recalcular nada por fora.
            accrued: { total: accrued.total, paid: accrued.paid, pending: accrued.pending },
            goal,
        };
};

export const getWalletDividends = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const walletId = req.walletId;
        const data = await buildWalletDividendsPayload(userId, walletId);
        res.json(data);

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

/** Extrato paginado (aba Extrato) — compartilhado com a rota pública. */
export const buildCashFlowPayload = async (userId, walletId, { page = 1, limit = 20, filterType } = {}) => {
        // UserAsset é a fonte autoritativa da classe econômica. Isso também cobre
        // ETFs por exposição e Renda Fixa marcada como Reserva separada.
        const portfolioAssets = await UserAsset.find({ user: userId, wallet: walletId })
            .select('ticker name type currency allocationClass isReserve usSubType')
            .lean();
        const assetByTicker = new Map(portfolioAssets.map(a => [a.ticker, a]));
        const assetClassByTicker = new Map(portfolioAssets.map(a => [a.ticker, allocationBucket(a)]));
        const reserveAssets = portfolioAssets.filter(a => allocationBucket(a) === 'CASH');
        const cashNameByTicker = new Map(reserveAssets.map(a => [a.ticker, a.name || 'Reserva']));

        const query = { user: userId, wallet: walletId };
        const tickerCondition = cashFlowTickerCondition(portfolioAssets, filterType);
        if (tickerCondition) query.ticker = tickerCondition;
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
        const legacyTickers = [...new Set(transactions.filter(needsCurrencyFallback).map(t => t.ticker))]
            .filter(ticker => !assetByTicker.has(ticker));
        if (legacyTickers.length > 0) {
            const legacyAssets = await UserAsset.find({
                user: userId, wallet: walletId, ticker: { $in: legacyTickers },
            }).select('ticker type currency').lean();
            legacyAssets.forEach(a => assetByTicker.set(a.ticker, a));
        }

        return {
            transactions: transactions.map(t => {
                const isCashOp = cashNameByTicker.has(t.ticker);
                return {
                    ...t.toObject(),
                    isCashOp,
                    cashName: isCashOp ? cashNameByTicker.get(t.ticker) : undefined,
                    assetClass: assetClassByTicker.get(t.ticker),
                    assetType: assetByTicker.get(t.ticker)?.type,
                    // Gravada > posição atual > BRL.
                    currency: resolveTransactionCurrency(t, assetByTicker.get(t.ticker)),
                };
            }),
            pagination: { total, hasMore: page * limit < total }
        };
};

export const getCashFlow = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, filterType } = req.query;
        res.json(await buildCashFlowPayload(req.user.id, req.walletId, { page, limit, filterType }));
    } catch (error) { next(error); }
};

export const runCorporateAction = async (req, res, next) => {
    try {
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
