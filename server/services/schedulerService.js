
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
import { signalEngine } from './engines/signalEngine.js';
import MarketAsset from '../models/MarketAsset.js';
import MarketAnalysis from '../models/MarketAnalysis.js';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import AssetTransaction from '../models/AssetTransaction.js';
import SystemConfig from '../models/SystemConfig.js'; // IMPORTADO
import RefreshToken from '../models/RefreshToken.js';
import { createBroadcast } from './notificationService.js';
import { calculateDailyDietz } from '../utils/mathUtils.js';
import { accrueFixedIncomeValue } from '../utils/fixedIncome.js';

import { timeSeriesWorker } from './workers/timeSeriesWorker.js';
import { usStocksFundamentalsService } from './usStocksFundamentalsService.js';

// (TZ) Todos os crons rodam em horário de Brasília. Sem o timezone explícito,
// node-cron usa o fuso do servidor (UTC no Render), fazendo '30 18' disparar
// às 15:30 BRT em vez de 18:30. Wrapper centraliza isso em todas as chamadas.
const SCHEDULER_TZ = 'America/Sao_Paulo';
const schedule = (expression, fn) => cron.schedule.call(cron, expression, fn, { timezone: SCHEDULER_TZ });

// (EXTERNAL_SCHEDULER) Os jobs pesados (sync pós-mercado + snapshot) podem ser
// rodados por Render Cron Jobs — independentes do web service, que hiberna e
// perde execuções. Defina EXTERNAL_SCHEDULER=true no web service para desativar
// essas rotinas in-app e evitar execução dupla. Default = roda in-app (atual).
const EXTERNAL_SCHEDULER = process.env.EXTERNAL_SCHEDULER === 'true';
const scheduleHeavy = (expression, fn) => {
    if (EXTERNAL_SCHEDULER) {
        logger.info(`⏭️ Cron pesado '${expression}' desativado in-app (EXTERNAL_SCHEDULER=true → Render Cron Job).`);
        return null;
    }
    return schedule(expression, fn);
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
const brDayStr = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
// Date à meia-noite UTC do dia BR — calcDate do accrual de renda fixa.
const brCalcDate = (dayStr) => new Date(`${dayStr}T00:00:00.000Z`);
// Dia útil a partir da STRING do dia BR — independente do fuso do servidor.
// getUTCDay() sobre a âncora ao meio-dia UTC dá o dia da semana correto do dia BR;
// o feriado é checado pela própria string YYYY-MM-DD. (isBusinessDay usa getDay()
// local, que só é correto num servidor UTC — evitamos essa dependência aqui.)
export const isBrBusinessDay = (dayStr) => {
    const dow = new Date(`${dayStr}T12:00:00.000Z`).getUTCDay(); // 0=Dom .. 6=Sáb
    if (dow === 0 || dow === 6) return false;
    return !holidayService.isHoliday(dayStr);
};
// Instante gravado no snapshot: 23:59 BRT do dia — garante que o gráfico (que
// bucketiza por dia LOCAL no browser BRT) coloque o ponto no dia correto.
const brSnapshotInstant = (dayStr) => new Date(`${dayStr}T23:59:00.000-03:00`);
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

// Contexto compartilhado (macro + cotações em lote) de um run de snapshot.
const loadSnapshotContext = async () => {
    const sysConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    const usdRate = sysConfig?.dollar || 5.75;
    const currentCdi = (sysConfig?.cdi > 0 ? sysConfig.cdi : null) || (sysConfig?.selic > 0 ? sysConfig.selic : null) || DEFAULT_SELIC_FALLBACK;
    const macroRates = { cdiRate: currentCdi, selic: sysConfig?.selic, ipca: sysConfig?.ipca };
    // (F4) Cotações em LOTE, uma vez por run — evita N+1 de getMarketDataByTicker.
    const liveTickers = await UserAsset.distinct('ticker', { type: { $nin: ['CASH', 'FIXED_INCOME'] } });
    const priceMap = await marketDataService.getMarketDataMap(liveTickers);
    return { usdRate, macroRates, priceMap };
};

// Patrimônio (equity/invested) de um conjunto de ativos numa data de cálculo.
// Renda fixa/caixa: accrual exato via fonte única (utils/fixedIncome). Renda
// variável: cotação do priceMap (para dias recuperados, é a cotação corrente —
// aproximação aceitável para um gap de poucos dias, protegida pelo circuit breaker).
const computeEquityAt = (assets, { priceMap, macroRates, usdRate, calcDate }) => {
    let totalEquity = 0;
    let totalInvested = 0;
    for (const asset of assets) {
        const multiplier = (asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO') ? usdRate : 1;
        if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
            totalEquity += accrueFixedIncomeValue(asset, { ...macroRates, calcDate });
            totalInvested += asset.totalCost;
        } else {
            const price = priceMap.get(asset.ticker)?.price || 0;
            if (price > 0) {
                totalEquity += asset.quantity * price * multiplier;
                totalInvested += asset.totalCost * multiplier;
            }
        }
    }
    return { totalEquity, totalInvested };
};

// Persiste UM snapshot de um usuário para um dia BR específico.
// - Idempotente por (user, dia BR): se já existe snapshot no dia, retorna 'exists'
//   (a menos de force, que substitui). Evita duplicata entre catch-up, cron in-app
//   e Render Cron Job.
// - Mantém a cadeia de cotas (TWRR) buscando o snapshot imediatamente ANTERIOR ao dia.
// Retorna: 'created' | 'exists' | 'empty' | 'anomaly' | 'reset-guard'.
const persistUserSnapshotForDay = async (user, dayStr, ctx, { assets = null, force = false } = {}) => {
    const { priceMap, macroRates, usdRate } = ctx;
    const bounds = brDayBounds(dayStr);
    const calcDate = brCalcDate(dayStr);

    if (!force) {
        const existing = await WalletSnapshot.exists({ user: user._id, date: { $gte: bounds.start, $lte: bounds.end } });
        if (existing) return 'exists';
    }

    const positions = assets || await UserAsset.find({ user: user._id });
    const { totalEquity, totalInvested } = computeEquityAt(positions, { priceMap, macroRates, usdRate, calcDate });
    if (!(totalEquity > 0)) return 'empty';

    // Snapshot anterior (cota/Dietz) — estritamente antes deste dia BR.
    const lastSnapshot = await WalletSnapshot.findOne({ user: user._id, date: { $lt: bounds.start } }).sort({ date: -1 });

    // Fluxo de caixa DO DIA (aportes/retiradas), no fuso BR.
    const transactions = await AssetTransaction.find({ user: user._id, date: { $gte: bounds.start, $lte: bounds.end } });
    let dayFlow = 0;
    transactions.forEach(tx => {
        if (tx.type === 'BUY') dayFlow += tx.totalValue;
        if (tx.type === 'SELL') dayFlow -= tx.totalValue;
    });

    let quotaPrice = 100;
    const v0 = lastSnapshot ? lastSnapshot.totalEquity : 0;
    if (v0 > 0 || dayFlow > 0) {
        const dailyReturn = calculateDailyDietz(v0, totalEquity, dayFlow);
        // Circuit breaker: rejeita variação diária absurda (dado corrompido).
        if (Math.abs(dailyReturn) > 0.5) {
            logger.warn(`⚠️ Anomalia TWRR ${user._id} @ ${dayStr}: ${(dailyReturn * 100).toFixed(2)}%. Snapshot ignorado.`);
            if (process.env.SENTRY_DSN) {
                Sentry.captureMessage(`TWRR Anomaly: User ${user._id} @ ${dayStr} = ${dailyReturn.toFixed(2)}%. Skipped.`);
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
            : await WalletSnapshot.exists({ user: user._id });
        if (hasHistory) {
            logger.error(`❌ Cota resetou p/ 100 indevidamente ${user._id} @ ${dayStr}. Snapshot abortado.`);
            return 'reset-guard';
        }
    }

    const divData = await financialService.calculateUserDividends(user._id);
    const totalDividends = divData.totalAllTime;

    if (force) {
        await WalletSnapshot.deleteMany({ user: user._id, date: { $gte: bounds.start, $lte: bounds.end } });
    }
    await WalletSnapshot.create({
        user: user._id,
        date: brSnapshotInstant(dayStr),
        totalEquity,
        totalInvested,
        totalDividends,
        profit: totalEquity - totalInvested + totalDividends,
        profitPercent: totalInvested > 0 ? ((totalEquity - totalInvested + totalDividends) / totalInvested) * 100 : 0,
        quotaPrice,
    });
    return 'created';
};

// Recupera dias úteis PERDIDOS de um usuário (entre o último snapshot e hoje,
// exclusivo). node-cron não reexecuta ticks perdidos (deploy/reinício/erro
// transitório sobre 23:59) — este catch-up é a rede de segurança que fecha os
// buracos, com data retroativa correta e accrual exato de renda fixa.
const backfillUserGap = async (user, todayStr, ctx, assets) => {
    const last = await WalletSnapshot.findOne({ user: user._id }).sort({ date: -1 });
    if (!last) return 0; // sem histórico: o fluxo normal cuida do 1º snapshot
    const lastDayStr = brDayStr(new Date(last.date));
    const missing = businessDaysBetween(lastDayStr, todayStr).slice(-CATCHUP_MAX_DAYS);
    let created = 0;
    for (const dayStr of missing) {
        const r = await persistUserSnapshotForDay(user, dayStr, ctx, { assets, force: false });
        if (r === 'created') { created++; logger.info(`🩹 Backfill snapshot ${user.email || user._id} @ ${dayStr}`); }
    }
    return created;
};

// Varredura de recuperação (boot / pré-run diário) sem tocar no dia de hoje.
export const backfillMissedSnapshots = async () => {
    try {
        const todayStr = brDayStr(new Date());
        const ctx = await loadSnapshotContext();
        const users = await User.find({}).select('_id email');
        let created = 0;
        for (const user of users) {
            try {
                created += await backfillUserGap(user, todayStr, ctx, null);
            } catch (e) {
                logger.error(`Backfill erro user ${user._id}: ${e.message}`);
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
        const ctx = await loadSnapshotContext();
        const users = await User.find({}).select('_id email');

        let snapshotsCreated = 0;
        let snapshotsSkipped = 0;
        let backfilled = 0;

        for (const user of users) {
            try {
                // Posições buscadas uma vez por usuário (reuso no catch-up + hoje).
                const assets = await UserAsset.find({ user: user._id });

                // 1) Recupera dias úteis anteriores faltantes (self-healing).
                backfilled += await backfillUserGap(user, todayStr, ctx, assets);

                // 2) Snapshot de HOJE (idempotente; respeita force).
                const r = await persistUserSnapshotForDay(user, todayStr, ctx, { assets, force });
                if (r === 'created') snapshotsCreated++;
                else snapshotsSkipped++;
            } catch (userErr) {
                logger.error(`Erro snapshot user ${user._id}: ${userErr.message}`);
                if (process.env.SENTRY_DSN) Sentry.captureException(userErr);
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
export const validateAutoPublish = (analysis, now = new Date()) => {
    const count = analysis?.content?.ranking?.length || 0;
    if (count < AUTO_PUBLISH_MIN_ASSETS) {
        return { ok: false, reason: `ranking com ${count} ativos (mínimo ${AUTO_PUBLISH_MIN_ASSETS})` };
    }
    const ageMs = now.getTime() - new Date(analysis.createdAt || 0).getTime();
    if (ageMs > AUTO_PUBLISH_MAX_AGE_DAYS * 86400000) {
        return { ok: false, reason: `ranking gerado há ${Math.round(ageMs / 86400000)} dias (máximo ${AUTO_PUBLISH_MAX_AGE_DAYS})` };
    }
    return { ok: true };
};

export const runWeeklyAutoPublish = async () => {
    logger.info("📢 Auto-publish semanal — publicando rankings mais recentes");
    const published = [];
    for (const assetClass of AUTO_PUBLISH_CLASSES) {
        try {
            const latest = await MarketAnalysis.findOne({ assetClass, strategy: 'BUY_HOLD' }).sort({ createdAt: -1 });
            if (!latest) continue;
            const gate = validateAutoPublish(latest);
            if (!gate.ok) {
                logger.warn(`🚫 Auto-publish BLOQUEADO (${assetClass}): ${gate.reason}`);
                Sentry.captureMessage(`Auto-publish bloqueado (${assetClass}): ${gate.reason}`, 'warning');
                continue;
            }
            const wasPublished = latest.isRankingPublished;
            latest.isRankingPublished = true;
            latest.isExplainableAIPublished = true;
            latest.isReportPublished = true;
            await latest.save();
            if (!wasPublished) {
                published.push(assetClass);
                const label = ASSET_CLASS_LABELS[assetClass] || assetClass;
                createBroadcast({
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
    logger.info("⏰ Scheduler Service Inicializado");

    // (RESILIÊNCIA) Recuperação de snapshots perdidos no BOOT. Um deploy/reinício
    // que caia sobre 23:59 BRT não reexecuta o tick do cron — este catch-up fecha
    // o buraco no próximo start. Fire-and-forget após 15s (deixa o boot assentar).
    setTimeout(() => {
        backfillMissedSnapshots().catch((e) => logger.error(`Backfill boot: ${e.message}`));
    }, 15000);

    // 1. Sync Leve: Macroeconomia (A cada 15 minutos)
    schedule('5,20,35,50 * * * *', async () => {
        try {
            await macroDataService.performMacroSync();
        } catch (error) {
            logger.error(`❌ Rotina Macro: ${error.message}`);
        }
    });

    // 2. Sync Preços (Yahoo/Brapi 15min)
    schedule('*/15 * * * *', async () => {
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
    schedule('2,17,32,47 * * * *', async () => {
        try {
            await signalEngine.runScanner();
        } catch (e) {
            logger.error(`❌ Rotina Radar Alpha: ${e.message}`);
        }
    });

    // 4. BACKTEST INTRADAY
    schedule('5,35 * * * *', async () => {
        try {
            await signalEngine.runBacktest();
        } catch (e) {
            logger.error(`❌ Rotina Backtest: ${e.message}`);
        }
    });

    // 5a. Sync Manhã (09:00) — dados do pregão anterior consolidados, antes de abrir
    schedule('0 9 * * *', async () => {
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
    scheduleHeavy('30 18 * * *', async () => {
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
    schedule('30 9 * * 1', async () => {
        try {
            await runWeeklyAutoPublish();
        } catch (e) {
            logger.error(`❌ Auto-publish semanal: ${e.message}`);
            Sentry.captureException(e);
        }
    });

    // 6. Snapshot Patrimonial Inteligente (23:59)
    schedule('59 23 * * *', async () => {
        await runDailySnapshot(false); // false = não força, respeita feriados
    });

    // 7. Verificação de Assinaturas (Diário 03:00 AM)
    schedule('0 3 * * *', async () => {
        try {
            const now = new Date();
            const res = await User.updateMany(
                {
                    plan: { $ne: 'GUEST' },
                    role: { $ne: 'ADMIN' },
                    validUntil: { $lt: now }
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
    schedule('0 4 * * *', async () => {
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
    schedule('0 6 1 1 *', async () => {
        await holidayService.sync();
    });

    // 9. Fundamentals S&P 500 (dias úteis 07:30 — antes do pipeline de análise)
    schedule('30 7 * * 1-5', async () => {
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

    // 10. Taxa USD/BRL histórica (toda segunda-feira 06:00 — antes dos outros syncs)
    schedule('0 6 * * 1', async () => {
        try {
            logger.info("⏰ [Scheduler] Sync taxa USD/BRL histórica...");
            await macroDataService.syncHistoricalUSDRate();
            logger.info("✅ [Scheduler] Taxa USD/BRL histórica sincronizada.");
        } catch (error) {
            logger.error(`❌ [Scheduler] Sync USD/BRL histórico: ${error.message}`);
        }
    });

    // 11. REATIVAÇÃO AUTOMÁTICA DE ATIVOS INATIVOS (Toda segunda-feira 05:00)
    // Tenta reobter cotação de ativos que foram desativados por falhas consecutivas.
    // Se a cotação voltar, o ativo é reativado automaticamente sem intervenção manual.
    schedule('0 5 * * 1', async () => {
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
    schedule('0 1 * * *', async () => {
        try {
            const { runStorageCleanup } = await import('./cleanupService.js');
            await runStorageCleanup();
        } catch (error) {
            logger.error(`❌ [Scheduler] Cleanup de armazenamento: ${error.message}`);
        }
    });

    // 13. RETENÇÃO LGPD (Diário 02:30 — complementa TTL do MongoDB, Art. 15-16)
    // O TTL index em RefreshToken.expiryDate e AuditLog.timestamp já limpa automaticamente.
    // Este job é belt-and-suspenders: remove RefreshTokens expirados não capturados pelo TTL
    // (ex.: atraso do processo TTL do MongoDB em coleções grandes).
    scheduleHeavy('30 2 * * *', async () => {
        try {
            const result = await RefreshToken.deleteMany({ expiryDate: { $lt: new Date() } });
            if (result.deletedCount > 0) {
                logger.info(`🧹 [LGPD] Retenção: ${result.deletedCount} RefreshToken(s) expirado(s) removido(s).`);
            }
        } catch (error) {
            logger.error(`❌ [LGPD] Cleanup RefreshToken: ${error.message}`);
        }
    });
};
