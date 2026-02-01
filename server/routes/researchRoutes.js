
import express from 'express';
import { 
    crunchNumbers, 
    generateNarrative, 
    publishContent, 
    getLatestReport, 
    listReports,
    getReportDetails,
    getMacroData,
    enhanceWithAI,
    triggerMarketSync,
    runFullPipeline // Nova importação
} from '../controllers/researchController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/latest', getLatestReport);
router.get('/macro', getMacroData);

// Fluxo Granular Admin
router.post('/crunch', requireAdmin, crunchNumbers);
router.post('/full-pipeline', requireAdmin, runFullPipeline); // Nova rota (Sync + Calc)
router.post('/enhance', requireAdmin, enhanceWithAI); 
router.post('/narrative', requireAdmin, generateNarrative);
router.post('/publish', requireAdmin, publishContent);
router.get('/history', requireAdmin, listReports);
router.get('/details/:id', requireAdmin, getReportDetails);

router.post('/sync-market', requireAdmin, triggerMarketSync);

export default router;
