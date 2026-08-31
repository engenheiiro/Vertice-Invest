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

const router = express.Router();

router.use(authenticateToken);

router.get('/funnel', adminLimiter, requireAdmin, getFunnel);

export default router;
