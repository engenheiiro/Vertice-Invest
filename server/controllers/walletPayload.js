// Payload de GET /wallet (compartilhado com o link público). Extraído de walletController.js.
import Wallet from '../models/Wallet.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';
import {
    safeFloat,
    safeCurrency,
    safeAdd,
    safeSub,
    percentOf,
    reconcileRoundedParts,
    QUANTITY_EPSILON,
    selectAnchorSnapshot,
    resolveCurrentCdiRate,
} from '../utils/mathUtils.js';
import { snapshotDayKey, SHARPE_WINDOW_SNAPSHOTS } from '../utils/walletRisk.js';
import { brazilDateKey, isBusinessDay, toDateKey } from '../utils/dateUtils.js';
import { brazilToday } from '../utils/fixedIncome.js';
import { loadTreasuryPricing, EMPTY_TREASURY_PRICING } from '../services/treasuryPriceService.js';
import { loadClosesForDay } from '../utils/dayCloses.js';
import { createSettledReader } from '../utils/settledReader.js';
import { recordError } from '../services/errorLogService.js';
import { loadCdiCurveForAssets } from '../utils/cdiCurve.js';
import logger from '../config/logger.js';
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';
import { computePendingFlowBRL, computeWalletMetrics, sumRealizedProfitBRL, usdRateLoaderOnce } from './walletKpis.js';
import { processWalletAsset } from './walletAssetProcessor.js';

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
    // distinct resolve no banco: antes eram um count e um find que trazia TODAS as
    // transações para a memória só para extrair os tickers.
    const distinctTickers = await AssetTransaction.distinct('ticker', { user: userId, wallet: walletId });
    if (distinctTickers.length === 0) return null;

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
        snapshotsPromise.then(async (snaps) => {
            const sinceDayKey = resolveAnchorDayKey(snaps, todayKey);
            const accrued = await financialService.accrueDividendsByTicker(
                userId, walletId, todayKey, { sinceDayKey },
            );
            // O dia do recorte viaja junto: a cota live só pode creditar estes
            // proventos se o âncora DELA for este mesmo dia (ver computeWalletMetrics).
            return { ...accrued, sinceDayKey };
        }),
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
    const { total: accruedTotal, byTicker: accruedByTicker, sinceTotal, sinceByTicker, sinceDayKey: dayDividendsSinceKey = null } =
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
        dayDividendsTotal, dayDividendsByTicker, dayDividendsSinceKey, snapshots, riskSnapshots, treasuryPricing,
    };
};

// Auto-heal seguido de reprocessamento. `{ payload }` quando reprocessou; `null`
// quando nada foi curado ou o limite de profundidade já foi atingido.
const rebuildAfterHeal = async (userId, walletId, depth) => {
    const healed = await autoHealPositions(userId, walletId);
    if (!healed) return null;
    // (6.2) Reprocessa com o estado curado, mas só até o limite de
    // profundidade — nunca recursa infinitamente.
    if (depth < MAX_WALLET_HEAL_DEPTH) {
        return { payload: await buildWalletPayload(userId, walletId, depth + 1) };
    }
    logger.warn(`buildWalletPayload: limite de auto-heal (${MAX_WALLET_HEAL_DEPTH}) atingido para ${userId}; renderizando estado atual.`);
    return null;
};

const macroInputsFrom = (config) => ({
    usdRate: safeFloat(config?.dollar || 5.75),
    usdChange: safeFloat(config?.dollarChange || 0),
    currentCdi: resolveCurrentCdiRate(config, DEFAULT_SELIC_FALLBACK),
});

// O fluxo do período (aportes/resgates desde o âncora) sai AGORA, não no fim.
// Ele depende do snapshot-âncora e do câmbio — os dois já na mão — e de mais
// nada que o laço de ativos produza. Awaitado só lá embaixo, ele enfileirava
// três idas ao banco na cauda da requisição, com tudo o mais já pronto.
//
// A condição é a MESMA que `computeWalletMetrics` aplica: fora dela o valor
// não é consumido, e disparar mesmo assim trocaria uma espera por um
// desperdício. `Promise.resolve(0)` mantém o tipo e não deixa promessa
// rejeitada sem dono.
const startPendingFlow = ({ userId, walletId, snapshots, usdRate, loadUsdRate }) => {
    const flowAnchor = selectAnchorSnapshot(snapshots);
    const pendingFlow = flowAnchor?.quotaPrice
        ? computePendingFlowBRL({
            userId, walletId, anchor: flowAnchor, currentUsd: usdRate, loadUsdRate,
        })
        : Promise.resolve(0);
    // Promessa que sai na frente precisa de dono desde já. Se a requisição
    // morrer no meio (uma exceção no laço de ativos, por exemplo), ninguém
    // chega ao `await` lá embaixo e a rejeição vira `unhandledRejection` — que
    // no Node derruba o processo inteiro por causa de UMA carteira. Este
    // `catch` só marca a rejeição como tratada; quem aguarda a promessa
    // continua recebendo o erro normalmente.
    pendingFlow.catch(() => {});
    return pendingFlow;
};

// Fechamentos e câmbio do dia-âncora (só chamado quando há dia-âncora).
const loadAnchorInputs = (activeAssets, anchorDayKey, loadUsdRate) => Promise.all([
    loadClosesForDay(activeAssets, anchorDayKey),
    loadUsdRate()
        .then((resolve) => safeFloat(resolve(anchorDayKey)))
        .catch(() => 0),
]);

// Processa cada ativo e acumula os totais (mesma ordem/aritmética da versão monolítica).
const processActiveAssets = (activeAssets, assetCtx, { receivedByTicker, dayDividendsByTicker }) => {
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
    return { processedAssets, totalEquity, totalInvested, totalDayVariation };
};

const dayVariationPercentOf = (safeTotalEquity, safeTotalDayVariation) => {
    if (!(safeTotalEquity > 0)) return 0;
    const denom = safeSub(safeTotalEquity, safeTotalDayVariation);
    return denom !== 0 ? percentOf(safeTotalDayVariation, denom) : 0;
};

// null preservado de propósito: safeFloat(null) viraria 0 e a UI
// exibiria "sem risco" onde não houve medição.
const floatOrNull = (value) => (value === null ? null : safeFloat(value));

/**
 * Monta o payload completo da carteira (assets processados + KPIs + targets +
 * meta) para um (userId, walletId). Fonte ÚNICA da verdade: tanto a rota
 * autenticada (getWalletData) quanto a rota pública (publicWalletController)
 * consomem daqui — os números da carteira pública são, por construção,
 * idênticos aos privados (a pública só projeta/mascara um subconjunto).
 */
export const buildWalletPayload = async (userId, walletId, _depth = 0) => {
    const { userAssets, activeAssets, targets } = await loadWalletState(userId, walletId);

    // Auto-Heal se não houver ativos mas houver transações (reconstrução forçada).
    if (activeAssets.length === 0) {
        const rebuilt = await rebuildAfterHeal(userId, walletId, _depth);
        if (rebuilt) return rebuilt.payload;
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
            dayDividendsTotal, dayDividendsByTicker, dayDividendsSinceKey, snapshots, riskSnapshots, treasuryPricing } =
            await fetchWalletMarketContext(userId, liveTickers, walletId, activeAssets);

        const { usdRate, usdChange, currentCdi } = macroInputsFrom(config);
        // Curva histórica do CDI junto do macro: `processWalletAsset` já repassa
        // `macroRates` inteiro a `valueFixedIncomeAsset`, então a renda fixa do card
        // rende pela taxa vigente em cada dia — a mesma régua do rebuild. Carteira
        // sem renda fixa não vai ao banco (ver `loadCdiCurveForAssets`).
        const cdiCurve = await loadCdiCurveForAssets(activeAssets, { currentRate: currentCdi });
        const macroRates = { cdiRate: currentCdi, selic: config?.selic, ipca: config?.ipca, cdiCurve };

        // Lucro realizado de TODAS as posições — encerradas e abertas com venda
        // parcial — cada venda no câmbio do dia dela (regra 8). Antes só as
        // encerradas entravam, e em moeda nativa × câmbio de HOJE: a venda
        // parcial sumia do total (a linha do ativo mostrava, o card não) e o
        // realizado de AAPL oscilava com o dólar mesmo com a posição já vendida.
        const totalRealizedProfit = sumRealizedProfitBRL(userAssets, usdRate);

        const brazilTodayStr = brazilDateKey();
        const isTodayBusinessDay = isBusinessDay(new Date(brazilTodayStr + 'T00:00:00.000Z'));

        // ÂNCORA DO DIA: o snapshot contra o qual a Variação Hoje é medida é o MESMO
        // que ancora o TWRR (`selectAnchorSnapshot`), o ponto anterior do gráfico e o
        // recorte de proventos do dia. Fixar os quatro no mesmo dia é o que impede a
        // tela de mostrar um card, um gráfico e uma cota discordando sobre hoje.
        const anchorDayKey = resolveAnchorDayKey(snapshots, brazilTodayStr);

        // Uma leitura da série de câmbio para os DOIS consumidores desta requisição
        // (o câmbio do dia-âncora, aqui, e o fluxo do período, no fim) — ver
        // `usdRateLoaderOnce`.
        const loadUsdRate = usdRateLoaderOnce(usdRate);

        const pendingFlow = startPendingFlow({ userId, walletId, snapshots, usdRate, loadUsdRate });

        const [anchorCloses, anchorUsdRate] = anchorDayKey
            ? await loadAnchorInputs(activeAssets, anchorDayKey, loadUsdRate)
            : [new Map(), 0];

        const assetCtx = {
            assetMap, usdRate, usdChange, macroRates, isTodayBusinessDay, treasuryPricing,
            todayKey: brazilTodayStr, anchorDayKey, anchorCloses, anchorUsdRate,
        };
        const { processedAssets, totalEquity, totalInvested, totalDayVariation } =
            processActiveAssets(activeAssets, assetCtx, { receivedByTicker, dayDividendsByTicker });

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

        const totalResultPercent = safeTotalInvested > 0 ? percentOf(safeTotalResult, safeTotalInvested) : 0;
        const dayVariationPercent = dayVariationPercentOf(safeTotalEquity, safeTotalDayVariation);

        const { weightedRentability, dataQuality, sharpeRatio, sharpeConfidence, sharpeStandardError, sharpeSample, beta } =
            await computeWalletMetrics({
                userId, walletId, snapshots, riskSnapshots, safeTotalEquity, totalResultPercent, currentCdi,
                currentUsd: usdRate, pendingFlow,
                dividendsSinceAnchor: dayDividendsSinceKey
                    ? { dayKey: dayDividendsSinceKey, total: dayDividendsTotal }
                    : null,
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
                sharpeRatio: floatOrNull(sharpeRatio),
                // Acompanham o indicador para que a UI não transmita uma precisão
                // que a amostra não sustenta.
                sharpeConfidence,
                sharpeStandardError: floatOrNull(sharpeStandardError),
                sharpeSample,
                beta: floatOrNull(beta)
            },
            ...targets,
            meta: { usdRate, lastUpdate: new Date() }
        };
};
