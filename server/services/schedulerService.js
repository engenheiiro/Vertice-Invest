
import cron from 'node-cron';
import logger from '../config/logger.js';
import { aiResearchService } from './aiResearchService.js'; 
import { macroDataService } from './macroDataService.js';
import { marketDataService } from './marketDataService.js';
import { syncService } from './syncService.js';
import { holidayService } from './holidayService.js'; 
import MarketAsset from '../models/MarketAsset.js';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';

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

    // 2. Sync Preços (Yahoo 15min)
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

    // 3. Sync Pesado + Cálculo (Diário 08:00)
    cron.schedule('0 8 * * *', async () => {
        logger.info("⏰ Rotina Diária V3 Iniciada");
        try {
            const syncResult = await syncService.performFullSync();
            if (syncResult.success) {
                await aiResearchService.runBatchAnalysis(null); 
            }
        } catch (e) {
            logger.error(`❌ Rotina Diária V3: ${e.message}`);
        }
    });

    // 4. Snapshot Patrimonial (23:59)
    cron.schedule('59 23 * * *', async () => {
        try {
            const users = await User.find({}).select('_id');
            const today = new Date();
            
            for (const user of users) {
                const assets = await UserAsset.find({ user: user._id });
                let totalEquity = 0;
                let totalInvested = 0;
                
                for (const asset of assets) {
                    const marketData = await marketDataService.getMarketDataByTicker(asset.ticker);
                    const price = marketData.price;
                    const multiplier = asset.currency === 'USD' ? 5.75 : 1; 
                    
                    if (price > 0) {
                        totalEquity += asset.quantity * price * multiplier;
                        totalInvested += asset.totalCost * multiplier;
                    }
                }

                if (totalEquity > 0) {
                    await WalletSnapshot.create({
                        user: user._id,
                        date: today,
                        totalEquity,
                        totalInvested,
                        profit: totalEquity - totalInvested,
                        profitPercent: totalInvested > 0 ? ((totalEquity - totalInvested) / totalInvested) * 100 : 0
                    });
                }
            }
        } catch (error) {
            logger.error(`❌ Snapshot Erro: ${error.message}`);
        }
    });

    // 5. Verificação de Assinaturas Vencidas (Diário 03:00 AM)
    cron.schedule('0 3 * * *', async () => {
        logger.info("⏰ Rotina: Check Expiração de Assinaturas");
        try {
            const now = new Date();
            // Busca usuários PRO/BLACK cuja data de validade já passou
            const result = await User.updateMany(
                { 
                    plan: { $ne: 'GUEST' },
                    role: { $ne: 'ADMIN' }, // Admins nunca expiram
                    validUntil: { $lt: now } 
                },
                { 
                    $set: { 
                        plan: 'GUEST', 
                        subscriptionStatus: 'PAST_DUE' 
                    } 
                }
            );
            
            if (result.modifiedCount > 0) {
                logger.info(`📉 ${result.modifiedCount} usuários tiveram o plano rebaixado para GUEST por vencimento.`);
            }
        } catch (error) {
            logger.error(`❌ Erro Check Expiração: ${error.message}`);
        }
    });

    // 6. Sync Feriados (Anual)
    cron.schedule('0 6 1 1 *', async () => {
        await holidayService.sync();
    });
};
