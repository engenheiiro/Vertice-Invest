/**
 * Rotas administrativas que não pertencem à pesquisa.
 *
 * O funil é dado comercial, não ranking — pendurá-lo em `/api/research` só
 * porque lá já existia `requireAdmin` misturaria dois assuntos que evoluem
 * separados. Ordem de middleware do projeto: limiter → autenticação → admin.
 */
import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { adminLimiter } from '../middleware/rateLimiters.js';
import { getFunnel } from '../controllers/funnelController.js';
import { getPerformanceMetrics } from '../controllers/performanceController.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/funnel', adminLimiter, requireAdmin, getFunnel);
router.get('/performance-metrics', adminLimiter, requireAdmin, getPerformanceMetrics);

export default router;
