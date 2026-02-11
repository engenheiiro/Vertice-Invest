
import MarketAnalysis from '../models/MarketAnalysis.js';
import TreasuryBond from '../models/TreasuryBond.js';
import QuantSignal from '../models/QuantSignal.js';
import MarketAsset from '../models/MarketAsset.js'; // Import Necessário para o Enrich
import SystemConfig from '../models/SystemConfig.js'; 
import { aiResearchService } from '../services/aiResearchService.js';
import { aiEnhancementService } from '../services/aiEnhancementService.js';
import { marketDataService } from '../services/marketDataService.js';
import { macroDataService } from '../services/macroDataService.js';
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

export const getQuantSignals = async (req, res, next) => {
    try {
        const { history } = req.query;
        let query = {};
        let limit = 20;
        
        if (history === 'true') {
            query = {}; 
            limit = 200; // Aumentado para pegar mais histórico na tabela
        } else {
            query = { status: 'ACTIVE' }; 
        }

        // 1. Busca Sinais
        const signals = await QuantSignal.find(query)
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean(); 
            
        // 2. Enriquecimento em Tempo Real (Para sinais ativos)
        const activeSignals = signals.filter(s => s.status === 'ACTIVE');
        
        if (activeSignals.length > 0) {
            const tickers = activeSignals.map(s => s.ticker);
            const assets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker lastPrice');
            const priceMap = new Map();
            assets.forEach(a => priceMap.set(a.ticker, a.lastPrice));

            signals.forEach(signal => {
                if (signal.status === 'ACTIVE') {
                    const currentPrice = priceMap.get(signal.ticker);
                    if (currentPrice) {
                        signal.finalPrice = currentPrice; // Preço Atual
                        if (signal.priceAtSignal) {
                            signal.resultPercent = ((currentPrice - signal.priceAtSignal) / signal.priceAtSignal) * 100;
                        }
                    }
                }
            });
        }

        res.json(signals);
    } catch (error) { next(error); }
};

// NOVO: Estatísticas do Radar (Heatmap Separado)
export const getRadarStats = async (req, res, next) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // 1. Taxa de Acerto (Geral)
        const hitMissStats = await QuantSignal.aggregate([
            { $match: { 
                status: { $in: ['HIT', 'MISS'] } 
            }},
            { $group: { 
                _id: "$status", 
                count: { $sum: 1 } 
            }}
        ]);

        const hits = hitMissStats.find(s => s._id === 'HIT')?.count || 0;
        const misses = hitMissStats.find(s => s._id === 'MISS')?.count || 0;
        const totalClosed = hits + misses;
        const winRate = totalClosed > 0 ? (hits / totalClosed) * 100 : 0;

        // 2. Setores Quentes (FECHADOS/HITS) - Onde deu lucro?
        const closedSectors = await QuantSignal.aggregate([
            { $match: { 
                status: 'HIT'
            }},
            { $group: { 
                _id: "$sector", 
                count: { $sum: 1 },
                avgReturn: { $avg: "$resultPercent" }
            }},
            { $sort: { count: -1 } },
            { $limit: 6 }
        ]);

        // 3. Setores Quentes (ABERTOS/ACTIVE) - Onde está o risco agora?
        const openSectors = await QuantSignal.aggregate([
            { $match: { 
                status: 'ACTIVE'
            }},
            { $group: { 
                _id: "$sector", 
                count: { $sum: 1 },
                avgReturn: { $avg: 0 } // Em aberto não tem retorno consolidado fixo, mas ok
            }},
            { $sort: { count: -1 } },
            { $limit: 6 }
        ]);

        // Config Atual
        const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });

        res.json({
            winRate: parseFloat(winRate.toFixed(1)),
            totalSignals: totalClosed,
            heatmapClosed: closedSectors.map(s => ({
                sector: s._id || 'Outros',
                value: s.count,
                avgReturn: parseFloat(s.avgReturn.toFixed(2))
            })),
            heatmapOpen: openSectors.map(s => ({
                sector: s._id || 'Outros',
                value: s.count,
                avgReturn: 0
            })),
            backtestHorizon: config?.backtestHorizon || 7
        });

    } catch (error) { next(error); }
};

// NOVO: Limpar Histórico do Radar
export const clearRadarHistory = async (req, res, next) => {
    try {
        await QuantSignal.deleteMany({});
        logger.info(`🗑️ [Admin] Histórico do Radar Alpha limpo por ${req.user.email}`);
        res.json({ message: "Histórico do Radar limpo com sucesso." });
    } catch (error) { next(error); }
};

export const updateBacktestConfig = async (req, res, next) => {
    try {
        const { days } = req.body;
        if (![3, 7, 15, 30].includes(days)) {
            return res.status(400).json({ message: "Horizonte inválido." });
        }

        await SystemConfig.findOneAndUpdate(
            { key: 'MACRO_INDICATORS' },
            { $set: { backtestHorizon: days } },
            { upsert: true }
        );

        res.json({ message: `Horizonte de backtest atualizado para ${days} dias.` });
    } catch (error) { next(error); }
};

export const triggerMarketSync = async (req, res, next) => {
    try {
        const result = await syncService.performFullSync();
        res.json({ message: "Sincronização iniciada.", details: result });
    } catch (error) { next(error); }
};

export const triggerMacroSync = async (req, res, next) => {
    try {
        const result = await macroDataService.performMacroSync();
        res.json({ message: "Macro atualizado.", data: result });
    } catch (error) { next(error); }
};

export const runFullPipeline = async (req, res, next) => {
    try {
        const adminId = req.user?.id;
        const syncResult = await syncService.performFullSync();
        if (!syncResult.success) {
            return res.status(500).json({ message: "Falha Sync.", error: syncResult.error });
        }
        await aiResearchService.runBatchAnalysis(adminId);
        res.json({ message: "Pipeline V3 completo." });
    } catch (error) { next(error); }
};

export const crunchNumbers = async (req, res, next) => {
    try {
        const { assetClass, isBulk } = req.body;
        const adminId = req.user?.id;
        if (isBulk) {
            await aiResearchService.runBatchAnalysis(adminId);
            if (res) return res.json({ message: "Bulk Calc OK." });
            return;
        }
        const { ranking, fullList } = await aiResearchService.calculateRanking(assetClass, 'BUY_HOLD');
        await MarketAnalysis.create({ assetClass, strategy: 'BUY_HOLD', content: { ranking, fullAuditLog: fullList }, generatedBy: adminId });
        return res.status(201).json({ message: "Análise Gerada." });
    } catch (error) { if (next) next(error); }
};

export const enhanceWithAI = async (req, res, next) => {
    try {
        const { assetClass, strategy } = req.body;
        const latestReport = await MarketAnalysis.findOne({ assetClass, strategy }).sort({ createdAt: -1 });
        if (!latestReport) return res.status(404).json({ message: "Relatório não encontrado." });
        const enhancedRanking = await aiEnhancementService.enhanceRankingWithNews(latestReport.content.ranking, assetClass);
        latestReport.content.ranking = enhancedRanking;
        latestReport.isMorningCallPublished = false; 
        await latestReport.save();
        return res.json({ message: "Refinamento IA concluído.", ranking: enhancedRanking });
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
        if (res) res.json({ message: "Publicado." });
    } catch (error) { next(error); }
};

export const listReports = async (req, res, next) => {
    try {
        const reports = await MarketAnalysis.aggregate([
            { $sort: { createdAt: -1 } }, { $limit: 50 },
            { $project: { date: 1, assetClass: 1, strategy: 1, isRankingPublished: 1, isMorningCallPublished: 1, generatedBy: 1, morningCallPresent: { $cond: [{ $ifNull: ["$content.morningCall", false] }, true, false] }, rankingCount: { $size: { $ifNull: ["$content.ranking", []] } } } }
        ]);
        res.json(reports);
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
