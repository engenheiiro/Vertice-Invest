
import express from 'express';
import {
    crunchNumbers,
    generateNarrative,
    publishContent,
    getLatestReport,
    listReports,
    getReportDetails,
    getMacroData,
    getFixedIncomeData,
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
    runStorageCleanupHandler,
    backfillSectorsHandler,
    getBuyAndHoldShadow
} from '../controllers/researchController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { researchHeavyLimiter, researchReadLimiter, adminLimiter } from '../middleware/rateLimiters.js';
import { getTunablesHandler, updateTunablesHandler } from '../controllers/configController.js'; // (I13)
import {
    getDataHealth,
    runDataHealth,
    listErrors,
    resolveError,
} from '../controllers/healthController.js';
import validate from '../middleware/validateResource.js';
import { tunablesPatchSchema } from '../schemas/configSchemas.js';
import { enhanceResearchSchema, publishResearchSchema } from '../schemas/researchSchemas.js';

const router = express.Router();

router.use(authenticateToken);

// (I5) Leituras agregadas (hit a cada load do dashboard): 300/15min por usuário.
router.get('/latest', researchReadLimiter, getLatestReport);
router.get('/macro', researchReadLimiter, getMacroData);
router.get('/fixed-income', researchReadLimiter, getFixedIncomeData);
router.get('/signals', researchReadLimiter, getQuantSignals);
// getRadarStats dispara 4 pipelines $aggregate por chamada; sem limiter, qualquer
// autenticado (a rota não tem gate de plano — só devolve agregados por setor, sem
// ticker) pode martelá-los em rajada. Mesmo limiter das demais leituras caras.
router.get('/radar-stats', researchReadLimiter, getRadarStats);

// (I5) Fluxo Granular Admin — operações caras (pipeline, IA, syncs): 20/15min por usuário.
router.post('/crunch', researchHeavyLimiter, requireAdmin, crunchNumbers);
router.post('/full-pipeline', researchHeavyLimiter, requireAdmin, runFullPipeline);
router.post('/enhance', researchHeavyLimiter, requireAdmin, validate(enhanceResearchSchema), enhanceWithAI);
router.post('/narrative', researchHeavyLimiter, requireAdmin, generateNarrative);
router.post('/publish', adminLimiter, requireAdmin, validate(publishResearchSchema), publishContent);
router.get('/history', adminLimiter, requireAdmin, listReports);
router.get('/details/:id', adminLimiter, requireAdmin, getReportDetails);

// Ranking Buy-and-Hold em shadow (admin-only). Cálculo on-demand sobre todo o
// universo STOCK — usa o limiter pesado (20/15min).
router.get('/buy-and-hold/shadow', researchHeavyLimiter, requireAdmin, getBuyAndHoldShadow);

router.post('/sync-market', researchHeavyLimiter, requireAdmin, triggerMarketSync);
router.post('/backfill-sectors', researchHeavyLimiter, requireAdmin, backfillSectorsHandler);
router.post('/sync-macro', researchHeavyLimiter, requireAdmin, triggerMacroSync);
router.post('/sync-time-series', researchHeavyLimiter, requireAdmin, syncTimeSeries);
router.post('/config/backtest', adminLimiter, requireAdmin, updateBacktestConfig);

// (I13) Tunables operacionais editáveis pelo admin (sem deploy).
router.get('/config/tunables', adminLimiter, requireAdmin, getTunablesHandler);
router.put('/config/tunables', adminLimiter, requireAdmin, validate(tunablesPatchSchema), updateTunablesHandler);
router.delete('/signals/history', adminLimiter, requireAdmin, clearRadarHistory);
router.post('/cleanup-storage', researchHeavyLimiter, requireAdmin, runStorageCleanupHandler);

// Monitor de Qualidade & Acurácia
router.get('/data-quality', adminLimiter, requireAdmin, getDataQualityStats);
router.post('/reset-health', adminLimiter, requireAdmin, resetAssetHealth);

// Sentinela de saúde dos dados + log de erros do backend (painel "Saúde").
// A leitura é barata (último relatório persistido), então usa adminLimiter; o
// recálculo sob demanda varre a base inteira e vai no researchHeavyLimiter.
router.get('/data-health', adminLimiter, requireAdmin, getDataHealth);
router.post('/data-health/run', researchHeavyLimiter, requireAdmin, runDataHealth);
router.get('/errors', adminLimiter, requireAdmin, listErrors);
router.post('/errors/:id/resolve', adminLimiter, requireAdmin, resolveError);
router.get('/accuracy', adminLimiter, requireAdmin, getAlgorithmAccuracy);
// Motivos internos de descarte — só admin (único consumidor é o AdminPanel).
router.get('/discard-logs', adminLimiter, requireAdmin, getDiscardLogs);

// Publicação & Explainable AI
router.get('/publish-status', adminLimiter, requireAdmin, getPublishStatus);
router.post('/generate-explainable', adminLimiter, requireAdmin, generateExplainableAI);

export default router;
