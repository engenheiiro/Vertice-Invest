
import MarketAnalysis from '../models/MarketAnalysis.js';
import TreasuryBond from '../models/TreasuryBond.js';
import QuantSignal from '../models/QuantSignal.js';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import RecommendedPortfolioCurve from '../models/RecommendedPortfolioCurve.js';
import DiscardLog from '../models/DiscardLog.js'; // Novo
import { createBroadcast } from '../services/notificationService.js';
import { aiResearchService } from '../services/aiResearchService.js';
import { aiEnhancementService } from '../services/aiEnhancementService.js';
import { marketDataService } from '../services/marketDataService.js';
import { macroDataService } from '../services/macroDataService.js';
import { syncService } from '../services/syncService.js';
import { backfillSectors } from '../services/sectorBackfillService.js';
import { signalEngine } from '../services/engines/signalEngine.js';
import { LIMITS_CONFIG } from '../config/subscription.js';
import { normalizeTreasuryBonds } from '../utils/fixedIncomeView.js';
import { V2_SIGNAL_START_DATE } from '../config/financialConstants.js';
import logger from '../config/logger.js';

// ... (Outros controllers mantidos)

// Curva contínua da "Carteira Recomendada" (backtest event-driven).
// Mantém a rota /accuracy e o shape de array de pontos esperado pelo front,
// mas agora lê RecommendedPortfolioCurve e recorta/rebaseia para a janela pedida.
export const getAlgorithmAccuracy = async (req, res, next) => {
    try {
        const { assetClass, days, profile } = req.query;
        const window = Math.max(1, parseInt(days) || 30);
        const cls = assetClass || 'BRASIL_10';
        // BRASIL_10 é curva única (carteira curada, sem dimensão de perfil) — sempre MODERATE.
        const effProfile = cls === 'BRASIL_10' ? 'MODERATE' : (profile || 'MODERATE');

        const curve = await RecommendedPortfolioCurve.findOne({
            assetClass: cls,
            profile: effProfile,
        }).lean();

        if (!curve || !curve.points?.length) return res.json([]);

        // Últimos (window+1) pontos diários e rebase para o início da janela:
        // retorno na janela = (1 + cumBase) / (1 + cumStart) - 1, em pontos percentuais.
        const slice = curve.points.slice(-(window + 1));
        const start = slice[0];
        const rebase = (cur = 0, st = 0) => ((1 + cur) / (1 + st) - 1) * 100;

        const out = slice.map(p => ({
            date: p.date,
            equityReturn: rebase(p.equityReturn, start.equityReturn),
            ibovReturn: rebase(p.ibovReturn, start.ibovReturn),
            spxReturn: rebase(p.spxReturn, start.spxReturn),
            cdiReturn: rebase(p.cdiReturn, start.cdiReturn),
            ifixReturn: rebase(p.ifixReturn, start.ifixReturn),
            btcReturn: rebase(p.btcReturn, start.btcReturn),
            holdingsCount: p.holdingsCount,
            lastRebalanceDate: p.lastRebalanceDate,
        }));

        res.json(out);
    } catch (error) { next(error); }
};

export const getDiscardLogs = async (req, res, next) => {
    try {
        const logs = await DiscardLog.find({})
            .sort({ createdAt: -1 })
            .limit(100);
        res.json(logs);
    } catch (error) { next(error); }
};

// ... (Outros controllers mantidos: getMacroData, getQuantSignals, etc.)

export const getMacroData = async (req, res, next) => {
    try {
        const indicators = await marketDataService.getMacroIndicators();
        const bonds = await TreasuryBond.find({}).sort({ type: 1, rate: 1 });
        res.json({ ...indicators, bonds: bonds });
    } catch (error) { next(error); }
};

// Vitrine informativa de Renda Fixa (Tesouro Direto). NÃO é ranking competitivo —
// renda fixa não compete por score como ação/FII. Lê os TreasuryBond já sincronizados
// e cruza com o macro (IPCA/Selic/CDI) para estimar retorno nominal, real e vs CDI.
export const getFixedIncomeData = async (req, res, next) => {
    try {
        const indicators = await marketDataService.getMacroIndicators();
        const ipca = Number(indicators?.ipca?.value) || 0;
        const selic = Number(indicators?.selic?.value) || 0;
        const cdi = Number(indicators?.cdi?.value) > 0 ? Number(indicators.cdi.value) : selic;

        const bonds = await TreasuryBond.find({}).sort({ type: 1, rate: 1 }).lean();
        const normalized = normalizeTreasuryBonds(bonds, { ipca, selic, cdi });

        res.json({
            macro: { ipca, selic, cdi },
            bonds: normalized,
            updatedAt: bonds[0]?.updatedAt || null,
        });
    } catch (error) { next(error); }
};

export const getQuantSignals = async (req, res, next) => {
    try {
        const { history } = req.query;
        let query = history === 'true' ? {} : { status: 'ACTIVE' };
        const limit = 200;
        const signals = await QuantSignal.find(query).sort({ timestamp: -1 }).limit(limit).lean();

        if (signals.length > 0) {
            const tickers = signals.map(s => s.ticker);
            const assets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker lastPrice');
            const priceMap = new Map();
            assets.forEach(a => priceMap.set(a.ticker, a.lastPrice));
            signals.forEach(s => { if (s.status === 'ACTIVE') s.finalPrice = priceMap.get(s.ticker); });
        }

        // Metadata do último scan para exibição no frontend (countdown, contexto)
        const scanMetaDoc = await SystemConfig.findOne({ key: 'RADAR_SCAN_META' }).lean();
        const scanMeta = scanMetaDoc?.value || null;

        const meta = scanMeta ? {
            lastScanAt: scanMeta.lastScanAt,
            nextScanAt: new Date(new Date(scanMeta.lastScanAt).getTime() + 15 * 60 * 1000).toISOString(),
            assetsScanned: scanMeta.assetsScanned || 0,
            assetsWithHistory: scanMeta.assetsWithHistory || 0,
            activeSignalsTotal: scanMeta.activeSignalsTotal ?? signals.filter(s => s.status === 'ACTIVE').length,
            scanIntervalMinutes: 15
        } : {
            lastScanAt: null,
            nextScanAt: null,
            assetsScanned: 0,
            assetsWithHistory: 0,
            activeSignalsTotal: signals.filter(s => s.status === 'ACTIVE').length,
            scanIntervalMinutes: 15
        };

        res.json({ signals, meta });
    } catch (error) { next(error); }
};

// ... (Resto do arquivo mantido)
export const getRadarStats = async (req, res, next) => {
    try {
        const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const v2StartDate = V2_SIGNAL_START_DATE;
        const baseMatch = { status: { $in: ['HIT', 'MISS'] }, quality: 'GOLD', timestamp: { $gte: v2StartDate }, auditDate: { $gte: thirtyDaysAgo } };

        const [hitMissStats, byTypeRaw, closedSectors, openSectors, config] = await Promise.all([
            QuantSignal.aggregate([{ $match: baseMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            QuantSignal.aggregate([
                { $match: { ...baseMatch, assetType: { $in: ['STOCK', 'FII', 'STOCK_US'] } } },
                { $group: { _id: { assetType: '$assetType', status: '$status' }, count: { $sum: 1 } } }
            ]),
            QuantSignal.aggregate([ { $match: { status: 'HIT', quality: 'GOLD', timestamp: { $gte: v2StartDate }, auditDate: { $gte: thirtyDaysAgo } } }, { $group: { _id: '$sector', count: { $sum: 1 }, avgReturn: { $avg: '$resultPercent' } } }, { $sort: { count: -1 } }, { $limit: 6 } ]),
            QuantSignal.aggregate([ { $match: { status: 'ACTIVE', quality: 'GOLD' } }, { $group: { _id: '$sector', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 6 } ]),
            SystemConfig.findOne({ key: 'MACRO_INDICATORS' })
        ]);

        const hits = hitMissStats.find(s => s._id === 'HIT')?.count || 0;
        const misses = hitMissStats.find(s => s._id === 'MISS')?.count || 0;
        const totalClosed = hits + misses;
        const winRate = totalClosed > 0 ? (hits / totalClosed) * 100 : 0;

        // Breakdown por tipo de ativo
        const typeAccum = { STOCK: {}, FII: {}, STOCK_US: {} };
        for (const item of byTypeRaw) {
            const { assetType, status } = item._id;
            if (typeAccum[assetType]) typeAccum[assetType][status] = item.count;
        }
        const calcType = (m) => {
            const h = m.HIT || 0, ms = m.MISS || 0, t = h + ms;
            return { winRate: t > 0 ? parseFloat(((h / t) * 100).toFixed(1)) : 0, totalSignals: t };
        };
        const byAssetType = {
            STOCK:    calcType(typeAccum.STOCK),
            FII:      calcType(typeAccum.FII),
            STOCK_US: calcType(typeAccum.STOCK_US),
        };

        res.json({
            winRate: parseFloat(winRate.toFixed(1)),
            totalSignals: totalClosed,
            byAssetType,
            heatmapClosed: closedSectors.map(s => ({ sector: s._id || 'Outros', value: s.count, avgReturn: parseFloat((s.avgReturn ?? 0).toFixed(2)) })),
            heatmapOpen:   openSectors.map(s => ({ sector: s._id || 'Outros', value: s.count, avgReturn: 0 })),
            backtestHorizon: config?.backtestHorizon || 14
        });
    } catch (error) { next(error); }
};

export const clearRadarHistory = async (req, res, next) => {
    try {
        await QuantSignal.deleteMany({});
        logger.info(`🗑️ [Admin] Histórico do Radar Alpha limpo por admin ${req.user._id}`);
        res.json({ message: "Histórico do Radar limpo com sucesso." });
    } catch (error) { next(error); }
};

export const runStorageCleanupHandler = async (req, res, next) => {
    try {
        const { runStorageCleanup } = await import('../services/cleanupService.js');
        logger.info(`🧹 [Admin] Limpeza de armazenamento iniciada por admin ${req.user._id}`);
        const stats = await runStorageCleanup();
        res.json({ message: "Limpeza concluída.", stats });
    } catch (error) { next(error); }
};

export const updateBacktestConfig = async (req, res, next) => {
    try {
        const { days } = req.body;
        await SystemConfig.findOneAndUpdate({ key: 'MACRO_INDICATORS' }, { $set: { backtestHorizon: days } }, { upsert: true });
        res.json({ message: `Horizonte de backtest atualizado para ${days} dias.` });
    } catch (error) { next(error); }
};

export const getDataQualityStats = async (req, res, next) => {
    try {
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
        const inactiveCount = await MarketAsset.countDocuments({ isActive: false, failCount: { $gte: 10 } });
        const totalAssets = await MarketAsset.countDocuments({});
        
        // Calcular Idade Média das Séries Temporais
        const { AssetHistory } = await import('../models/AssetHistory.js').then(m => m.default ? { AssetHistory: m.default } : m);
        const histories = await AssetHistory.find({}, 'lastUpdated');
        let avgAgeHours = 0;
        if (histories.length > 0) {
            const now = new Date();
            const totalAgeMs = histories.reduce((sum, h) => sum + (now - new Date(h.lastUpdated)), 0);
            avgAgeHours = (totalAgeMs / histories.length) / (1000 * 60 * 60);
        }

        res.json({
            typosFixed: config?.lastSyncStats?.typosFixed || 0,
            assetsProcessed: config?.lastSyncStats?.assetsProcessed || 0,
            lastSyncDate: config?.lastSyncStats?.timestamp || null,
            snapshotStats: config?.lastSnapshotStats || { created: 0, skipped: 0, timestamp: null },
            blacklistedAssets: inactiveCount,
            totalAssets,
            timeSeriesAgeHours: avgAgeHours,
            timeSeriesStats: config?.lastTimeSeriesStats || { assetsProcessed: 0, timestamp: null },
            lastUSFundamentalsSync: config?.lastUSFundamentalsSync || null
        });
    } catch (error) { next(error); }
};

export const resetAssetHealth = async (req, res, next) => {
    try {
        const result = await MarketAsset.updateMany({ isActive: false, failCount: { $gte: 10 } }, { $set: { isActive: true, failCount: 0 } });
        res.json({ message: "Saúde dos ativos resetada.", reactivated: result.modifiedCount });
    } catch (error) { next(error); }
};

export const triggerMarketSync = async (req, res, next) => { try { const result = await syncService.performFullSync(); res.json({ message: "Sincronização iniciada.", details: result }); } catch (error) { next(error); } };

export const backfillSectorsHandler = async (req, res, next) => {
    try {
        const dryRun = req.query.dry === 'true' || req.body?.dryRun === true;
        const result = await backfillSectors({ dryRun });
        res.json({
            message: dryRun ? "Dry run de setores concluído." : "Setores corrigidos.",
            scanned: result.scanned,
            updated: result.updated,
            changes: result.changes.slice(0, 200) // evita payload gigante
        });
    } catch (error) { next(error); }
};
export const triggerMacroSync = async (req, res, next) => { try { const result = await macroDataService.performMacroSync(); res.json({ message: "Macro atualizado.", data: result }); } catch (error) { next(error); } };

export const runFullPipeline = async (req, res, next) => {
    try {
        const adminId = req.user?.id;
        const syncResult = await syncService.performFullSync();
        if (!syncResult.success) return res.status(500).json({ message: "Falha Sync.", error: syncResult.error });
        await aiResearchService.runBatchAnalysis(adminId);
        await signalEngine.runScanner();
        await signalEngine.runBacktest();
        // Alinhado com sync:prod: inclui timeSeriesWorker e backtest de acurácia
        try {
            const { timeSeriesWorker } = await import('../services/workers/timeSeriesWorker.js');
            await timeSeriesWorker.run();
        } catch (e) { logger.warn(`⚠️ timeSeriesWorker no pipeline: ${e.message}`); }
        try {
            const { runBacktestAnalysis } = await import('../scripts/runBacktestEngine.js');
            await runBacktestAnalysis();
        } catch (e) { logger.warn(`⚠️ runBacktestAnalysis no pipeline: ${e.message}`); }
        try {
            const { buildRecommendedPortfolioCurves } = await import('../scripts/recommendedPortfolioEngine.js');
            await buildRecommendedPortfolioCurves();
        } catch (e) { logger.warn(`⚠️ Carteira Recomendada no pipeline: ${e.message}`); }
        res.json({ message: "Pipeline V3 completo." });
    } catch (error) { next(error); }
};

export const syncTimeSeries = async (req, res, next) => { try { const { timeSeriesWorker } = await import('../services/workers/timeSeriesWorker.js'); await timeSeriesWorker.run(); res.json({ message: "Séries temporais atualizadas com sucesso." }); } catch (error) { next(error); } };

export const crunchNumbers = async (req, res, next) => {
    try {
        const { assetClass, isBulk } = req.body;
        const adminId = req.user?.id;
        if (isBulk) { await aiResearchService.runBatchAnalysis(adminId); if (res) return res.json({ message: "Bulk Calc OK." }); return; }
        const { ranking, fullList } = await aiResearchService.calculateRanking(assetClass, 'BUY_HOLD');
        await MarketAnalysis.create({ assetClass, strategy: 'BUY_HOLD', content: { ranking, fullAuditLog: fullList }, generatedBy: adminId });
        return res.status(201).json({ message: "Análise Gerada." });
    } catch (error) { if (next) next(error); }
};

export const enhanceWithAI = async (req, res, next) => { try { const { assetClass, strategy } = req.body; const latestReport = await MarketAnalysis.findOne({ assetClass, strategy }).sort({ createdAt: -1 }); if (!latestReport) return res.status(404).json({ message: "Relatório não encontrado." }); const enhancedRanking = await aiEnhancementService.enhanceRankingWithNews(latestReport.content.ranking, assetClass); latestReport.content.ranking = enhancedRanking; latestReport.isMorningCallPublished = false; await latestReport.save(); return res.json({ message: "Refinamento IA concluído.", ranking: enhancedRanking }); } catch (error) { next(error); } };
export const generateNarrative = async (req, res, next) => { try { const { analysisId } = req.body; const analysis = await MarketAnalysis.findById(analysisId); if (!analysis) return res.status(404).json({ message: "Not found" }); const narrative = await aiResearchService.generateNarrative(analysis.content.ranking, analysis.assetClass); analysis.content.morningCall = narrative; await analysis.save(); if (res) res.json({ morningCall: narrative }); } catch (error) { next(error); } };

export const publishContent = async (req, res, next) => {
    try {
        const { analysisId, type } = req.body;
        const analysis = await MarketAnalysis.findById(analysisId);
        if (!analysis) return res.status(404).json({ message: "Not found" });

        const rankingWasAlreadyPublished = analysis.isRankingPublished;

        if (type === 'RANKING' || type === 'BOTH' || type === 'ALL') analysis.isRankingPublished = true;
        if (type === 'MORNING_CALL' || type === 'BOTH' || type === 'ALL') analysis.isMorningCallPublished = true;
        if (type === 'REPORT' || type === 'ALL') analysis.isReportPublished = true;
        if (type === 'EXPLAINABLE_AI' || type === 'ALL') analysis.isExplainableAIPublished = true;
        await analysis.save();

        // Dispara broadcast apenas quando o ranking passa a publicado pela primeira vez
        if (!rankingWasAlreadyPublished && analysis.isRankingPublished) {
            const assetClass = analysis.assetClass || '';
            const assetClassLabels = {
                STOCK: 'Ações BR', FII: 'FIIs', CRYPTO: 'Cripto',
                STOCK_US: 'Ações EUA', REIT: 'REITs', ETF: 'ETFs', BRASIL_10: 'Brasil 10',
            };
            const label = assetClassLabels[assetClass] || assetClass;
            // Fire-and-forget — não bloqueia a resposta
            createBroadcast({
                type: 'RANKING_PUBLISHED',
                title: 'Novo ranking publicado',
                message: `Novo ranking de ${label} está disponível. Confira as recomendações atualizadas.`,
                relatedAssetClass: assetClass,
            });
        }

        if (res) res.json({ message: "Publicado." });
    } catch (error) { next(error); }
};

export const getPublishStatus = async (req, res, next) => {
    try {
        const classes = ['STOCK', 'FII', 'CRYPTO', 'BRASIL_10', 'STOCK_US', 'REIT', 'ETF'];
        const status = await Promise.all(classes.map(async (assetClass) => {
            const latest = await MarketAnalysis.findOne({ assetClass, strategy: 'BUY_HOLD' })
                .sort({ createdAt: -1 })
                .select('createdAt isRankingPublished isMorningCallPublished isReportPublished isExplainableAIPublished comparisonReport explainableAIPrompt generatedExplainableAI');
            const lastPublished = await MarketAnalysis.findOne({ assetClass, strategy: 'BUY_HOLD', isRankingPublished: true })
                .sort({ createdAt: -1 })
                .select('createdAt');
            return {
                assetClass,
                lastSyncAt: latest?.createdAt || null,
                lastPublishedAt: lastPublished?.createdAt || null,
                isRankingPublished: latest?.isRankingPublished || false,
                isReportPublished: latest?.isReportPublished || false,
                isExplainableAIPublished: latest?.isExplainableAIPublished || false,
                hasComparisonReport: !!latest?.comparisonReport,
                hasExplainableAIPrompt: !!(latest?.explainableAIPrompt),
                hasGeneratedExplainableAI: !!(latest?.generatedExplainableAI),
                latestId: latest?._id || null,
                readyToPublish: latest && !latest.isRankingPublished
            };
        }));
        res.json(status);
    } catch (error) { next(error); }
};

const PROFILE_LABEL_PT = { DEFENSIVE: 'Defensivo', MODERATE: 'Moderado', BOLD: 'Arrojado' };

export const generateExplainableAI = async (req, res, next) => {
    try {
        const { analysisId, customText, profile } = req.body;
        if (!analysisId) return res.status(400).json({ message: "analysisId obrigatório." });
        const analysis = await MarketAnalysis.findById(analysisId);
        if (!analysis) return res.status(404).json({ message: "Análise não encontrada." });

        // Perfil opcional: grava a narrativa específica do perfil; sem perfil usa o campo único (legado/fallback).
        const validProfile = ['DEFENSIVE', 'MODERATE', 'BOLD'].includes(profile) ? profile : null;
        const saveText = (text) => {
            if (validProfile) {
                if (!analysis.generatedExplainableAIByProfile) analysis.generatedExplainableAIByProfile = {};
                analysis.generatedExplainableAIByProfile[validProfile] = text;
                analysis.markModified('generatedExplainableAIByProfile');
            } else {
                analysis.generatedExplainableAI = text;
            }
        };

        if (customText) {
            saveText(customText);
            await analysis.save();
            return res.json({ generatedExplainableAI: customText, profile: validProfile });
        }

        if (!analysis.explainableAIPrompt) return res.status(400).json({ message: "Prompt não gerado ainda. Rode o sync primeiro." });
        if (!process.env.API_KEY) return res.status(503).json({ message: "API_KEY não configurada." });
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = validProfile
            ? `${analysis.explainableAIPrompt}\n\nIMPORTANTE: Escreva a análise focada exclusivamente no perfil ${PROFILE_LABEL_PT[validProfile]}, destacando os ativos e a tese adequados a esse perfil de risco.`
            : analysis.explainableAIPrompt;
        const response = await ai.models.generateContent({ model: 'gemini-2.0-flash-exp', contents: prompt });
        saveText(response.text);
        await analysis.save();
        res.json({ generatedExplainableAI: response.text, profile: validProfile });
    } catch (error) { next(error); }
};

export const listReports = async (req, res, next) => { try { const reports = await MarketAnalysis.aggregate([ { $sort: { createdAt: -1 } }, { $limit: 50 }, { $project: { date: 1, assetClass: 1, strategy: 1, isRankingPublished: 1, isMorningCallPublished: 1, isReportPublished: 1, isExplainableAIPublished: 1, generatedBy: 1, morningCallPresent: { $cond: [{ $ifNull: ["$content.morningCall", false] }, true, false] }, rankingCount: { $size: { $ifNull: ["$content.ranking", []] } }, hasComparisonReport: { $cond: [{ $ifNull: ["$comparisonReport", false] }, true, false] }, hasGeneratedAI: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$generatedExplainableAI", ""] } }, 0] }, true, false] } } } ]); res.json(reports); } catch (error) { next(error); } };
export const getReportDetails = async (req, res, next) => { try { const report = await MarketAnalysis.findById(req.params.id); if (!report) return res.status(404).json({ message: "Not found" }); res.json(report); } catch (error) { next(error); } };
// Gate de plano AUTORITATIVO por classe de ativo (o frontend só esconde; a
// autorização real é aqui). Mapeia cada assetClass à sua feature em LIMITS_CONFIG,
// espelhando os minPlan das abas em client/src/pages/Research.tsx:
// - STOCK/FII/CRYPTO/ETF → research_general (PRO+)
// - STOCK_US/REIT (Ativos Globais) → research_global (ELITE/BLACK)
// BRASIL_10 e FIXED_INCOME ficam FORA do gate de propósito: CLAUDE.md os trata
// como acessíveis a planos básicos (Brasil 10 até GUEST) — não os restringimos aqui.
const RESEARCH_FEATURE_BY_CLASS = {
    STOCK: 'research_general',
    FII: 'research_general',
    CRYPTO: 'research_general',
    ETF: 'research_general',
    STOCK_US: 'research_global',
    REIT: 'research_global',
};

const RESEARCH_DENIED_MESSAGE = {
    research_general: 'Pesquisa de Ações, FIIs e Cripto disponível a partir do plano Pro.',
    research_global: 'Ativos Globais disponível nos planos Elite e Black.',
};

export const getLatestReport = async (req, res, next) => {
    try {
        const { assetClass, strategy } = req.query;

        // Enforcement de plano no backend (autoritativo). O gate legado só cobria
        // STOCK_US/REIT; STOCK/FII/CRYPTO ficavam abertos a qualquer autenticado.
        const feature = RESEARCH_FEATURE_BY_CLASS[assetClass];
        if (feature) {
            const userPlan = req.user?.plan || 'GUEST';
            const isAdmin = req.user?.role === 'ADMIN';
            const hasAccess = isAdmin || (LIMITS_CONFIG[feature]?.[userPlan] > 0);
            if (!hasAccess) {
                return res.status(403).json({ message: RESEARCH_DENIED_MESSAGE[feature] });
            }
        }

        const report = await MarketAnalysis.findOne({
            assetClass,
            strategy,
            // Visível se QUALQUER seção foi publicada. Sem o flag de Explainable AI aqui,
            // um relatório publicado só com a IA (sem ranking) ficava invisível ao usuário.
            $or: [{ isRankingPublished: true }, { isMorningCallPublished: true }, { isExplainableAIPublished: true }]
        }).select('-content.fullAuditLog').sort({ createdAt: -1 });

        if (!report) return res.status(404).json({ message: "Indisponível" });
        res.json(report);
    } catch (error) { next(error); }
};
