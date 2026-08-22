
import cron from 'node-cron';
import * as Sentry from "@sentry/node"; // Import Sentry
import logger from '../config/logger.js';
import { aiResearchService } from './aiResearchService.js'; 
import { macroDataService } from './macroDataService.js';
import { marketDataService } from './marketDataService.js';
import { syncService } from './syncService.js';
import { holidayService } from './holidayService.js';
import { financialService } from './financialService.js';
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js'; // (M9)
import { clearUserCache } from '../utils/userCache.js'; // (I6) limpa cache pós-downgrade em massa
import { RECURRING_GRACE_DAYS } from '../config/subscription.js';
import { signalEngine } from './engines/signalEngine.js';
import MarketAsset from '../models/MarketAsset.js';
import MarketAnalysis from '../models/MarketAnalysis.js';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import UserAsset from '../models/UserAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import AssetTransaction from '../models/AssetTransaction.js';
import DividendEvent from '../models/DividendEvent.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js'; // IMPORTADO
import RefreshToken from '../models/RefreshToken.js';
import { createBroadcast } from './notificationService.js';
import { calculateDailyDietz } from '../utils/mathUtils.js';
import { valueFixedIncomeAsset } from '../utils/fixedIncome.js';
import { loadTreasuryPricing, EMPTY_TREASURY_PRICING } from './treasuryPriceService.js';
import { validateFundamentalsPublicationHealth } from '../utils/ingestionHealth.js';
import {
    activateResearchSections,
    hasSectionContent,
} from './researchPublicationService.js';

import { isDollarized } from '../utils/assetCurrency.js';
import { positionCostBRL } from '../utils/fxRate.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import {
    brazilDayKey,
    isBrBusinessDay,
    isTwrrReturnAnomalous,
    snapshotInstantForDay,
    sumTransactionFlowBRL,
    transactionsAfterSnapshotFilter,
    upsertWalletSnapshotForDay,
} from '../utils/walletSnapshot.js';
import { timeSeriesWorker } from './workers/timeSeriesWorker.js';
import { ensureWalletDayCandles } from './walletDayCandleService.js';
import { usStocksFundamentalsService } from './usStocksFundamentalsService.js';
import { trackJobSafe } from '../utils/jobRun.js';
import { runDataHealthCheck } from './dataHealthService.js';

// (TZ) Todos os crons rodam em horário de Brasília. Sem o timezone explícito,
// node-cron usa o fuso do servidor (UTC no Render), fazendo '30 18' disparar
// às 15:30 BRT em vez de 18:30. Wrapper centraliza isso em todas as chamadas.
const SCHEDULER_TZ = 'America/Sao_Paulo';

// (OBSERVABILIDADE) Todo cron passa por `trackJobSafe`, que grava um JobRun por
// execução. É o que permite ao painel de Saúde dos Dados acusar cron PARADO — a
// ausência de execução não produz log, então sem esse registro um scheduler morto
// é indistinguível de um scheduler ocioso. O `jobId` deve existir em jobCatalog.js,
// que define o teto de silêncio tolerado de cada rotina.
const schedule = (expression, jobId, fn) => cron.schedule.call(
    cron,
    expression,
    () => trackJobSafe(jobId, fn),
    { timezone: SCHEDULER_TZ },
);

// (DISABLE_SCHEDULER) Desliga o scheduler INTEIRO nesta instância — nenhum cron
// registrado e nenhuma rotina de boot disparada. Existe para o ambiente de
// DESENVOLVIMENTO: o .env local aponta para o Mongo de PRODUÇÃO, então todo
// `npm run dev` subia um segundo scheduler competindo com o do host (visto em
// 19/08/2026: dois JobRun de 'daily-evening' abertos no mesmo segundo, ambos
// mortos no meio; mesmo rastro em 'full-sync', 'daily-morning' e 'quotes-sync').
//
// NÃO se confunde com EXTERNAL_SCHEDULER, que move os 3 jobs pesados para Render
// Cron Jobs mantendo os outros 15 in-app. Os dois mecanismos coexistem.
//
// Flag EXPLÍCITA e não derivada de NODE_ENV de propósito: staging e os scripts
// pontuais que sobem o app rodam com NODE_ENV !== 'production' e dependem do
// comportamento atual — derivar silenciaria os dois sem ninguém pedir. Default =
// registra tudo: variável ausente ou escrita errada nunca pode calar produção,
// porque scheduler mudo não deixa rastro nenhum.
//
// Lida no momento da chamada (não no import) para não depender da ordem entre o
// dotenv do index.js e o import de app.js.
const isSchedulerDisabled = () => process.env.DISABLE_SCHEDULER === 'true';

// (EXTERNAL_SCHEDULER) Os jobs pesados (sync pós-mercado + snapshot) podem ser
// rodados por Render Cron Jobs — independentes do web service, que hiberna e
// perde execuções. Defina EXTERNAL_SCHEDULER=true no web service para desativar
// essas rotinas in-app e evitar execução dupla. Default = roda in-app (atual).
const EXTERNAL_SCHEDULER = process.env.EXTERNAL_SCHEDULER === 'true';
const scheduleHeavy = (expression, jobId, fn) => {
    if (EXTERNAL_SCHEDULER) {
        logger.info(`⏭️ Cron pesado '${expression}' desativado in-app (EXTERNAL_SCHEDULER=true → Render Cron Job).`);
        return null;
    }
    return schedule(expression, jobId, fn);
};

// --- LÓGICA DE SNAPSHOT ISOLADA (Reutilizável) ---
//
// Convenção de datas (crítica): TUDO é ancorado no DIA-CALENDÁRIO de São Paulo.
// O cron dispara 23:59 BRT, que é 02:59 UTC do dia seguinte. Usar o instante UTC
// cru (getDay()) fazia o gate de dia útil ver SEXTA como SÁBADO (pulava a sexta)
// e DOMINGO como SEGUNDA (gravava snapshot indevido). Estas helpers derivam o dia
// BR e só então checam feriado/fim de semana e compõem o accrual.
const CATCHUP_MAX_DAYS = 14; // teto de recuperação por usuário (segurança)

// Dia-calendário BR (YYYY-MM-DD) de um instante.
const brDayStr = (d) => brazilDayKey(d);
// Date à meia-noite UTC do dia BR — calcDate do accrual de renda fixa.
const brCalcDate = (dayStr) => new Date(`${dayStr}T00:00:00.000Z`);
// Implementação mora em utils/walletSnapshot.js, ao lado de brazilDayKey — a
// sentinela de saúde também precisa dela e importá-la daqui criaria ciclo. Segue
// re-exportada para preservar o ponto de importação histórico (testes inclusive).
export { isBrBusinessDay };
// Instante gravado no snapshot: 23:59 BRT do dia — garante que o gráfico (que
// bucketiza por dia LOCAL no browser BRT) coloque o ponto no dia correto.
const brSnapshotInstant = (dayStr) => snapshotInstantForDay(dayStr);
// Limites do dia BR como instantes, para janelas de busca (snapshots/transações).
const brDayBounds = (dayStr) => ({
    start: new Date(`${dayStr}T00:00:00.000-03:00`),
    end: new Date(`${dayStr}T23:59:59.999-03:00`),
});
// Próximo dia BR (string). Âncora ao meio-dia UTC evita bordas de fuso/DST.
const nextBrDay = (dayStr) => {
    const d = new Date(`${dayStr}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return brDayStr(d);
};
// Dias úteis estritamente APÓS fromDayStr e estritamente ANTES de untilDayStr.
const businessDaysBetween = (fromDayStr, untilDayStr) => {
    const days = [];
    let cur = nextBrDay(fromDayStr);
    let guard = 0;
    while (cur < untilDayStr && guard++ < 60) {
        if (isBrBusinessDay(cur)) days.push(cur);
        cur = nextBrDay(cur);
    }
    return days;
};

// Fechamentos do dia (AssetHistory) dos tickers de renda variável em carteira.
// É a MESMA fonte que o rebuild usa para marcar a mercado; sem isso, o snapshot
// diário gravava a cotação em cache do momento do cron (que pode estar horas
// atrasada — em produção, TRXF11 a 79,75 contra fechamento de 81,35, ~2%) e o
// primeiro rebuild reescrevia o dia inteiro. Só o candle do dia é projetado —
// hidratar os arrays de ~400 candles de toda a base seria caro à toa.
const loadDayCloses = async (assetRefs, dayStr) => {
    const keys = [...new Set(assetRefs.map((a) => historyStorageKey(a.ticker, a.type)).filter(Boolean))];
    if (keys.length === 0) return new Map();
    const rows = await AssetHistory.aggregate([
        { $match: { ticker: { $in: keys } } },
        {
            $project: {
                ticker: 1,
                candle: {
                    $first: {
                        $filter: { input: { $ifNull: ['$history', []] }, as: 'h', cond: { $eq: ['$$h.date', dayStr] } },
                    },
                },
            },
        },
        { $match: { 'candle.close': { $gt: 0 } } },
    ]);
    return new Map(rows.map((r) => [r.ticker, r.candle.close]));
};

// Contexto compartilhado (macro + cotações em lote) de um run de snapshot.
// `ensureDayCandles` só é ligado por quem vai GRAVAR o snapshot de hoje: o
// backfill/boot reconstrói a série pelo rebuild (que tem o próprio cache de
// preços) e não deve pagar dezenas de buscas externas a cada reinício.
export const loadSnapshotContext = async (dayStr = brDayStr(new Date()), { ensureDayCandles = false } = {}) => {
    const sysConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    const usdRate = sysConfig?.dollar || 5.75;
    const currentCdi = (sysConfig?.cdi > 0 ? sysConfig.cdi : null) || (sysConfig?.selic > 0 ? sysConfig.selic : null) || DEFAULT_SELIC_FALLBACK;
    const macroRates = { cdiRate: currentCdi, selic: sysConfig?.selic, ipca: sysConfig?.ipca };
    // (F4) Cotações em LOTE, uma vez por run — evita N+1 de getMarketDataByTicker.
    const liveAssets = await UserAsset.find({ type: { $nin: ['CASH', 'FIXED_INCOME'] } }).select('ticker type quantity').lean();
    const priceMap = await marketDataService.getMarketDataMap([...new Set(liveAssets.map((a) => a.ticker))]);
    const closeMap = await loadDayCloses(liveAssets, dayStr);
    // Antes de marcar o dia, garante o candle de fechamento dos ativos que estão
    // em carteira. Sem isso o fallback abaixo (preço corrente às 23:59) valia para
    // metade do patrimônio, porque a série de AssetHistory atrasa por design.
    if (ensureDayCandles) {
        const resolved = await ensureWalletDayCandles(liveAssets, dayStr, closeMap);
        for (const [key, close] of resolved) closeMap.set(key, close);
    }
    const getUsdRateForDate = await financialService._loadUsdRateResolver(usdRate);
    // Séries de PU do Tesouro, uma vez por run: o snapshot precisa marcar a renda
    // fixa pela MESMA régua do KPI ao vivo, senão o histórico e o card divergem.
    const treasuryAssets = await UserAsset.find({ type: 'FIXED_INCOME' })
        .select('ticker type name maturityDate fixedIncomeIndex')
        .lean();
    const treasuryPricing = await loadTreasuryPricing(treasuryAssets);
    return { usdRate, macroRates, priceMap, closeMap, getUsdRateForDate, treasuryPricing };
};

// Patrimônio (equity/invested) de um conjunto de ativos numa data de cálculo.
// Renda fixa/caixa: accrual exato via fonte única (utils/fixedIncome). Renda
// variável: FECHAMENTO do dia (mesma marcação do rebuild), caindo na cotação
// corrente só quando o candle ainda não chegou. Esse fallback é o último recurso:
// `ensureWalletDayCandles` busca o candle do dia dos ativos em carteira antes do
// snapshot, então ele só entra quando a fonte externa falhou ou o ativo não
// negociou no dia.
export const computeEquityAt = (assets, { priceMap, closeMap, macroRates, usdRate, calcDate, treasuryPricing = EMPTY_TREASURY_PRICING }) => {
    let totalEquity = 0;
    let totalInvested = 0;
    for (const asset of assets) {
        const multiplier = isDollarized(asset) ? usdRate : 1;
        if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
            totalEquity += valueFixedIncomeAsset(asset, {
                ...macroRates, calcDate, history: treasuryPricing.historyFor(asset),
            }).value;
            totalInvested += asset.totalCost;
        } else {
            const close = closeMap?.get(historyStorageKey(asset.ticker, asset.type)) || 0;
            const price = close > 0 ? close : (priceMap.get(asset.ticker)?.price || 0);
            if (price > 0) {
                totalEquity += asset.quantity * price * multiplier;
                // Custo com o câmbio das compras (mesma base do fluxo de aportes,
                // que já usava o câmbio por data em sumTransactionFlowBRL).
                totalInvested += positionCostBRL(asset, usdRate);
            }
        }
    }
    return { totalEquity, totalInvested };
};

// Persiste UM snapshot de UMA CARTEIRA para um dia BR específico (Fase 2: o
// snapshot diário/TWRR passou a ser por carteira, não mais por usuário — cada
// carteira tem seu próprio histórico desde a data em que foi criada).
// - Idempotente por (wallet, dia BR): se já existe snapshot no dia, retorna
//   'exists' (a menos de force, que substitui). Evita duplicata entre catch-up,
//   cron in-app e Render Cron Job.
// - Mantém a cadeia de cotas (TWRR) buscando o snapshot imediatamente ANTERIOR ao dia.
// Retorna: 'created' | 'exists' | 'empty' | 'anomaly' | 'reset-guard'.
export const persistUserSnapshotForDay = async (wallet, dayStr, ctx, { assets = null, force = false } = {}) => {
    const { priceMap, closeMap, macroRates, usdRate, getUsdRateForDate } = ctx;
    const bounds = brDayBounds(dayStr);
    const calcDate = brCalcDate(dayStr);
    const userId = wallet.user?._id || wallet.user;
    const walletId = wallet._id;
    const calculatedAt = new Date();

    const positions = assets || await UserAsset.find({ user: userId, wallet: walletId });
    const { totalEquity, totalInvested } = computeEquityAt(positions, { priceMap, closeMap, macroRates, usdRate, calcDate, treasuryPricing: ctx.treasuryPricing });
    if (!(totalEquity > 0)) return 'empty';

    // Snapshot anterior (cota/Dietz) — estritamente antes deste dia BR.
    const lastSnapshot = await WalletSnapshot.findOne({ wallet: walletId, date: { $lt: bounds.start } }).sort({ date: -1 });

    // Fluxos ainda não incorporados pelo snapshot anterior. A consulta combina
    // dia econômico + createdAt para cobrir fim de semana, lançamento retroativo
    // e aporte do mesmo dia criado depois de um rebuild.
    const pendingFilter = lastSnapshot
        ? transactionsAfterSnapshotFilter(lastSnapshot)
        : { date: { $lte: bounds.end } };
    const transactions = await AssetTransaction.find({ user: userId, wallet: walletId, ...pendingFilter });
    const assetsByTicker = new Map(positions.map((p) => [p.ticker, p]));
    const dayFlow = sumTransactionFlowBRL(transactions, assetsByTicker, getUsdRateForDate || usdRate);

    // Proventos com EX-DATE neste dia BR (crédito de RENDA no TWRR). O preço cai
    // no dia-ex; sem somar o provento recebido à cota, essa queda vira prejuízo-
    // fantasma e a cota vaza ~1%/mês em FIIs distribuidores. DividendEvent.date é
    // a ex-date normalizada à meia-noite UTC do dia-calendário — casa 1:1 com dayStr.
    let dayDividendIncome = 0;
    const qtyByTicker = new Map();
    positions.forEach(p => { if (p.quantity > 0) qtyByTicker.set(String(p.ticker).toUpperCase(), p.quantity); });
    if (qtyByTicker.size > 0) {
        const [dy, dm, dd] = dayStr.split('-').map(Number);
        const exDateUtc = new Date(Date.UTC(dy, dm - 1, dd));
        const divEvents = await DividendEvent.find({ ticker: { $in: [...qtyByTicker.keys()] }, date: exDateUtc }).lean();
        const seenDiv = new Set();
        for (const ev of divEvents) {
            const t = String(ev.ticker).toUpperCase();
            const key = `${t}|${ev.type || 'DIVIDEND'}`; // dedup multi-fonte (mesmo provento)
            if (seenDiv.has(key)) continue;
            seenDiv.add(key);
            const qty = qtyByTicker.get(t);
            if (qty > 0) dayDividendIncome += qty * ev.amount;
        }
    }

    let quotaPrice = 100;
    const v0 = lastSnapshot ? lastSnapshot.totalEquity : 0;
    if (v0 > 0 || dayFlow > 0 || dayDividendIncome > 0) {
        const dailyReturn = calculateDailyDietz(v0, totalEquity, dayFlow, dayDividendIncome);
        // Circuit breaker: rejeita variação diária absurda (dado corrompido).
        if (isTwrrReturnAnomalous(dailyReturn)) {
            logger.warn(`⚠️ Anomalia TWRR wallet ${walletId} @ ${dayStr}: ${(dailyReturn * 100).toFixed(2)}%. Snapshot ignorado.`);
            if (process.env.SENTRY_DSN) {
                Sentry.captureMessage(`TWRR Anomaly: Wallet ${walletId} @ ${dayStr} = ${dailyReturn.toFixed(2)}%. Skipped.`);
            }
            return 'anomaly';
        }
        const prevQuota = lastSnapshot ? (lastSnapshot.quotaPrice || 100) : 100;
        quotaPrice = prevQuota * (1 + dailyReturn);
    }

    // Proteção contra Reset Indevido da cota (histórico existente + quota ~100).
    if (Math.abs(quotaPrice - 100) < 0.1) {
        const hasHistory = lastSnapshot
            ? Math.abs(lastSnapshot.quotaPrice - 100) > 5
            : await WalletSnapshot.exists({ wallet: walletId });
        if (hasHistory) {
            logger.error(`❌ Cota resetou p/ 100 indevidamente wallet ${walletId} @ ${dayStr}. Snapshot abortado.`);
            return 'reset-guard';
        }
    }

    // Mesma regra do rebuild: acumulado por EX-DATE com a quantidade da época.
    // `calculateUserDividends` (por data de PAGAMENTO, quantidade de HOJE) segue
    // servindo a tela de Proventos, mas não pode alimentar o snapshot: as duas
    // definições no mesmo campo faziam `profit`/`profitPercent` pular sozinhos no
    // primeiro rebuild.
    const totalDividends = await financialService.accruedDividendsThroughDay(userId, walletId, dayStr);

    const payload = {
        user: userId,
        wallet: walletId,
        date: brSnapshotInstant(dayStr),
        dayKey: dayStr,
        source: force ? 'BACKFILL' : 'DAILY',
        calculationVersion: 5,
        calculatedAt,
        totalEquity,
        totalInvested,
        totalDividends,
        profit: totalEquity - totalInvested + totalDividends,
        profitPercent: totalInvested > 0 ? ((totalEquity - totalInvested + totalDividends) / totalInvested) * 100 : 0,
        quotaPrice,
    };

    // Upsert por dia civil: uma segunda execução recalcula o dia em vez de
    // aceitar silenciosamente um snapshot prematuro. Remove o documento legado
    // do mesmo dia (sem dayKey) depois que a versão nova foi persistida.
    const saved = await upsertWalletSnapshotForDay(
        WalletSnapshot,
        walletId,
        dayStr,
        payload,
    );
    await WalletSnapshot.deleteMany({
        wallet: walletId,
        date: { $gte: bounds.start, $lte: bounds.end },
        _id: { $ne: saved._id },
    });
    return 'created';
};

// Recupera dias úteis PERDIDOS de um usuário (entre o último snapshot e hoje,
// exclusivo). node-cron não reexecuta ticks perdidos (deploy/reinício/erro
// transitório sobre 23:59) — este catch-up é a rede de segurança que fecha os
// buracos, com data retroativa correta e accrual exato de renda fixa.
const backfillUserGap = async (wallet, todayStr, ctx, assets) => {
    const last = await WalletSnapshot.findOne({ wallet: wallet._id }).sort({ date: -1 });
    if (!last) return 0; // sem histórico: o fluxo normal cuida do 1º snapshot
    const lastDayStr = brDayStr(new Date(last.date));
    const missing = businessDaysBetween(lastDayStr, todayStr).slice(-CATCHUP_MAX_DAYS);
    if (missing.length === 0) return 0;

    // Nunca marca um dia passado usando as posições ATUAIS. Reconstruímos a
    // cadeia pela linha do tempo real de transações/preços e persistimos tudo
    // atomicamente por carteira.
    await financialService.rebuildUserHistory(wallet.user?._id || wallet.user, wallet._id);
    logger.info(`🩹 Backfill histórico ${wallet.user?.email || wallet.user} (${wallet.name}): ${missing.length} dia(s).`);
    return missing.length;
};

// Varredura de recuperação (boot / pré-run diário) sem tocar no dia de hoje.
// Fase 2: itera CARTEIRAS (não usuários) — cada carteira tem sua própria cadeia
// de snapshots/TWRR independente.
export const backfillMissedSnapshots = async () => {
    try {
        const todayStr = brDayStr(new Date());
        const ctx = await loadSnapshotContext(todayStr);
        const wallets = await Wallet.find({}).populate('user', 'email').select('_id user name');
        let created = 0;
        for (const wallet of wallets) {
            try {
                created += await backfillUserGap(wallet, todayStr, ctx, null);
            } catch (e) {
                logger.error(`Backfill erro wallet ${wallet._id}: ${e.message}`);
                if (process.env.SENTRY_DSN) Sentry.captureException(e);
            }
        }
        if (created > 0) logger.info(`🩹 Recuperação de snapshots concluída: ${created} dia(s) preenchido(s).`);
        return { status: 'SUCCESS', created };
    } catch (error) {
        logger.error(`❌ Backfill Erro Geral: ${error.message}`);
        Sentry.captureException(error);
        return { status: 'ERROR', error: error.message };
    }
};

export const runDailySnapshot = async (force = false) => {
    const now = new Date();
    const todayStr = brDayStr(now);

    // (FIX TZ) Gate de dia útil ancorado no DIA-CALENDÁRIO do Brasil — nunca no
    // instante UTC cru. Antes, 'isBusinessDay(new Date())' às 23:59 BRT lia o dia
    // da semana em UTC (02:59 do dia seguinte), pulando toda SEXTA e gravando
    // snapshot indevido todo DOMINGO.
    if (!force && !isBrBusinessDay(todayStr)) {
        logger.info("⏸️ Snapshot Diário ignorado: Dia não útil (Feriado ou Fim de Semana).");
        // Mesmo em dia não útil, recupera dias úteis perdidos anteriores.
        await backfillMissedSnapshots();
        return { status: 'SKIPPED', reason: 'Non-business day' };
    }

    logger.info(`📸 Iniciando Snapshot Patrimonial Diário (Auditado) [Force: ${force}]...`);
    try {
        const ctx = await loadSnapshotContext(todayStr, { ensureDayCandles: true });
        // Fase 2: itera CARTEIRAS (não usuários) — 1 snapshot/dia por carteira,
        // já que cada uma tem seu próprio histórico/TWRR desde a criação.
        const wallets = await Wallet.find({}).populate('user', 'email').select('_id user name');

        let snapshotsCreated = 0;
        let snapshotsSkipped = 0;
        let backfilled = 0;

        for (const wallet of wallets) {
            try {
                const userId = wallet.user?._id || wallet.user;
                // Posições buscadas uma vez por carteira (reuso no catch-up + hoje).
                const assets = await UserAsset.find({ user: userId, wallet: wallet._id });

                // 1) Recupera dias úteis anteriores faltantes (self-healing).
                backfilled += await backfillUserGap(wallet, todayStr, ctx, assets);

                // 2) Snapshot de HOJE (idempotente; respeita force).
                const r = await persistUserSnapshotForDay(wallet, todayStr, ctx, { assets, force });
                if (r === 'created') snapshotsCreated++;
                else snapshotsSkipped++;
            } catch (walletErr) {
                logger.error(`Erro snapshot wallet ${wallet._id}: ${walletErr.message}`);
                if (process.env.SENTRY_DSN) Sentry.captureException(walletErr);
            }
        }

        const stats = {
            created: snapshotsCreated,
            skipped: snapshotsSkipped,
            backfilled,
            timestamp: new Date(),
        };

        // PERSISTÊNCIA DO RELATÓRIO NO SYSTEM CONFIG
        await SystemConfig.findOneAndUpdate(
            { key: 'MACRO_INDICATORS' },
            { $set: { lastSnapshotStats: stats } },
            { upsert: true }
        );

        logger.info(`✅ Snapshot Finalizado. Criados: ${snapshotsCreated}, Recuperados: ${backfilled}, Ignorados: ${snapshotsSkipped}`);
        return { status: 'SUCCESS', stats };

    } catch (error) {
        logger.error(`❌ Snapshot Erro Geral: ${error.message}`);
        Sentry.captureException(error);
        return { status: 'ERROR', error: error.message };
    }
};

// --- AUTO-PUBLISH SEMANAL (Reutilizável) ---
// Publica automaticamente o ranking + Explainable IA mais recente de cada classe,
// uma vez por semana, para os períodos em que o admin não publica manualmente.
// A geração diária (09:00/18:30) permanece intacta — isto só PUBLICA o que já existe.
const AUTO_PUBLISH_CLASSES = ['BRASIL_10', 'STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'REIT', 'ETF'];
const ASSET_CLASS_LABELS = {
    STOCK: 'Ações BR', FII: 'FIIs', CRYPTO: 'Cripto',
    STOCK_US: 'Ações EUA', REIT: 'REITs', ETF: 'ETFs', BRASIL_10: 'Brasil 10',
};

// Gate de qualidade do auto-publish: o cron publica ÀS CEGAS o mais recente de cada
// classe — sem este gate, um ranking vazio/degradado (sync quebrado) ou velho (geração
// parada há dias) iria ao ar sem ninguém olhar. Publicação manual do admin não passa
// por aqui (ele vê os dados antes de publicar). Exportada para teste.
export const AUTO_PUBLISH_MIN_ASSETS = 5;
export const AUTO_PUBLISH_MAX_AGE_DAYS = 7;
export const validateAutoPublish = (analysis, now = new Date(), lastSyncStats = null, assetClassOverride = null) => {
    const count = analysis?.content?.ranking?.length || 0;
    if (count < AUTO_PUBLISH_MIN_ASSETS) {
        return { ok: false, reason: `ranking com ${count} ativos (mínimo ${AUTO_PUBLISH_MIN_ASSETS})` };
    }
    const ageMs = now.getTime() - new Date(analysis.createdAt || 0).getTime();
    if (ageMs > AUTO_PUBLISH_MAX_AGE_DAYS * 86400000) {
        return { ok: false, reason: `ranking gerado há ${Math.round(ageMs / 86400000)} dias (máximo ${AUTO_PUBLISH_MAX_AGE_DAYS})` };
    }
    const assetClass = assetClassOverride || analysis?.assetClass;
    const fundamentalsGate = validateFundamentalsPublicationHealth(assetClass, lastSyncStats, now);
    if (!fundamentalsGate.ok) return fundamentalsGate;
    return { ok: true };
};

export const runWeeklyAutoPublish = async () => {
    logger.info("📢 Auto-publish semanal — publicando rankings mais recentes");
    const published = [];
    const systemConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean();
    const lastSyncStats = systemConfig?.lastSyncStats || null;
    for (const assetClass of AUTO_PUBLISH_CLASSES) {
        try {
            const latest = await MarketAnalysis.findOne({ assetClass, strategy: 'BUY_HOLD' }).sort({ createdAt: -1 });
            if (!latest) continue;
            const gate = validateAutoPublish(latest, new Date(), lastSyncStats, assetClass);
            if (!gate.ok) {
                logger.warn(`🚫 Auto-publish BLOQUEADO (${assetClass}): ${gate.reason}`);
                Sentry.captureMessage(`Auto-publish bloqueado (${assetClass}): ${gate.reason}`, 'warning');
                continue;
            }
            const wasPublished = latest.isRankingPublished;
            const sections = ['RANKING'];
            if (hasSectionContent(latest, 'REPORT')) sections.push('REPORT');
            if (hasSectionContent(latest, 'EXPLAINABLE_AI')) sections.push('EXPLAINABLE_AI');
            await activateResearchSections({
                analysis: latest,
                sections,
                requireAll: false,
            });
            if (!wasPublished) {
                published.push(assetClass);
                const label = ASSET_CLASS_LABELS[assetClass] || assetClass;
                await createBroadcast({
                    type: 'RANKING_PUBLISHED',
                    title: 'Novo ranking publicado',
                    message: `Novo ranking de ${label} está disponível. Confira as recomendações atualizadas.`,
                    relatedAssetClass: assetClass,
                });
            }
        } catch (e) {
            logger.error(`❌ Auto-publish (${assetClass}): ${e.message}`);
        }
    }
    logger.info(`📢 Auto-publish semanal concluído. Novas publicações: ${published.length ? published.join(', ') : 'nenhuma'}`);
    return { published };
};

export const initScheduler = () => {
    // Guard de instância: sai ANTES de registrar qualquer cron e antes das duas
    // rotinas de boot (backfill de snapshot e sentinela de saúde), que escrevem
    // no banco. Log em WARN e nomeando a flag de propósito: a sentinela alarma
    // job em silêncio (jobCatalog.js) e quem for diagnosticar precisa distinguir
    // "desligado de propósito" de "morreu no meio".
    if (isSchedulerDisabled()) {
        logger.warn('⏸️ Scheduler DESLIGADO nesta instância (DISABLE_SCHEDULER=true): nenhum cron registrado, nenhuma rotina de boot disparada. As rotinas ficam a cargo do host de produção.');
        return { started: false, reason: 'DISABLE_SCHEDULER' };
    }

    logger.info("⏰ Scheduler Service Inicializado");

    // (RESILIÊNCIA) Recuperação de snapshots perdidos no BOOT. Um deploy/reinício
    // que caia sobre 23:59 BRT não reexecuta o tick do cron — este catch-up fecha
    // o buraco no próximo start. Fire-and-forget após 15s (deixa o boot assentar).
    setTimeout(() => {
        backfillMissedSnapshots().catch((e) => logger.error(`Backfill boot: ${e.message}`));
    }, 15000);

    // 1. Sync Leve: Macroeconomia (A cada 15 minutos)
    schedule('5,20,35,50 * * * *', 'macro-sync', async () => {
        try {
            await macroDataService.performMacroSync();
        } catch (error) {
            logger.error(`❌ Rotina Macro: ${error.message}`);
        }
    });

    // 2. Sync Preços (Yahoo/Brapi 15min)
    schedule('*/15 * * * *', 'quotes-sync', async () => {
        try {
            const assets = await MarketAsset.find({ 
                isActive: true,
                $or: [
                    { liquidity: { $gt: 10000 } },
                    { type: { $in: ['CRYPTO', 'STOCK_US', 'ETF'] } }
                ]
            }).select('ticker');
            
            const tickers = assets.map(a => a.ticker);
            if (tickers.length === 0) return;

            const BATCH_SIZE = 50;
            for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
                const batch = tickers.slice(i, i + BATCH_SIZE);
                await marketDataService.refreshQuotesBatch(batch);
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            logger.error(`❌ Rotina Preços: ${e.message}`);
        }
    });

    // 3. RADAR ALPHA 3.1
    schedule('2,17,32,47 * * * *', 'radar-alpha', async () => {
        try {
            await signalEngine.runScanner();
        } catch (e) {
            logger.error(`❌ Rotina Radar Alpha: ${e.message}`);
        }
    });

    // 4. BACKTEST INTRADAY
    schedule('5,35 * * * *', 'backtest-intraday', async () => {
        try {
            await signalEngine.runBacktest();
        } catch (e) {
            logger.error(`❌ Rotina Backtest: ${e.message}`);
        }
    });

    // 5a. Sync Manhã (09:00) — dados do pregão anterior consolidados, antes de abrir
    schedule('0 9 * * *', 'daily-morning', async () => {
        logger.info("⏰ Rotina Diária V3 — Manhã (09:00)");
        try {
            const syncResult = await syncService.performFullSync();
            // Resiliência: 403/IP no Fundamentus não deve abortar o research.
            // Fundamentos são trimestrais (já no banco) e preços seguem frescos
            // via crons leves — então roda o ranking com os dados em cache.
            const scrapingBlocked = !syncResult.success && syncResult.error === 'Scraping blocked.';
            if (scrapingBlocked) {
                logger.warn("⚠️ Fundamentus bloqueado (403). Rodando research com fundamentos em cache.");
            }
            if (syncResult.success || scrapingBlocked) {
                await aiResearchService.runBatchAnalysis(null);
                // Carteira Recomendada — curva contínua event-driven (não-crítica)
                try {
                    const { buildRecommendedPortfolioCurves } = await import('../scripts/recommendedPortfolioEngine.js');
                    await buildRecommendedPortfolioCurves();
                } catch (e) { logger.warn(`⚠️ Carteira Recomendada (manhã): ${e.message}`); }
            } else {
                // Falha de sync NÃO-tolerada (não é o 403 do Fundamentus): research não roda
                // hoje — alerta ativo, senão só descobriríamos olhando log.
                Sentry.captureMessage(`Sync da manhã falhou (${syncResult.error || 'erro desconhecido'}) — research não rodou`, 'error');
            }
        } catch (e) {
            logger.error(`❌ Rotina Manhã V3: ${e.message}`);
            Sentry.captureException(e);
        }
    });

    // 5b. Sync Tarde/Pós-Mercado (18:30) — B3 fecha às 17:30, dados completos do dia
    scheduleHeavy('30 18 * * *', 'daily-evening', async () => {
        logger.info("⏰ Rotina Diária V3 — Pós-Mercado (18:30)");
        try {
            const syncResult = await syncService.performFullSync();
            // Resiliência: 403/IP no Fundamentus não deve abortar o research
            // (fundamentos trimestrais em cache + preços frescos via crons leves).
            const scrapingBlocked = !syncResult.success && syncResult.error === 'Scraping blocked.';
            if (scrapingBlocked) {
                logger.warn("⚠️ Fundamentus bloqueado (403). Rodando research com fundamentos em cache.");
            }
            if (syncResult.success || scrapingBlocked) {
                // TimeSeriesWorker aqui: dados de fechamento disponíveis (Beta/SMA/EMA corretos)
                await timeSeriesWorker.run();
                await aiResearchService.runBatchAnalysis(null);
                try {
                    const { runBacktestAnalysis } = await import('../scripts/runBacktestEngine.js');
                    await runBacktestAnalysis();
                } catch (e) { logger.warn(`⚠️ runBacktestAnalysis (tarde): ${e.message}`); }
                try {
                    const { buildRecommendedPortfolioCurves } = await import('../scripts/recommendedPortfolioEngine.js');
                    await buildRecommendedPortfolioCurves();
                } catch (e) { logger.warn(`⚠️ Carteira Recomendada (tarde): ${e.message}`); }
            } else {
                Sentry.captureMessage(`Sync da tarde falhou (${syncResult.error || 'erro desconhecido'}) — research não rodou`, 'error');
            }
        } catch (e) {
            logger.error(`❌ Rotina Tarde V3: ${e.message}`);
            Sentry.captureException(e);
        }
    });

    // 5c. Auto-publish semanal (Segunda 09:30) — publica o ranking + Explainable IA
    // mais recente de cada classe automaticamente, para semanas sem publicação manual.
    schedule('30 9 * * 1', 'weekly-autopublish', async () => {
        try {
            await runWeeklyAutoPublish();
        } catch (e) {
            logger.error(`❌ Auto-publish semanal: ${e.message}`);
            Sentry.captureException(e);
        }
    });

    // 6. Snapshot Patrimonial Inteligente (23:59)
    schedule('59 23 * * *', 'daily-snapshot', async () => {
        await runDailySnapshot(false); // false = não força, respeita feriados
    });

    // 7. Verificação de Assinaturas (Diário 03:00 AM)
    schedule('0 3 * * *', 'subscriptions-check', async () => {
        try {
            const now = new Date();
            // Assinatura recorrente ativa ganha carência: o MP cobra na data de
            // aniversário em horário próprio e ainda retenta cobranças recusadas.
            // Rebaixar em `validUntil` cravado derrubaria assinantes adimplentes.
            // Mesma regra de isSubscriptionExpired(), aqui em forma de query.
            const graceCutoff = new Date(now.getTime() - RECURRING_GRACE_DAYS * 86_400_000);

            const res = await User.updateMany(
                {
                    plan: { $ne: 'GUEST' },
                    role: { $ne: 'ADMIN' },
                    $or: [
                        // Recorrente e não cancelada → só cai depois da carência.
                        {
                            subscriptionType: 'RECURRING',
                            subscriptionStatus: { $ne: 'CANCELED' },
                            validUntil: { $lt: graceCutoff },
                        },
                        // Avulso, cancelado ou legado (sem subscriptionType) → data cravada.
                        {
                            $or: [
                                { subscriptionType: { $ne: 'RECURRING' } },
                                { subscriptionStatus: 'CANCELED' },
                            ],
                            validUntil: { $lt: now },
                        },
                    ],
                },
                { $set: { plan: 'GUEST', subscriptionStatus: 'PAST_DUE' } }
            );
            // (I6) Reflete o downgrade em massa no cache do authMiddleware.
            if (res?.modifiedCount > 0) clearUserCache();
        } catch (error) {
            logger.error(`❌ Erro Check Expiração: ${error.message}`);
        }
    });

    // 7.1 Sync de Proventos (Diário 04:00 AM) — popula DividendEvent dos tickers
    // que aparecem nas carteiras, mantendo os proventos atualizados.
    schedule('0 4 * * *', 'dividends-sync', async () => {
        try {
            const assets = await UserAsset.find({
                type: { $nin: ['CRYPTO', 'FIXED_INCOME', 'CASH'] },
            }).select('ticker type');
            const uniq = new Map();
            assets.forEach((a) => { if (!uniq.has(a.ticker)) uniq.set(a.ticker, { ticker: a.ticker, type: a.type }); });
            if (uniq.size > 0) await financialService.syncDividends([...uniq.values()]);
        } catch (error) {
            logger.error(`❌ Erro Sync Proventos: ${error.message}`);
        }
    });

    // 8. Sync Feriados (Anual)
    schedule('0 6 1 1 *', 'holidays-sync', async () => {
        await holidayService.sync();
    });

    // 9. Fundamentals S&P 500 (dias úteis 07:30 — antes do pipeline de análise)
    schedule('30 7 * * 1-5', 'us-fundamentals', async () => {
        try {
            logger.info("⏰ [Scheduler] Sync Fundamentals S&P 500...");
            await usStocksFundamentalsService.syncUSStocksFundamentals();
            await SystemConfig.findOneAndUpdate(
                { key: 'MACRO_INDICATORS' },
                { $set: { lastUSFundamentalsSync: new Date() } },
                { upsert: true }
            );
            logger.info("✅ [Scheduler] Fundamentals S&P 500 sincronizados.");
        } catch (error) {
            logger.error(`❌ [Scheduler] Fundamentals US: ${error.message}`);
        }
    });

    // 10. Taxa USD/BRL histórica (DIÁRIO 19:45 — depois de a fonte publicar o
    // candle DO DIA e ANTES do snapshot patrimonial das 23:59, que resolve câmbio
    // POR DATA.
    //
    // Era semanal ('0 6 * * 1'). A série 'USD-BRL' então envelhecia ao longo da
    // semana (em 21/08/2026 o último candle era de 14/08) e, para todo dia após
    // o último candle, buildUsdRateResolver devolve a cotação CORRENTE — certo
    // para carimbar uma compra de hoje, mas no rebuild de histórico fazia cinco
    // dias seguidos receberem a MESMA taxa: a variação cambial do período era
    // achatada em zero e reaparecia de uma vez quando a série alcançava. Como o
    // WalletSnapshot é a base do TWRR e do Sharpe, o degrau virava ruído de risco.
    //
    // Passou de 18:10 para 19:45 depois de medir a FONTE, não o pregão: o candle
    // diário da AwesomeAPI é carimbado ~19:30 (17/08 19:30:07, 18/08 19:31:33,
    // 19/08 19:30:05, 20/08 19:30:06), e não às 17:00 do fechamento à vista. Às
    // 18:10 o job trazia D-1 e a série ficava PERMANENTEMENTE um dia atrás — o
    // gap de vários dias sumia, mas todo rebuild rodado antes das 19:30 ainda
    // marcava o dia corrente pelo spot e precisava ser refeito no dia seguinte.
    //
    // Sair de antes do 'daily-evening' (18:30) não custa nada: aquele resolve o
    // DIA CORRENTE, e para o dia corrente o resolvedor usa o spot de qualquer
    // forma — o candle do dia só passa a importar quando ele vira passado, e às
    // 19:45 ainda sobram 4h14 até o snapshot das 23:59.
    //
    // Cabe num cron próprio e leve (uma requisição HTTP devolve 730 dias) em vez
    // de entrar no 'daily-evening': aquele é `heavy` e some in-app quando
    // EXTERNAL_SCHEDULER=true — o snapshot das 23:59 ficaria sem câmbio fresco
    // justamente na configuração em que os jobs pesados saem daqui.
    //
    // Roda todo dia, não só em dia útil: a fonte só tem candle de pregão, então
    // fim de semana/feriado é uma re-merge inofensiva — e uma segunda feriado
    // não adia a atualização para terça.
    schedule('45 19 * * *', 'fx-history', async () => {
        try {
            logger.info("⏰ [Scheduler] Sync taxa USD/BRL histórica...");
            const result = await macroDataService.syncHistoricalUSDRate();
            logger.info("✅ [Scheduler] Taxa USD/BRL histórica sincronizada.", {
                dias: result?.total ?? null,
                ultimoCandle: result?.lastDate ?? null,
                fonte: result?.source ?? null,
            });
        } catch (error) {
            logger.error(`❌ [Scheduler] Sync USD/BRL histórico: ${error.message}`);
        }
    });

    // 11. REATIVAÇÃO AUTOMÁTICA DE ATIVOS INATIVOS (Toda segunda-feira 05:00)
    // Tenta reobter cotação de ativos que foram desativados por falhas consecutivas.
    // Se a cotação voltar, o ativo é reativado automaticamente sem intervenção manual.
    schedule('0 5 * * 1', 'assets-reactivation', async () => {
        try {
            logger.info("🔄 [Scheduler] Iniciando reativação automática de ativos inativos...");
            const result = await marketDataService.tryReactivateAssets();
            logger.info(`✅ [Scheduler] Reativação concluída. Reativados: ${result.reactivated}, Ainda inativos: ${result.stillInactive}`);

            await SystemConfig.findOneAndUpdate(
                { key: 'MACRO_INDICATORS' },
                { $set: { lastReactivationStats: { ...result, timestamp: new Date() } } },
                { upsert: true }
            );
        } catch (error) {
            logger.error(`❌ [Scheduler] Erro na reativação de ativos: ${error.message}`);
        }
    });

    // 12. LIMPEZA DE ARMAZENAMENTO (Diário 01:00 — janela de menor tráfego)
    // Diário (antes semanal): o pipeline grava ~14 análises/dia e o fullAuditLog só é
    // removido após 7 dias, então rodar todo dia mantém a coleção enxuta continuamente.
    schedule('0 1 * * *', 'storage-cleanup', async () => {
        try {
            const { runStorageCleanup } = await import('./cleanupService.js');
            await runStorageCleanup();
        } catch (error) {
            logger.error(`❌ [Scheduler] Cleanup de armazenamento: ${error.message}`);
        }
    });

    // 12.1 SÉRIE DE PU DO TESOURO DIRETO (dias úteis 18:30)
    // Alimenta a marcação a mercado da renda fixa. Roda DEPOIS do fechamento e
    // ANTES do snapshot das 23:59, que é quem consome a série.
    //
    // A fonte anda um dia útil atrás: o arquivo oficial é republicado na manhã do
    // dia D trazendo a Data Base D-1 (verificado em 19/08/2026 — publicação de
    // 18/08 10:20 com 17/08 na última linha), e os preços são os da MANHÃ daquele
    // pregão. Ou seja, o snapshot de D marca a RF pelo PU da manhã de D-1: é a
    // granularidade que a fonte oferece, e cabe folgada nos 10 dias corridos de
    // MAX_PU_STALE_DAYS antes de a marcação desligar. Rodar mais cedo não adianta
    // — o dia D só existe no arquivo na manhã de D+1.
    scheduleHeavy('30 18 * * 1-5', 'treasury-prices', async () => {
        try {
            const { ingestTreasuryPrices } = await import('./treasuryPriceService.js');
            const result = await ingestTreasuryPrices();
            if (!result.ok) logger.warn(`⚠️ [Scheduler] Série de PU do Tesouro não atualizada: ${result.reason}`);
        } catch (error) {
            logger.error(`❌ [Scheduler] Sync PU do Tesouro: ${error.message}`);
        }
    });

    // 13. RETENÇÃO LGPD (Diário 02:30 — complementa TTL do MongoDB, Art. 15-16)
    // O TTL index em RefreshToken.expiryDate e AuditLog.timestamp já limpa automaticamente.
    // Este job é belt-and-suspenders: remove RefreshTokens expirados não capturados pelo TTL
    // (ex.: atraso do processo TTL do MongoDB em coleções grandes).
    scheduleHeavy('30 2 * * *', 'lgpd-retention', async () => {
        try {
            const result = await RefreshToken.deleteMany({ expiryDate: { $lt: new Date() } });
            if (result.deletedCount > 0) {
                logger.info(`🧹 [LGPD] Retenção: ${result.deletedCount} RefreshToken(s) expirado(s) removido(s).`);
            }
        } catch (error) {
            logger.error(`❌ [LGPD] Cleanup RefreshToken: ${error.message}`);
        }
    });

    // 14. SENTINELA DE SAÚDE DOS DADOS (de hora em hora, minuto 10)
    //
    // Independente do sync: audita o ESTADO do banco, não a execução de quem
    // escreveu nele. É o que faz o alarme funcionar mesmo quando o sync completo
    // roda de forma irregular/manual — e é o único check que enxerga "o cron X
    // parou de rodar", já que compara o último JobRun com o teto do jobCatalog.
    //
    // Minuto 10 evita competir com os crons de :00 e com os de 15 min (:05/:15/:20…),
    // medindo o banco fora do pico de escrita.
    schedule('10 * * * *', 'data-health', async () => {
        await runDataHealthCheck({ trigger: 'CRON' });
    });

    // Primeira avaliação 45s após o boot: um deploy que quebrou ingestão não
    // deveria esperar até o próximo minuto 10 para aparecer no painel.
    setTimeout(() => {
        runDataHealthCheck({ trigger: 'CRON' }).catch((e) =>
            logger.debug(`[DataHealth] Check de boot falhou: ${e.message}`));
    }, 45000);

    return { started: true };
};
