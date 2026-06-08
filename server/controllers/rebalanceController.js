import { rebalanceService } from '../services/rebalanceService.js';
import logger from '../config/logger.js';

/**
 * POST /api/wallet/rebalance — Rebalanceamento IA (BLACK).
 * Read-only: devolve um plano de ordens (vender/comprar) com justificativas quant
 * e IR estimado. Não persiste nada nem roteia ordens.
 */
export const generateRebalancePlan = async (req, res, next) => {
    try {
        const userId = req.user.id;
        // validate() não reescreve req.body, então o default fica aqui.
        const riskProfile = req.body?.riskProfile || 'MODERATE';

        const plan = await rebalanceService.generatePlan(userId, riskProfile);
        res.json(plan);
    } catch (error) {
        logger.error(`Erro no rebalanceamento: ${error.message}`);
        next(error);
    }
};
