
import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { walletWriteLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validateResource.js';
import {
    listGoals,
    getGoal,
    createGoal,
    updateGoal,
    deleteGoal,
    clearAllGoals,
    addContribution,
    deleteContribution,
} from '../controllers/goalsController.js';
import {
    createGoalSchema,
    updateGoalSchema,
    addContributionSchema,
    goalIdParamSchema,
    contributionIdParamSchema,
} from '../schemas/goalsSchemas.js';

const router = express.Router();

// Planejador de Metas — disponível a todos os planos (sem requireXPlan).
// authenticateToken roda primeiro, garantindo req.user.id na chave do limiter.
router.use(authenticateToken);

const writeLimiter = walletWriteLimiter;

router.get('/', listGoals);
router.delete('/', writeLimiter, clearAllGoals);
router.post('/', writeLimiter, validate(createGoalSchema), createGoal);
router.get('/:id', validate(goalIdParamSchema), getGoal);
router.put('/:id', writeLimiter, validate(updateGoalSchema), updateGoal);
router.delete('/:id', writeLimiter, validate(goalIdParamSchema), deleteGoal);

router.post('/:id/contributions', writeLimiter, validate(addContributionSchema), addContribution);
router.delete('/:id/contributions/:cid', writeLimiter, validate(contributionIdParamSchema), deleteContribution);

export default router;
