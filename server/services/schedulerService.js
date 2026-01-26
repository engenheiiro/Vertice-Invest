
import cron from 'node-cron';
import logger from '../config/logger.js';
import { triggerDailyRoutine } from '../controllers/researchController.js';

// Inicializa os Jobs Agendados
export const initScheduler = () => {
    logger.info("⏰ Scheduler Service Inicializado");

    // 1. Relatório Semanal (Toda Segunda-feira às 08:00)
    // Cron Syntax: Minute Hour DayOfMonth Month DayOfWeek (1 = Segunda)
    cron.schedule('0 8 * * 1', async () => {
        logger.info("⏰ Executando Rotina: Relatório Semanal (Segunda 08:00)");
        try {
            await triggerDailyRoutine(null, null, true); 
        } catch (error) { logger.error(`Erro Cron Semanal: ${error.message}`); }
    });

    // 2. Atualização de Fechamento Semanal (Sexta-feira 18:00)
    // Mantemos uma atualização na sexta para ter dados frescos de fechamento da semana
    cron.schedule('0 18 * * 5', async () => {
        logger.info("⏰ Executando Rotina: Fechamento Semanal (Sexta 18:00)");
        try {
            await triggerDailyRoutine(null, null, true);
        } catch (error) { logger.error(`Erro Cron Sexta: ${error.message}`); }
    });
};
