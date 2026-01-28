
import cron from 'node-cron';
import logger from '../config/logger.js';
import { triggerDailyRoutine } from '../controllers/researchController.js';
import { marketDataService } from './marketDataService.js';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';

export const initScheduler = () => {
    logger.info("⏰ Scheduler Service Inicializado");

    // 1. Sync Macro & Market Data (A cada 30 minutos)
    cron.schedule('*/30 * * * *', async () => {
        logger.info("⏰ Rotina: Sync Geral (Macro + Market)");
        try {
            await marketDataService.performFullSync();
        } catch (error) {
            logger.error(`Erro Sync 30m: ${error.message}`);
        }
    });

    // 2. Relatório Semanal IA (Segunda 08:00)
    cron.schedule('0 8 * * 1', async () => {
        logger.info("⏰ Rotina: Relatório Semanal IA");
        try { await triggerDailyRoutine(null, null, true); } catch (e) {}
    });

    // 3. Snapshot Patrimonial Diário (23:59)
    cron.schedule('59 23 * * *', async () => {
        logger.info("📸 Rotina: Snapshot Patrimonial Diário");
        try {
            const users = await User.find({}).select('_id');
            const today = new Date();
            
            for (const user of users) {
                // Calcula Patrimônio
                const assets = await UserAsset.find({ user: user._id });
                let totalEquity = 0;
                let totalInvested = 0;
                
                // Precisamos do preço atual de cada ativo para o snapshot
                // Como rodou o Sync, pegamos do MarketAsset (Cache)
                for (const asset of assets) {
                    const marketData = await marketDataService.getMarketDataByTicker(asset.ticker);
                    const price = marketData.price;
                    const multiplier = asset.currency === 'USD' ? 5.75 : 1; // Simplificação, ideal usar SystemConfig.dollar
                    
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
