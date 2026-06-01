
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
    getDataQualityStats,
    resetAssetHealth,
    getAlgorithmAccuracy,
    getDiscardLogs,
    syncTimeSeries,
    getPublishStatus,
    generateExplainableAI,
    runStorageCleanupHandler
} from '../controllers/researchController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { researchHeavyLimiter, researchReadLimiter } from '../middleware/rateLimiters.js';
import { getTunablesHandler, updateTunablesHandler } from '../controllers/configController.js'; // (I13)

const router = express.Router();

router.use(authenticateToken);

// (I5) Leituras agregadas (hit a cada load do dashboard): 300/15min por usuário.
router.get('/latest', researchReadLimiter, getLatestReport);
router.get('/macro', researchReadLimiter, getMacroData);
router.get('/signals', researchReadLimiter, getQuantSignals);
router.get('/radar-stats', getRadarStats);

// (I5) Fluxo Granular Admin — operações caras (pipeline, IA, syncs): 20/15min por usuário.
router.post('/crunch', researchHeavyLimiter, requireAdmin, crunchNumbers);
router.post('/full-pipeline', researchHeavyLimiter, requireAdmin, runFullPipeline);
router.post('/enhance', researchHeavyLimiter, requireAdmin, enhanceWithAI);
router.post('/narrative', researchHeavyLimiter, requireAdmin, generateNarrative);
router.post('/publish', requireAdmin, publishContent);
router.get('/history', requireAdmin, listReports);
router.get('/details/:id', requireAdmin, getReportDetails);

router.post('/sync-market', researchHeavyLimiter, requireAdmin, triggerMarketSync);
router.post('/sync-macro', researchHeavyLimiter, requireAdmin, triggerMacroSync);
router.post('/sync-time-series', researchHeavyLimiter, requireAdmin, syncTimeSeries);
router.post('/config/backtest', requireAdmin, updateBacktestConfig);

// (I13) Tunables operacionais editáveis pelo admin (sem deploy).
router.get('/config/tunables', requireAdmin, getTunablesHandler);
router.put('/config/tunables', requireAdmin, updateTunablesHandler);
router.delete('/signals/history', requireAdmin, clearRadarHistory);
router.post('/cleanup-storage', researchHeavyLimiter, requireAdmin, runStorageCleanupHandler);

// Monitor de Qualidade & Acurácia
router.get('/data-quality', requireAdmin, getDataQualityStats);
router.post('/reset-health', requireAdmin, resetAssetHealth);
router.get('/accuracy', requireAdmin, getAlgorithmAccuracy);
router.get('/discard-logs', getDiscardLogs);

// Publicação & Explainable AI
router.get('/publish-status', requireAdmin, getPublishStatus);
router.post('/generate-explainable', requireAdmin, generateExplainableAI);

export default router;
