import express from 'express';
import { 
    crunchNumbers, 
    generateNarrative, 
    publishContent, 
    getLatestReport, 
    listReports,
    getReportDetails 
} from '../controllers/researchController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/latest', getLatestReport);

// Fluxo Granular Admin
router.post('/crunch', requireAdmin, crunchNumbers);
router.post('/narrative', requireAdmin, generateNarrative);
router.post('/publish', requireAdmin, publishContent);
router.get('/history', requireAdmin, listReports);
router.get('/details/:id', requireAdmin, getReportDetails); // Nova rota

export default router;