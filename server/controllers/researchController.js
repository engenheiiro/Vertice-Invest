
import MarketAnalysis from '../models/MarketAnalysis.js';
import TreasuryBond from '../models/TreasuryBond.js';
import { aiResearchService } from '../services/aiResearchService.js';
import { aiEnhancementService } from '../services/aiEnhancementService.js';
import { marketDataService } from '../services/marketDataService.js';
import { macroDataService } from '../services/macroDataService.js'; // Nova Importação
import { syncService } from '../services/syncService.js'; 
import logger from '../config/logger.js';

export const getMacroData = async (req, res, next) => {
    try {
        const indicators = await marketDataService.getMacroIndicators();
        const bonds = await TreasuryBond.find({}).sort({ type: 1, rate: 1 });

        res.json({
            ...indicators,
            bonds: bonds 
        });
    } catch (error) { next(error); }
};

export const triggerMarketSync = async (req, res, next) => {
    try {
        logger.info("👆 Admin disparou Sincronização Manual de Dados (Preços/Fundamentos).");
        const result = await syncService.performFullSync();
        res.json({ message: "Sincronização iniciada com sucesso.", details: result });
    } catch (error) {
        next(error);
    }
};

// Nova Função: Dispara apenas o Sync Macro (Rápido)
export const triggerMacroSync = async (req, res, next) => {
    try {
        logger.info("👆 Admin disparou Sincronização Manual de Macroeconomia.");
        const result = await macroDataService.performMacroSync();
        res.json({ message: "Indicadores Macro e S&P 500 atualizados.", data: result });
    } catch (error) {
        logger.error(`Erro Macro Sync Manual: ${error.message}`);
        next(error);
    }
};

// Nova Função: Executa Sync COMPLETO seguido de Cálculo (Igual ao CLI sync:prod)
export const runFullPipeline = async (req, res, next) => {
    try {
        const adminId = req.user?.id;
        logger.info(`🚀 [PIPELINE] Admin iniciou Ciclo Completo (Sync + Calc)...`);

        // 1. Sync
        const syncResult = await syncService.performFullSync();
        if (!syncResult.success) {
            return res.status(500).json({ message: "Falha no Sync de Dados. Cálculo abortado.", error: syncResult.error });
        }

        // 2. Calc
        await aiResearchService.runBatchAnalysis(adminId);

        logger.info(`✅ [PIPELINE] Ciclo Completo Finalizado com Sucesso.`);
        res.json({ message: "Protocolo V3 (Sync + Análise) concluído com sucesso!" });

    } catch (error) {
        logger.error(`FATAL PIPELINE: ${error.message}`);
        next(error);
    }
};

export const crunchNumbers = async (req, res, next) => {
    try {
        const { assetClass, isBulk } = req.body;
        const strat = 'BUY_HOLD';
        const adminId = req.user?.id;
        
        if (isBulk) {
            await aiResearchService.runBatchAnalysis(adminId);
            if (res) return res.json({ message: "Cálculo Matemático Finalizado (Bulk)." });
            return;
        }

        logger.info(`🚀 [FORTRESS] Calculando Single: ${assetClass}...`);
        
        const { ranking, fullList } = await aiResearchService.calculateRanking(assetClass, strat);
        
        await MarketAnalysis.create({ 
            assetClass, 
            strategy: strat, 
            content: { ranking, fullAuditLog: fullList }, 
            generatedBy: adminId 
        });

        return res.status(201).json({ message: "Análise Quantitativa Gerada." });

    } catch (error) { 
        logger.error(`FATAL: ${error.message}`);
        if (next) next(error);
    }
};

export const enhanceWithAI = async (req, res, next) => {
    try {
        const { assetClass, strategy } = req.body;
        const latestReport = await MarketAnalysis.findOne({ assetClass, strategy }).sort({ createdAt: -1 });
        if (!latestReport) return res.status(404).json({ message: "Gere a análise matemática primeiro." });
        const enhancedRanking = await aiEnhancementService.enhanceRankingWithNews(latestReport.content.ranking, assetClass);
        latestReport.content.ranking = enhancedRanking;
        latestReport.isMorningCallPublished = false; 
        await latestReport.save();
        return res.json({ message: "Ranking refinado com IA.", ranking: enhancedRanking });
    } catch (error) { next(error); }
};

export const generateNarrative = async (req, res, next) => {
    try {
        const { analysisId } = req.body;
        const analysis = await MarketAnalysis.findById(analysisId);
        if (!analysis) return res.status(404).json({ message: "Not found" });
        const narrative = await aiResearchService.generateNarrative(analysis.content.ranking, analysis.assetClass);
        analysis.content.morningCall = narrative;
        await analysis.save();
        if (res) res.json({ morningCall: narrative });
    } catch (error) { next(error); }
};

export const publishContent = async (req, res, next) => {
    try {
        const { analysisId, type } = req.body;
        const analysis = await MarketAnalysis.findById(analysisId);
        if (!analysis) return res.status(404).json({ message: "Not found" });
        if (type === 'RANKING' || type === 'BOTH') analysis.isRankingPublished = true;
        if (type === 'MORNING_CALL' || type === 'BOTH') analysis.isMorningCallPublished = true;
        await analysis.save();
        if (res) res.json({ message: "Sucesso" });
    } catch (error) { next(error); }
};

export const listReports = async (req, res, next) => {
    try {
        const reports = await MarketAnalysis.aggregate([
            { $sort: { createdAt: -1 } }, { $limit: 50 },
            { $project: { date: 1, assetClass: 1, strategy: 1, isRankingPublished: 1, isMorningCallPublished: 1, generatedBy: 1, morningCallPresent: { $cond: [{ $ifNull: ["$content.morningCall", false] }, true, false] }, rankingCount: { $size: { $ifNull: ["$content.ranking", []] } } } }
        ]);
        const mapped = reports.map(r => ({ ...r, _id: r._id, content: { morningCall: r.morningCallPresent ? "YES" : null, ranking: new Array(r.rankingCount).fill({}) } }));
        res.json(mapped);
    } catch (error) { next(error); }
};

export const getReportDetails = async (req, res, next) => {
    try {
        const report = await MarketAnalysis.findById(req.params.id);
        if (!report) return res.status(404).json({ message: "Not found" });
        res.json(report);
    } catch (error) { next(error); }
};

export const getLatestReport = async (req, res, next) => {
    try {
        const { assetClass, strategy } = req.query;
        const report = await MarketAnalysis.findOne({ assetClass, strategy, $or: [{ isRankingPublished: true }, { isMorningCallPublished: true }] }).select('-content.fullAuditLog').sort({ createdAt: -1 });
        if (!report) return res.status(404).json({ message: "Indisponível" });
        res.json(report);
    } catch (error) { next(error); }
};

export const triggerDailyRoutine = async (req, res) => {
    await aiResearchService.runBatchAnalysis(null);
    if (res) res.json({ message: "Batch process finished" });
};
