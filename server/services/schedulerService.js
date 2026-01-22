import cron from 'node-cron';
import logger from '../config/logger.js';
import { triggerDailyRoutine } from '../controllers/researchController.js';

// Inicializa os Jobs Agendados
export const initScheduler = () => {
    logger.info("⏰ Scheduler Service Inicializado");

    // Morning Call Diário (Brasil) - Roda às 08:30 AM (Horário do Servidor)
    // Se o servidor estiver em UTC, ajustar conforme necessidade.
    // Expressão: "30 8 * * 1-5" (08:30 de Seg a Sex)
    cron.schedule('30 8 * * 1-5', async () => {
        logger.info("⏰ Executando Rotina Automática: Morning Call");
        try {
            // Chama a rotina sem objeto de Request/Response (modo interno)
            await triggerDailyRoutine(null, null, true); 
        } catch (error) {
            logger.error(`❌ Erro no Job Cron: ${error.message}`);
        }
    });
};