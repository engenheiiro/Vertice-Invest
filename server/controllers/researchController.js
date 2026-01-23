import MarketAnalysis from '../models/MarketAnalysis.js';
import { aiResearchService } from '../services/aiResearchService.js';
import logger from '../config/logger.js';

// Helper para aplicar diversificação apenas no recorte do Top 10
const getDiversifiedTop10 = (allAssets) => {
    const finalRanking = [];
    const sectorCount = {};
    const MAX_PER_SECTOR = 3; 

    // Copia para não mutar o original
    const candidates = [...allAssets];

    for (const asset of candidates) {
        const sector = asset.sector || 'Outros';
        const currentCount = sectorCount[sector] || 0;

        // Se já temos 10, paramos
        if (finalRanking.length >= 10) break;

        if (currentCount < MAX_PER_SECTOR) {
            finalRanking.push(asset);
            sectorCount[sector] = currentCount + 1;
        }
    }
    
    // Reindexar posições visualmente para 1..10
    return finalRanking.map((item, idx) => ({ ...item, position: idx + 1 }));
};

export const crunchNumbers = async (req, res, next) => {
    try {
        const { assetClass, strategy, isBulk } = req.body;
        
        // --- MODO BACKGROUND (Para Bulk) ---
        if (isBulk) {
            logger.info("🚀 [ASYNC] Iniciando processamento em lote ordenado...");
            
            if (res) res.status(202).json({ message: "Processamento iniciado. Acompanhe pelo painel." });

            (async () => {
                const strat = 'BUY_HOLD';
                
                // FASE 1: Ativos Base (Independentes)
                const baseClasses = ['STOCK', 'FII', 'STOCK_US', 'CRYPTO'];
                
                logger.info("Phase 1: Processando Ativos Base...");
                
                // Executa sequencialmente para não sobrecarregar API e garantir ordem de log
                for (const aClass of baseClasses) {
                    try {
                        const allScoredAssets = await aiResearchService.calculateRanking(aClass, strat);
                        
                        if (allScoredAssets && allScoredAssets.length > 0) {
                            // Top 10 Diversificado para exibição rápida
                            const ranking = getDiversifiedTop10(allScoredAssets);
                            
                            // Auditoria mantém TUDO (ex: 50 ativos)
                            const fullAuditLog = allScoredAssets;

                            await MarketAnalysis.create({
                                assetClass: aClass,
                                strategy: strat,
                                isRankingPublished: false,
                                isMorningCallPublished: false,
                                content: { ranking, fullAuditLog },
                                generatedBy: req.user?.id
                            });
                            logger.info(`💾 [DB] ${aClass} salvo: ${fullAuditLog.length} analisados, ${ranking.length} no Top 10.`);
                        }
                    } catch (err) {
                        logger.error(`Erro Phase 1 (${aClass}): ${err.message}`);
                    }
                }

                // FASE 2: Derivativos (Brasil 10 depende dos anteriores salvos no DB)
                logger.info("Phase 2: Processando Carteiras Compostas (Brasil 10)...");
                try {
                    const br10Assets = await aiResearchService.calculateRanking('BRASIL_10', strat);
                    if (br10Assets && br10Assets.length > 0) {
                        const ranking = br10Assets.slice(0, 10).map((a, i) => ({...a, position: i+1}));
                        
                        await MarketAnalysis.create({
                            assetClass: 'BRASIL_10',
                            strategy: strat,
                            isRankingPublished: false,
                            isMorningCallPublished: false,
                            content: { ranking, fullAuditLog: br10Assets }, // No BR10, audit é igual ao ranking pois é composto
                            generatedBy: req.user?.id
                        });
                        logger.info(`💾 [DB] BRASIL_10 salvo.`);
                    }
                } catch (err) {
                    logger.error(`Erro Phase 2 (BRASIL_10): ${err.message}`);
                }

                logger.info("🏁 [ASYNC] Processamento em lote finalizado com sucesso.");
            })();
            return;
        }

        // --- MODO SÍNCRONO (Single) ---
        logger.info(`🚀 Iniciando Análise Síncrona: ${assetClass}`);
        const strat = 'BUY_HOLD'; // Default
        const allScoredAssets = await aiResearchService.calculateRanking(assetClass, strat);
        
        const results = [];
        if (allScoredAssets && allScoredAssets.length > 0) {
            const ranking = getDiversifiedTop10(allScoredAssets);
            const fullAuditLog = allScoredAssets;

            const analysis = await MarketAnalysis.create({
                assetClass: assetClass,
                strategy: strat,
                isRankingPublished: false,
                isMorningCallPublished: false,
                content: { ranking, fullAuditLog },
                generatedBy: req.user?.id
            });
            results.push(analysis);
        }

        if (res) res.status(201).json(results);

    } catch (error) { 
        if (next) next(error);
        else throw error;
    }
};

export const generateNarrative = async (req, res, next) => {
    try {
        const { analysisId } = req.body;
        const analysis = await MarketAnalysis.findById(analysisId);
        if (!analysis) {
            if (res) return res.status(404).json({ message: "Análise não encontrada." });
            return null;
        }

        const narrative = await aiResearchService.generateNarrative(
            analysis.content.ranking, 
            analysis.assetClass
        );

        analysis.content.morningCall = narrative;
        await analysis.save();

        if (res) res.json({ morningCall: narrative });
        return narrative;
    } catch (error) { 
        if (next) next(error);
        else throw error;
    }
};

export const publishContent = async (req, res, next) => {
    try {
        const { analysisId, type } = req.body;
        const analysis = await MarketAnalysis.findById(analysisId);
        if (!analysis) return res.status(404).json({ message: "Not found" });
        
        if (type === 'RANKING') analysis.isRankingPublished = true;
        if (type === 'MORNING_CALL') analysis.isMorningCallPublished = true;
        if (type === 'BOTH') {
            analysis.isRankingPublished = true;
            analysis.isMorningCallPublished = true;
        }
        
        await analysis.save();
        if (res) res.json({ message: "Sucesso" });
    } catch (error) { next(error); }
};

export const listReports = async (req, res, next) => {
    try {
        const reports = await MarketAnalysis.find()
            .select('date assetClass strategy isRankingPublished isMorningCallPublished content.morningCall') 
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(reports);
    } catch (error) { next(error); }
};

export const getReportDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const report = await MarketAnalysis.findById(id);
        if (!report) return res.status(404).json({ message: "Report not found" });
        res.json(report);
    } catch (error) { next(error); }
};

export const getLatestReport = async (req, res, next) => {
    try {
        const { assetClass, strategy } = req.query;
        const report = await MarketAnalysis.findOne({ 
            assetClass, 
            strategy,
            $or: [{ isRankingPublished: true }, { isMorningCallPublished: true }]
        })
        .select('-content.fullAuditLog') 
        .sort({ createdAt: -1 });

        if (!report) return res.status(404).json({ message: "Indisponível" });
        res.json(report);
    } catch (error) { next(error); }
};

export const triggerDailyRoutine = async (req, res, isInternal = false) => {
    logger.info("Executando rotina diária automática via trigger.");
    const result = await crunchNumbers({ body: { isBulk: true } }, null, null);
    if (res) res.json({ message: "Batch process started", count: result.length });
};