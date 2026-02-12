
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
    triggerMacroSync,
    runFullPipeline,
    getQuantSignals,
    getRadarStats, 
    updateBacktestConfig,
    clearRadarHistory,
    getDataQualityStats // Novo Controller
} from '../controllers/researchController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/latest', getLatestReport);
router.get('/macro', getMacroData);
router.get('/signals', getQuantSignals); 
router.get('/radar-stats', getRadarStats);

// Fluxo Granular Admin
router.post('/crunch', requireAdmin, crunchNumbers);
router.post('/full-pipeline', requireAdmin, runFullPipeline); 
router.post('/enhance', requireAdmin, enhanceWithAI); 
router.post('/narrative', requireAdmin, generateNarrative);
router.post('/publish', requireAdmin, publishContent);
router.get('/history', requireAdmin, listReports);
router.get('/details/:id', requireAdmin, getReportDetails);

router.post('/sync-market', requireAdmin, triggerMarketSync);
router.post('/sync-macro', requireAdmin, triggerMacroSync);
router.post('/config/backtest', requireAdmin, updateBacktestConfig);
router.delete('/signals/history', requireAdmin, clearRadarHistory);

// Monitor de Qualidade
router.get('/data-quality', requireAdmin, getDataQualityStats);

export default router;
