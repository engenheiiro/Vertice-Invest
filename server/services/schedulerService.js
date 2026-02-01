
import cron from 'node-cron';
import logger from '../config/logger.js';
import { aiResearchService } from './aiResearchService.js'; 
import { macroDataService } from './macroDataService.js';
import { marketDataService } from './marketDataService.js';
import { syncService } from './syncService.js';
import MarketAsset from '../models/MarketAsset.js';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';

export const initScheduler = () => {
    logger.info("⏰ Scheduler Service Inicializado");

    // 1. Sync Leve: Macroeconomia (A cada 30 minutos)
    cron.schedule('*/30 * * * *', async () => {
        logger.info("⏰ Rotina: Sync Leve (Macro)");
        try {
            await macroDataService.performMacroSync();
        } catch (error) {
            logger.error(`Erro Sync Macro: ${error.message}`);
        }
    });

    // 2. Sync Preços (Yahoo Finance - Seguro) - A cada 1 Hora
    // Mantém cotações atualizadas sem fazer scraping pesado
    cron.schedule('0 * * * *', async () => {
        logger.info("⏰ Rotina: Atualização de Preços (Yahoo)...");
        try {
            // Busca todos os ativos monitorados
            const assets = await MarketAsset.find({ isActive: true }).select('ticker');
            const tickers = assets.map(a => a.ticker);
            
            // Atualiza em lotes
            const BATCH_SIZE = 50;
            for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
                const batch = tickers.slice(i, i + BATCH_SIZE);
                await marketDataService.refreshQuotesBatch(batch);
                await new Promise(r => setTimeout(r, 2000)); // Delay suave
            }
            logger.info("✅ Preços atualizados.");
        } catch (e) {
            logger.error(`Erro Sync Preços: ${e.message}`);
        }
    });

    // 3. Sync Pesado (Fundamentus) + Cálculo - DIÁRIO (08:00 AM)
    // Reduzido de 4h para 24h para evitar Bloqueio 403
    cron.schedule('0 8 * * *', async () => {
        logger.info("⏰ Rotina DIÁRIA: Protocolo V3 Completo (Sync + Calc)...");
        try {
            const syncResult = await syncService.performFullSync();
            
            if (syncResult.success) {
                await aiResearchService.runBatchAnalysis(null); 
                logger.info("✅ Rotina Diária V3 finalizada com sucesso.");
            } else {
                logger.warn("⚠️ Rotina V3: Sync falhou, pulando cálculo.");
            }
        } catch (e) {
            logger.error(`Erro Rotina V3 Diária: ${e.message}`);
        }
    });

    // 4. Snapshot Patrimonial Diário (23:59)
    cron.schedule('59 23 * * *', async () => {
        logger.info("📸 Rotina: Snapshot Patrimonial Diário");
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
            logger.info(`📸 Snapshots gerados para ${users.length} usuários.`);
        } catch (error) {
            logger.error(`Erro Snapshot: ${error.message}`);
        }
    });
};
