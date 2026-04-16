
import cron from 'node-cron';
import * as Sentry from "@sentry/node"; // Import Sentry
import logger from '../config/logger.js';
import { aiResearchService } from './aiResearchService.js'; 
import { macroDataService } from './macroDataService.js';
import { marketDataService } from './marketDataService.js';
import { syncService } from './syncService.js';
import { holidayService } from './holidayService.js';
import { signalEngine } from './engines/signalEngine.js';
import MarketAsset from '../models/MarketAsset.js';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import AssetTransaction from '../models/AssetTransaction.js'; 
import SystemConfig from '../models/SystemConfig.js'; // IMPORTADO
import { calculateDailyDietz } from '../utils/mathUtils.js';
import { isBusinessDay } from '../utils/dateUtils.js';

import { timeSeriesWorker } from './workers/timeSeriesWorker.js';

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

        for (const user of users) {
            try {
                // 1. Calcula Patrimônio Atual
                const assets = await UserAsset.find({ user: user._id });
                let totalEquity = 0;
                let totalInvested = 0;
                
                for (const asset of assets) {
                    let price = 0;
                    const multiplier = asset.currency === 'USD' ? 5.75 : 1; 

                    if (asset.type === 'CASH') {
                        price = 1;
                        totalEquity += asset.quantity; 
                        totalInvested += asset.totalCost;
                    } else if (asset.type === 'FIXED_INCOME') {
                        price = asset.averagePrice; // Simplificação para snapshot noturno
                        totalEquity += asset.quantity * price;
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
                    if (lastSnapshot && Math.abs(quotaPrice - 100) < 0.1 && Math.abs(lastSnapshot.quotaPrice - 100) > 5) {
                            logger.error(`❌ Erro Crítico: Cota resetou para 100 indevidamente para ${user._id}. Snapshot abortado.`);
                            isValidSnapshot = false;
                            snapshotsSkipped++;
                    }

                    if (isValidSnapshot) {
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
                            profit: totalEquity - totalInvested,
                            profitPercent: totalInvested > 0 ? ((totalEquity - totalInvested) / totalInvested) * 100 : 0,
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

export const initScheduler = () => {
    logger.info("⏰ Scheduler Service Inicializado");

    // 1. Sync Leve: Macroeconomia (A cada 15 minutos)
    cron.schedule('5,20,35,50 * * * *', async () => {
        try {
            await macroDataService.performMacroSync();
        } catch (error) {
            logger.error(`❌ Rotina Macro: ${error.message}`);
        }
    });

    // 2. Sync Preços (Yahoo/Brapi 15min)
    cron.schedule('*/15 * * * *', async () => {
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
    cron.schedule('2,17,32,47 * * * *', async () => {
        try {
            await signalEngine.runScanner();
        } catch (e) {
            logger.error(`❌ Rotina Radar Alpha: ${e.message}`);
        }
    });

    // 4. BACKTEST INTRADAY
    cron.schedule('5,35 * * * *', async () => {
        try {
            await signalEngine.runBacktest();
        } catch (e) {
            logger.error(`❌ Rotina Backtest: ${e.message}`);
        }
    });

    // 5. Sync Pesado + Cálculo (Diário 08:00)
    cron.schedule('0 8 * * *', async () => {
        logger.info("⏰ Rotina Diária V3 Iniciada");
        try {
            const syncResult = await syncService.performFullSync();
            if (syncResult.success) {
                await timeSeriesWorker.run(); // Roda o worker após o sync
                await aiResearchService.runBatchAnalysis(null); 
            }
        } catch (e) {
            logger.error(`❌ Rotina Diária V3: ${e.message}`);
        }
    });

    // 6. Snapshot Patrimonial Inteligente (23:59)
    cron.schedule('59 23 * * *', async () => {
        await runDailySnapshot(false); // false = não força, respeita feriados
    });

    // 7. Verificação de Assinaturas (Diário 03:00 AM)
    cron.schedule('0 3 * * *', async () => {
        try {
            const now = new Date();
            await User.updateMany(
                { 
                    plan: { $ne: 'GUEST' },
                    role: { $ne: 'ADMIN' }, 
                    validUntil: { $lt: now } 
                },
                { $set: { plan: 'GUEST', subscriptionStatus: 'PAST_DUE' } }
            );
        } catch (error) {
            logger.error(`❌ Erro Check Expiração: ${error.message}`);
        }
    });

    // 8. Sync Feriados (Anual)
    cron.schedule('0 6 1 1 *', async () => {
        await holidayService.sync();
    });
};
