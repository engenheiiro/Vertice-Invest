import MarketAnalysis from '../models/MarketAnalysis.js';
import { aiResearchService } from '../services/aiResearchService.js';
import logger from '../config/logger.js';

const getDiversifiedTop10 = (allAssets) => {
    const finalRanking = [];
    const sectorCount = {};
    const MAX_PER_SECTOR = 6; 

    const candidates = [...allAssets].sort((a, b) => b.score - a.score);
    const addedTickers = new Set();

    for (const asset of candidates) {
        if (finalRanking.length >= 10) break;

        const sector = asset.sector || 'Outros';
        const currentCount = sectorCount[sector] || 0;

        if (currentCount < MAX_PER_SECTOR) {
            finalRanking.push(asset);
            addedTickers.add(asset.ticker);
            sectorCount[sector] = currentCount + 1;
        }
    }

    if (finalRanking.length < 10) {
        for (const asset of candidates) {
            if (finalRanking.length >= 10) break;
            
            if (!addedTickers.has(asset.ticker)) {
                finalRanking.push(asset);
                addedTickers.add(asset.ticker);
            }
        }
    }
    
    return finalRanking
        .sort((a, b) => b.score - a.score)
        .map((item, idx) => ({ ...item, position: idx + 1 }));
};

export const crunchNumbers = async (req, res, next) => {
    try {
        const { assetClass, strategy, isBulk } = req.body;
        
        if (isBulk) {
            logger.info("🚀 [ASYNC] Iniciando processamento em lote ordenado...");
            
            if (res) res.status(202).json({ message: "Processamento iniciado. Acompanhe pelo painel." });

            (async () => {
                const strat = 'BUY_HOLD';
                const baseClasses = ['STOCK', 'FII', 'STOCK_US', 'CRYPTO'];
                
                logger.info("Phase 1: Processando Ativos Base...");
                
                for (const aClass of baseClasses) {
                    try {
                        const allScoredAssets = await aiResearchService.calculateRanking(aClass, strat);
                        
                        if (allScoredAssets && allScoredAssets.length > 0) {
                            const ranking = getDiversifiedTop10(allScoredAssets);
                            const fullAuditLog = allScoredAssets;

                            await MarketAnalysis.create({
                                assetClass: aClass,
                                strategy: strat,
                                isRankingPublished: false,
                                isMorningCallPublished: false,
                                content: { ranking, fullAuditLog },
                                generatedBy: req.user?.id
                            });
                            logger.info(`💾 [DB] ${aClass} salvo: ${fullAuditLog.length} analisados.`);
                        } else {
                            logger.warn(`⚠️ [DB] ${aClass} retornou 0 ativos. Nada foi salvo.`);
                        }
                    } catch (err) {
                        logger.error(`Erro Phase 1 (${aClass}): ${err.message}`);
                    }
                }

                logger.info("Phase 2: Agregando Carteira BRASIL_10 (Top 5 Ações + Top 5 FIIs)...");
                try {
                    // Busca os relatórios recém-criados na Fase 1
                    const stockReport = await MarketAnalysis.findOne({ assetClass: 'STOCK', strategy: strat }).sort({ createdAt: -1 });
                    const fiiReport = await MarketAnalysis.findOne({ assetClass: 'FII', strategy: strat }).sort({ createdAt: -1 });

                    if (stockReport && fiiReport) {
                        // Pega os melhores de cada categoria (usando fullAuditLog para ter o universo completo e reordenar)
                        const stocksSource = stockReport.content.fullAuditLog.length > 0 ? stockReport.content.fullAuditLog : stockReport.content.ranking;
                        const fiisSource = fiiReport.content.fullAuditLog.length > 0 ? fiiReport.content.fullAuditLog : fiiReport.content.ranking;

                        // Top 5 Ações
                        const top5Stocks = stocksSource
                            .sort((a, b) => b.score - a.score)
                            .slice(0, 5);

                        // Top 5 FIIs
                        const top5FIIs = fiisSource
                            .sort((a, b) => b.score - a.score)
                            .slice(0, 5);

                        // Combina e Reordena por Score Global
                        let mixedList = [...top5Stocks, ...top5FIIs].sort((a, b) => b.score - a.score);

                        // Sanitiza e Renumera Posições
                        mixedList = mixedList.map((item, idx) => {
                            const cleanItem = item.toObject ? item.toObject() : item;
                            return {
                                ...cleanItem,
                                _id: undefined, // Remove ID antigo para criar novo subdocumento
                                position: idx + 1
                            };
                        });
                        
                        await MarketAnalysis.create({
                            assetClass: 'BRASIL_10',
                            strategy: strat,
                            isRankingPublished: false,
                            isMorningCallPublished: false,
                            content: { 
                                ranking: mixedList, 
                                fullAuditLog: mixedList // Para Brasil 10, o log é a própria seleção curada
                            }, 
                            generatedBy: req.user?.id
                        });
                        logger.info(`💾 [DB] BRASIL_10 salvo com sucesso (Composição 50/50).`);
                    } else {
                        logger.warn("⚠️ Relatórios base (STOCK/FII) não encontrados para compor BRASIL_10.");
                    }
                } catch (err) {
                    logger.error(`Erro Phase 2 (BRASIL_10): ${err.message}`);
                }

                logger.info("🏁 [ASYNC] Processamento em lote finalizado.");
            })();
            return;
        }

        // ... (Lógica Single permanece igual) ...
        logger.info(`🚀 Iniciando Análise Síncrona: ${assetClass}`);
        const strat = 'BUY_HOLD';
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
    if (res) res.json({ message: "Batch process started", count: result ? result.length : 0 });
};