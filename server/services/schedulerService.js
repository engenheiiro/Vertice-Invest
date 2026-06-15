
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
import { isBusinessDay, countBusinessDays } from '../utils/dateUtils.js';

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
export const runDailySnapshot = async (force = false) => {
    const today = new Date();
    
    // --- DETECÇÃO DE FERIADOS E FIM DE SEMANA ---
    // Se force = true, ignora a validação de dia útil
    if (!force && !isBusinessDay(today)) {
        logger.info("⏸️ Snapshot Diário ignorado: Dia não útil (Feriado ou Fim de Semana).");
        return { status: 'SKIPPED', reason: 'Non-business day' };
    }

    logger.info(`📸 Iniciando Snapshot Patrimonial Diário (Auditado) [Force: ${force}]...`);
    try {
        const users = await User.find({}).select('_id email');
        const startOfDay = new Date(today); startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(today); endOfDay.setHours(23,59,59,999);
        
        let snapshotsCreated = 0;
        let snapshotsSkipped = 0;

        const sysConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        const usdRate = sysConfig?.dollar || 5.75;
        const currentCdi = (sysConfig?.cdi > 0 ? sysConfig.cdi : null) || (sysConfig?.selic > 0 ? sysConfig.selic : null) || DEFAULT_SELIC_FALLBACK;
        const todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(today);
        const calcDate = new Date(todayDateStr + 'T00:00:00.000Z');

        for (const user of users) {
            try {
                // 1. Calcula Patrimônio Atual
                const assets = await UserAsset.find({ user: user._id });
                let totalEquity = 0;
                let totalInvested = 0;

                for (const asset of assets) {
                    let price = 0;
                    const multiplier = (asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO') ? usdRate : 1;

                    if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
                        // Calcula valor atual com juros compostos (mesma lógica do walletController)
                        const rawRate = asset.fixedIncomeRate > 0 ? asset.fixedIncomeRate : 100;
                        const selicDailyFactor = Math.pow(1 + (currentCdi / 100), 1 / 252);
                        let effectiveDailyFactor;
                        if (rawRate > 50) {
                            // Taxa em % do CDI (ex: 100 = 100% do CDI)
                            effectiveDailyFactor = ((selicDailyFactor - 1) * (rawRate / 100)) + 1;
                        } else {
                            // Taxa prefixada anual (ex: 12.5%)
                            effectiveDailyFactor = Math.pow(1 + (rawRate / 100), 1 / 252);
                        }

                        let accruedValue = 0;
                        if (asset.taxLots && asset.taxLots.length > 0) {
                            for (const lot of asset.taxLots) {
                                const lotDate = new Date(new Date(lot.date).toISOString().split('T')[0] + 'T00:00:00.000Z');
                                const bDays = countBusinessDays(lotDate, calcDate);
                                const factor = Math.max(1, Math.pow(effectiveDailyFactor, bDays));
                                accruedValue += asset.type === 'CASH'
                                    ? lot.quantity * factor
                                    : lot.quantity * lot.price * factor;
                            }
                        } else {
                            // Fallback sem tax lots
                            const startDate = new Date(new Date(asset.startDate || asset.updatedAt).toISOString().split('T')[0] + 'T00:00:00.000Z');
                            const bDays = countBusinessDays(startDate, calcDate);
                            const factor = Math.max(1, Math.pow(effectiveDailyFactor, bDays));
                            const avgPrice = asset.quantity > 0 ? asset.totalCost / asset.quantity : 0;
                            accruedValue = asset.type === 'CASH'
                                ? asset.quantity * factor
                                : asset.quantity * avgPrice * factor;
                        }

                        totalEquity += accruedValue;
                        totalInvested += asset.totalCost;
                    } else {
                        const marketData = await marketDataService.getMarketDataByTicker(asset.ticker);
                        price = marketData.price;
                        if (price > 0) {
                            totalEquity += asset.quantity * price * multiplier;
                            totalInvested += asset.totalCost * multiplier;
                        }
                    }
                }

                if (totalEquity > 0) {
                    // 2. Busca Snapshot Anterior para calcular Cota (TWRR)
                    const lastSnapshot = await WalletSnapshot.findOne({ user: user._id }).sort({ date: -1 });
                    
                    let quotaPrice = 100; // Base inicial
                    let dailyReturn = 0;
                    let isValidSnapshot = true;
                    
                    // 3. Calcula Fluxo de Caixa do Dia (Aportes/Retiradas)
                    const transactions = await AssetTransaction.find({
                        user: user._id,
                        date: { $gte: startOfDay, $lte: endOfDay }
                    });

                    let dayFlow = 0;
                    transactions.forEach(tx => {
                        if (tx.type === 'BUY') dayFlow += tx.totalValue;
                        if (tx.type === 'SELL') dayFlow -= tx.totalValue;
                    });

                    const v0 = lastSnapshot ? lastSnapshot.totalEquity : 0;
                    const v1 = totalEquity;
                    const f = dayFlow;
                    
                    if (v0 > 0 || f > 0) {
                        dailyReturn = calculateDailyDietz(v0, v1, f);
                            
                        // --- VALIDAÇÃO DE SEGURANÇA (Circuit Breaker) ---
                        if (Math.abs(dailyReturn) > 0.5) {
                            logger.warn(`⚠️ Anomalia TWRR detectada para ${user._id}: ${(dailyReturn * 100).toFixed(2)}%. Snapshot ignorado.`);
                            if (process.env.SENTRY_DSN) {
                                Sentry.captureMessage(`TWRR Anomaly: User ${user._id} had ${dailyReturn.toFixed(2)}% variance. Snapshot skipped.`);
                            }
                            isValidSnapshot = false;
                            snapshotsSkipped++;
                        } else {
                            const prevQuota = lastSnapshot ? (lastSnapshot.quotaPrice || 100) : 100;
                            quotaPrice = prevQuota * (1 + dailyReturn);
                        }
                    }

                    // Proteção contra Reset Indevido
                    // Cobre dois casos:
                    // 1. lastSnapshot existe e quotaPrice caiu para ~100 (reset clássico)
                    // 2. lastSnapshot é null MAS existem snapshots anteriores no banco —
                    //    isso indica que o findOne falhou ou a conta foi recriada; salvar
                    //    quota=100 agora apagaria o histórico real.
                    if (Math.abs(quotaPrice - 100) < 0.1) {
                        const hasHistory = lastSnapshot
                            ? Math.abs(lastSnapshot.quotaPrice - 100) > 5
                            : await WalletSnapshot.exists({ user: user._id });

                        if (hasHistory) {
                            logger.error(`❌ Erro Crítico: Cota resetou para 100 indevidamente para ${user._id}. Snapshot abortado.`);
                            isValidSnapshot = false;
                            snapshotsSkipped++;
                        }
                    }

                    if (isValidSnapshot) {
                        // 4. Busca Dividendos Totais para o Snapshot Histórico
                        const divData = await financialService.calculateUserDividends(user._id);
                        const totalDividends = divData.totalAllTime;

                        // Se for forçado, deleta snapshot existente do dia para evitar duplicata (Upsert Logic Simplificada)
                        if (force) {
                            await WalletSnapshot.deleteMany({ 
                                user: user._id, 
                                date: { $gte: startOfDay, $lte: endOfDay } 
                            });
                        }

                        await WalletSnapshot.create({
                            user: user._id,
                            date: today,
                            totalEquity,
                            totalInvested,
                            totalDividends,
                            profit: totalEquity - totalInvested + totalDividends,
                            profitPercent: totalInvested > 0 ? ((totalEquity - totalInvested + totalDividends) / totalInvested) * 100 : 0,
                            quotaPrice: quotaPrice 
                        });
                        snapshotsCreated++;
                    }
                }
            } catch (userErr) {
                logger.error(`Erro snapshot user ${user._id}: ${userErr.message}`);
            }
        }
        
        const stats = {
            created: snapshotsCreated,
            skipped: snapshotsSkipped,
            timestamp: new Date()
        };

        // PERSISTÊNCIA DO RELATÓRIO NO SYSTEM CONFIG
        await SystemConfig.findOneAndUpdate(
            { key: 'MACRO_INDICATORS' },
            { $set: { lastSnapshotStats: stats } },
            { upsert: true }
        );

        logger.info(`✅ Snapshot Finalizado. Criados: ${snapshotsCreated}, Ignorados (Proteção): ${snapshotsSkipped}`);
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
const AUTO_PUBLISH_CLASSES = ['BRASIL_10', 'STOCK', 'FII', 'CRYPTO', 'STOCK_US'];
const ASSET_CLASS_LABELS = {
    STOCK: 'Ações BR', FII: 'FIIs', CRYPTO: 'Cripto',
    STOCK_US: 'Ações EUA', BRASIL_10: 'Brasil 10',
};

export const runWeeklyAutoPublish = async () => {
    logger.info("📢 Auto-publish semanal — publicando rankings mais recentes");
    const published = [];
    for (const assetClass of AUTO_PUBLISH_CLASSES) {
        try {
            const latest = await MarketAnalysis.findOne({ assetClass, strategy: 'BUY_HOLD' }).sort({ createdAt: -1 });
            if (!latest) continue;
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
                    { type: { $in: ['CRYPTO', 'STOCK_US'] } }
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
            if (syncResult.success) {
                await aiResearchService.runBatchAnalysis(null);
                // Carteira Recomendada — curva contínua event-driven (não-crítica)
                try {
                    const { buildRecommendedPortfolioCurves } = await import('../scripts/recommendedPortfolioEngine.js');
                    await buildRecommendedPortfolioCurves();
                } catch (e) { logger.warn(`⚠️ Carteira Recomendada (manhã): ${e.message}`); }
            }
        } catch (e) {
            logger.error(`❌ Rotina Manhã V3: ${e.message}`);
        }
    });

    // 5b. Sync Tarde/Pós-Mercado (18:30) — B3 fecha às 17:30, dados completos do dia
    scheduleHeavy('30 18 * * *', async () => {
        logger.info("⏰ Rotina Diária V3 — Pós-Mercado (18:30)");
        try {
            const syncResult = await syncService.performFullSync();
            if (syncResult.success) {
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
            }
        } catch (e) {
            logger.error(`❌ Rotina Tarde V3: ${e.message}`);
        }
    });

    // 5c. Auto-publish semanal (Segunda 09:30) — publica o ranking + Explainable IA
    // mais recente de cada classe automaticamente, para semanas sem publicação manual.
    schedule('30 9 * * 1', async () => {
        try {
            await runWeeklyAutoPublish();
        } catch (e) {
            logger.error(`❌ Auto-publish semanal: ${e.message}`);
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

    // 12. LIMPEZA DE ARMAZENAMENTO (Domingo 01:00 — janela de menor tráfego)
    schedule('0 1 * * 0', async () => {
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
