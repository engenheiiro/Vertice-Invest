import express from 'express';
import { generateReport, getLatestReport, listReports, triggerDailyRoutine } from '../controllers/researchController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/latest', getLatestReport);

// Admin Routes
router.post('/generate', requireAdmin, generateReport);
router.post('/routine', requireAdmin, triggerDailyRoutine); // Nova Rota
router.get('/history', requireAdmin, listReports);

export default router;