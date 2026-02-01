
import cron from 'node-cron';
import logger from '../config/logger.js';
import { triggerDailyRoutine } from '../controllers/researchController.js';
import { marketDataService } from './marketDataService.js';
import { macroDataService } from './macroDataService.js'; // Import explícito
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import WalletSnapshot from '../models/WalletSnapshot.js';

export const initScheduler = () => {
    logger.info("⏰ Scheduler Service Inicializado");

    // 1. Sync Leve: Macroeconomia + Moedas (A cada 30 minutos)
    // ALTERAÇÃO: Não rodamos mais o performFullSync() completo aqui para evitar
    // bloqueio de IP no Render ao tentar scrapear o Fundamentus.
    // O Sync Pesado (Scraping) agora é responsabilidade do "Local Worker" (sync:prod).
    cron.schedule('*/30 * * * *', async () => {
        logger.info("⏰ Rotina: Sync Leve (Macro + Moedas)");
        try {
            // Atualiza apenas indicadores macro (Selic, IPCA, Dólar, Bitcoin)
            // APIs do BCB e AwesomeAPI geralmente não bloqueiam Cloud IPs
            await macroDataService.performMacroSync();
        } catch (error) {
            logger.error(`Erro Sync Leve 30m: ${error.message}`);
        }
    });

    // 2. Relatório Semanal IA (Segunda 08:00)
    // Este processo depende apenas de dados já no banco, seguro para rodar no Cloud.
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
                
                // Precisamos do preço atual.
                // IMPORTANTE: Aqui confiamos que o preço no MarketAsset está "fresco o suficiente"
                // ou que o usuário rodou o Sync Local recentemente.
                // Como fallback, poderíamos tentar Yahoo aqui, mas seria lento para muitos usuários.
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
