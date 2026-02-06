
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

    // 1. Sync Leve: Macroeconomia (A cada 15 minutos com Offset)
    cron.schedule('5,20,35,50 * * * *', async () => {
        logger.info("⏰ Rotina: Sync Macroeconomia - Iniciada");
        try {
            await macroDataService.performMacroSync();
            logger.info("⏰ Rotina: Sync Macroeconomia - Finalizada");
        } catch (error) {
            logger.error(`❌ Rotina: Sync Macroeconomia - Erro: ${error.message}`);
        }
    });

    // 2. Sync Preços (Yahoo Finance - Seguro) - A cada 15 Minutos (0, 15, 30, 45)
    cron.schedule('*/15 * * * *', async () => {
        logger.info("⏰ Rotina: Atualização de Preços (Yahoo 15min) - Iniciada");
        try {
            // Busca apenas ativos ativos E líquidos OU Criptos/US
            const assets = await MarketAsset.find({ 
                isActive: true,
                $or: [
                    { liquidity: { $gt: 10000 } }, // Filtra "micos" ilíquidos
                    { type: { $in: ['CRYPTO', 'STOCK_US'] } } // Sempre atualiza crypto/us
                ]
            }).select('ticker');
            
            const tickers = assets.map(a => a.ticker);
            
            if (tickers.length === 0) {
                logger.info("ℹ️ Detalhe: Nenhum ativo para atualizar.");
                logger.info("⏰ Rotina: Atualização de Preços (Yahoo 15min) - Finalizada");
                return;
            }

            // Atualiza em lotes
            const BATCH_SIZE = 50;
            let updatedCount = 0;
            for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
                const batch = tickers.slice(i, i + BATCH_SIZE);
                await marketDataService.refreshQuotesBatch(batch);
                updatedCount += batch.length;
                await new Promise(r => setTimeout(r, 2000)); // Delay suave
            }
            logger.info(`ℹ️ Detalhe: ${updatedCount} ativos processados.`);
            logger.info("⏰ Rotina: Atualização de Preços (Yahoo 15min) - Finalizada");
        } catch (e) {
            logger.error(`❌ Rotina: Atualização de Preços (Yahoo 15min) - Erro: ${e.message}`);
        }
    });

    // 3. Sync Pesado (Fundamentus) + Cálculo - DIÁRIO (08:00 AM)
    cron.schedule('0 8 * * *', async () => {
        logger.info("⏰ Rotina: Protocolo V3 Completo (Diário) - Iniciada");
        try {
            const syncResult = await syncService.performFullSync();
            
            if (syncResult.success) {
                await aiResearchService.runBatchAnalysis(null); 
                logger.info("⏰ Rotina: Protocolo V3 Completo (Diário) - Finalizada");
            } else {
                logger.error(`❌ Rotina: Protocolo V3 Completo (Diário) - Falha no Sync: ${syncResult.error}`);
            }
        } catch (e) {
            logger.error(`❌ Rotina: Protocolo V3 Completo (Diário) - Erro Crítico: ${e.message}`);
        }
    });

    // 4. Snapshot Patrimonial Diário (23:59)
    cron.schedule('59 23 * * *', async () => {
        logger.info("⏰ Rotina: Snapshot Patrimonial Diário - Iniciada");
        try {
            const users = await User.find({}).select('_id');
            const today = new Date();
            let snapshotCount = 0;
            
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
                    snapshotCount++;
                }
            }
            logger.info(`ℹ️ Detalhe: ${snapshotCount} snapshots gerados.`);
            logger.info("⏰ Rotina: Snapshot Patrimonial Diário - Finalizada");
        } catch (error) {
            logger.error(`❌ Rotina: Snapshot Patrimonial Diário - Erro: ${error.message}`);
        }
    });

    // 5. Sync Feriados (Anual - 1 de Janeiro 06:00)
    cron.schedule('0 6 1 1 *', async () => {
        logger.info("⏰ Rotina: Sync Feriados Anual - Iniciada");
        try {
            await holidayService.sync();
            logger.info("⏰ Rotina: Sync Feriados Anual - Finalizada");
        } catch (e) {
            logger.error(`❌ Rotina: Sync Feriados Anual - Erro: ${e.message}`);
        }
    });
};
