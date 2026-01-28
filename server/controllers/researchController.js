
import MarketAnalysis from '../models/MarketAnalysis.js';
import TreasuryBond from '../models/TreasuryBond.js';
import { aiResearchService } from '../services/aiResearchService.js';
import { aiEnhancementService } from '../services/aiEnhancementService.js';
import { marketDataService } from '../services/marketDataService.js';
import logger from '../config/logger.js';

// Função de dump em arquivo removida para evitar conflitos com Nodemon
const generateDataBump = (assetClass, dataList) => {
    // Log apenas no console
    logger.info(`📊 [DUMP VIRTUAL] Análise ${assetClass} gerada com ${dataList.length} itens.`);
};

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
        logger.info("👆 Admin disparou Sincronização Manual de Dados.");
        const result = await marketDataService.performFullSync();
        res.json({ message: "Sincronização iniciada com sucesso.", details: result });
    } catch (error) {
        next(error);
    }
};

// --- HELPER DE DIVERSIFICAÇÃO ROBUSTO ---
const getDiverseCandidates = (list, count, maxPerSector = 2) => {
    const selected = [];
    const sectorCounts = {};
    const usedTickers = new Set();

    // Ordena por Score decrescente e prioriza Defensivos/Moderados
    const sortedList = list.sort((a, b) => {
        // Prioridade de Perfil: DEFENSIVE > MODERATE > BOLD
        const profileScore = { 'DEFENSIVE': 3, 'MODERATE': 2, 'BOLD': 1 };
        const pA = profileScore[a.riskProfile] || 0;
        const pB = profileScore[b.riskProfile] || 0;
        
        if (pA !== pB) return pB - pA; // Maior perfil primeiro
        return b.score - a.score; // Maior score depois
    });

    // PASSAGEM 1: Tenta preencher respeitando o limite estrito (ex: 2)
    for (const asset of sortedList) {
        if (selected.length >= count) break;
        if (usedTickers.has(asset.ticker)) continue;

        const sector = asset.sector || 'Outros';
        const currentCount = sectorCounts[sector] || 0;

        if (currentCount < maxPerSector) {
            selected.push(asset);
            sectorCounts[sector] = currentCount + 1;
            usedTickers.add(asset.ticker);
        }
    }

    // PASSAGEM 2 (Fallback Suave): Se não preencheu, relaxa o limite para +1 (ex: 3)
    if (selected.length < count) {
        const relaxedLimit = maxPerSector + 1;
        for (const asset of sortedList) {
            if (selected.length >= count) break;
            if (usedTickers.has(asset.ticker)) continue;

            const sector = asset.sector || 'Outros';
            const currentCount = sectorCounts[sector] || 0;

            if (currentCount < relaxedLimit) {
                selected.push(asset);
                sectorCounts[sector] = currentCount + 1;
                usedTickers.add(asset.ticker);
            }
        }
    }

    // PASSAGEM 3 (Fallback Final): Preenche com o que tiver de melhor, ignorando setor
    // Isso é necessário para nunca entregar uma lista menor que 'count' (ex: 10),
    // mesmo que viole a diversificação (culpa do banco de dados pequeno).
    if (selected.length < count) {
        for (const asset of sortedList) {
            if (selected.length >= count) break;
            if (!usedTickers.has(asset.ticker)) {
                selected.push(asset);
                usedTickers.add(asset.ticker);
            }
        }
    }

    return selected;
};

export const crunchNumbers = async (req, res, next) => {
    try {
        const { assetClass, isBulk } = req.body;
        const strat = 'BUY_HOLD';
        const adminId = req.user?.id;
        
        if (isBulk) {
            logger.info("🚀 [FORTRESS] Iniciando Bulk Run (Processamento em Massa)...");
            
            const stockData = await aiResearchService.calculateRanking('STOCK', strat);
            await MarketAnalysis.create({ assetClass: 'STOCK', strategy: strat, content: { ranking: stockData.ranking, fullAuditLog: stockData.fullList }, generatedBy: adminId });
            
            const fiiData = await aiResearchService.calculateRanking('FII', strat);
            await MarketAnalysis.create({ assetClass: 'FII', strategy: strat, content: { ranking: fiiData.ranking, fullAuditLog: fiiData.fullList }, generatedBy: adminId });

            // GERAÇÃO DO BRASIL 10 (MIX)
            // Seleciona 5 Ações e 5 FIIs respeitando limite de 2 por setor EM CADA CLASSE
            const top5Stocks = getDiverseCandidates(stockData.fullList, 5, 2); 
            const top5FIIs = getDiverseCandidates(fiiData.fullList, 5, 2);
            
            let brasil10List = [...top5Stocks, ...top5FIIs]
                .sort((a, b) => b.score - a.score)
                .map((item, idx) => ({ 
                    ...item, 
                    position: idx + 1,
                    // Força perfil visual adequado no Top 10 consolidado
                    riskProfile: item.score >= 80 ? 'DEFENSIVE' : 'MODERATE' 
                })); 
            
            await MarketAnalysis.create({ assetClass: 'BRASIL_10', strategy: strat, content: { ranking: brasil10List, fullAuditLog: brasil10List }, generatedBy: adminId });

            if (res) return res.json({ message: "Cálculo Matemático Finalizado." });
            return;
        }

        // Single Request Logic
        logger.info(`🚀 [FORTRESS] Calculando Single: ${assetClass}...`);
        
        if (assetClass === 'BRASIL_10') {
             const stockData = await aiResearchService.calculateRanking('STOCK', strat);
             const fiiData = await aiResearchService.calculateRanking('FII', strat);
             
             // Aplica a mesma lógica de diversificação estrita
             const top5Stocks = getDiverseCandidates(stockData.fullList, 5, 2);
             const top5FIIs = getDiverseCandidates(fiiData.fullList, 5, 2);
             
             const ranking = [...top5Stocks, ...top5FIIs].sort((a, b) => b.score - a.score);
            
            await MarketAnalysis.create({ assetClass, strategy: strat, content: { ranking, fullAuditLog: ranking }, generatedBy: adminId });
            return res.status(201).json({ message: "Brasil 10 Gerado com Diversificação." });
        }

        const { ranking, fullList } = await aiResearchService.calculateRanking(assetClass, strat);
        // Aplica diversificação também nos rankings individuais (Top 10 Ações, Top 10 FIIs)
        const diverseRanking = getDiverseCandidates(fullList, 10, 2); // Top 10, máx 2 por setor

        await MarketAnalysis.create({ assetClass, strategy: strat, content: { ranking: diverseRanking, fullAuditLog: fullList }, generatedBy: adminId });

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
    await crunchNumbers({ body: { isBulk: true } }, null, null);
    if (res) res.json({ message: "Batch process finished" });
};
