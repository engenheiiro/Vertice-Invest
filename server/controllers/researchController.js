
import MarketAnalysis from '../models/MarketAnalysis.js';
import { aiResearchService } from '../services/aiResearchService.js';
import { marketDataService } from '../services/marketDataService.js';
import logger from '../config/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Função auxiliar para gerar TXT físico (Databump)
const generateDataBump = (assetClass, dataList) => {
    try {
        const dumpDir = path.resolve(__dirname, '../data_dump');
        if (!fs.existsSync(dumpDir)) {
            fs.mkdirSync(dumpDir, { recursive: true });
        }

        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = `RANKING_${assetClass}_${dateStr}.txt`;
        const filePath = path.join(dumpDir, fileName);

        let content = `VÉRTICE RESEARCH - RELATÓRIO ALGORÍTMICO\n`;
        content += `Data: ${new Date().toLocaleString('pt-BR')}\n`;
        content += `Classe: ${assetClass}\n`;
        content += `Ativos Analisados: ${dataList.length}\n`;
        content += `--------------------------------------------------------\n`;
        content += `POS | TICKER | SCORE | AÇÃO | PREÇO ATUAL | PREÇO JUSTO | YIELD\n`;
        content += `--------------------------------------------------------\n`;

        dataList.forEach((item, idx) => {
            const line = `${(idx + 1).toString().padEnd(3)} | ${item.ticker.padEnd(6)} | ${item.score.toString().padEnd(5)} | ${item.action.padEnd(6)} | ${item.currentPrice.toFixed(2).padEnd(11)} | ${item.targetPrice.toFixed(2).padEnd(11)} | ${item.metrics.dy.toFixed(1)}%\n`;
            content += line;
        });

        fs.writeFileSync(filePath, content, 'utf-8');
        logger.info(`💾 Databump gerado: ${fileName}`);
    } catch (e) {
        logger.error(`Erro ao gerar Databump TXT: ${e.message}`);
    }
};

const selectDiversifiedPortfolio = (candidates, targetSize = 10, maxPercentPerSector = 0.20) => {
    if (!candidates || candidates.length === 0) return [];

    const portfolio = [];
    const sectorCounts = {};
    const maxPerSector = Math.ceil(targetSize * maxPercentPerSector); 

    const eligible = candidates
        .filter(a => a.action !== 'SELL' && a.score > 50)
        .sort((a, b) => b.score - a.score);

    for (const asset of eligible) {
        if (portfolio.length >= targetSize) break;

        const sector = asset.sector || 'Outros';
        const currentSectorCount = sectorCounts[sector] || 0;

        if (currentSectorCount < maxPerSector) {
            portfolio.push(asset);
            sectorCounts[sector] = currentSectorCount + 1;
        }
    }

    return portfolio;
};

const generateMasterRanking = (fullList) => {
    const defensive = fullList.filter(a => a.riskProfile === 'DEFENSIVE');
    const moderate = fullList.filter(a => a.riskProfile === 'MODERATE');
    const bold = fullList.filter(a => a.riskProfile === 'BOLD');

    const topDefensive = selectDiversifiedPortfolio(defensive, 10, 0.20);
    const topModerate = selectDiversifiedPortfolio(moderate, 10, 0.20);
    const topBold = selectDiversifiedPortfolio(bold, 10, 0.20);

    return [...topDefensive, ...topModerate, ...topBold];
};

// --- NOVO: ENDPOINT DE MACROECONOMIA ---
export const getMacroData = async (req, res, next) => {
    try {
        const data = await marketDataService.getMacroIndicators();
        res.json(data);
    } catch (error) {
        logger.error(`Erro ao buscar dados macro: ${error.message}`);
        res.status(500).json({ message: "Erro ao carregar indicadores" });
    }
};

export const crunchNumbers = async (req, res, next) => {
    try {
        const { assetClass, strategy, isBulk } = req.body;
        const strat = 'BUY_HOLD';
        const adminId = req.user?.id;
        
        if (isBulk) {
            logger.info("🚀 [MASTER] Iniciando Protocolo de Análise Global V3 (Previdenciária)...");
            const createdReports = [];

            // ETAPA 1: AÇÕES
            logger.info("1️⃣ Processando Ações Brasil (STOCK)...");
            const stockData = await aiResearchService.calculateRanking('STOCK', strat);
            if (stockData.fullList.length > 0) {
                const stockRanking = generateMasterRanking(stockData.fullList);
                await MarketAnalysis.create({
                    assetClass: 'STOCK',
                    strategy: strat,
                    isRankingPublished: false,
                    isMorningCallPublished: false,
                    content: { ranking: stockRanking, fullAuditLog: stockData.fullList },
                    generatedBy: adminId
                });
                generateDataBump('STOCK', stockData.fullList); // Gera TXT
                createdReports.push('STOCK');
            }

            // ETAPA 2: FIIs
            logger.info("2️⃣ Processando Fundos Imobiliários (FII)...");
            const fiiData = await aiResearchService.calculateRanking('FII', strat);
            if (fiiData.fullList.length > 0) {
                const fiiRanking = generateMasterRanking(fiiData.fullList);
                await MarketAnalysis.create({
                    assetClass: 'FII',
                    strategy: strat,
                    isRankingPublished: false,
                    isMorningCallPublished: false,
                    content: { ranking: fiiRanking, fullAuditLog: fiiData.fullList },
                    generatedBy: adminId
                });
                generateDataBump('FII', fiiData.fullList); // Gera TXT
                createdReports.push('FII');
            }

            // ETAPA 3: BRASIL 10 (A Nata da Aposentadoria)
            if (createdReports.includes('STOCK') && createdReports.includes('FII')) {
                logger.info("3️⃣ Gerando Carteira Brasil 10 (Aposentadoria)...");
                
                const allStocks = stockData.fullList.filter(a => a.riskProfile === 'DEFENSIVE' && a.action === 'BUY');
                const allFIIs = fiiData.fullList.filter(a => a.riskProfile === 'DEFENSIVE' && a.action === 'BUY');

                const top5Stocks = selectDiversifiedPortfolio(allStocks, 5, 0.20); 
                const top5FIIs = selectDiversifiedPortfolio(allFIIs, 5, 0.20);

                let brasil10List = [...top5Stocks, ...top5FIIs]
                    .sort((a, b) => b.score - a.score)
                    .map((item, idx) => ({ ...item, position: idx + 1, riskProfile: 'DEFENSIVE' })); 

                if (brasil10List.length > 0) {
                    // Geração Automática de Narrativa para Brasil 10
                    const narrative = await aiResearchService.generateNarrative(brasil10List, 'BRASIL_10');
                    
                    await MarketAnalysis.create({
                        assetClass: 'BRASIL_10',
                        strategy: strat,
                        isRankingPublished: false, // Alterado para FALSE: Admin deve publicar manualmente
                        isMorningCallPublished: false, // Alterado para FALSE
                        content: { ranking: brasil10List, fullAuditLog: brasil10List, morningCall: narrative },
                        generatedBy: adminId
                    });
                    generateDataBump('BRASIL_10', brasil10List); // Gera TXT
                }
            }

            logger.info("🏁 [MASTER] Finalizado.");
            return res.json({ message: "Ciclo concluído.", details: `Gerados: ${createdReports.join(', ')}` });
        }

        // Single Request
        const { fullList } = await aiResearchService.calculateRanking(assetClass, strat);
        const rankingDiversified = generateMasterRanking(fullList);
        
        await MarketAnalysis.create({
            assetClass: assetClass,
            strategy: strat,
            isRankingPublished: false,
            isMorningCallPublished: false,
            content: { ranking: rankingDiversified, fullAuditLog: fullList },
            generatedBy: adminId
        });
        
        generateDataBump(assetClass, fullList); // Gera TXT

        return res.status(201).json({ message: "Análise single gerada." });

    } catch (error) { 
        logger.error(`FATAL ERROR: ${error.message}`);
        if (next) next(error);
    }
};

export const generateNarrative = async (req, res, next) => {
    try {
        const { analysisId } = req.body;
        const analysis = await MarketAnalysis.findById(analysisId);
        if (!analysis) return res.status(404).json({ message: "Not found" });

        // Passa o ranking correto para a IA
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
            { $sort: { createdAt: -1 } },
            { $limit: 50 },
            {
                $project: {
                    date: 1,
                    assetClass: 1,
                    strategy: 1,
                    isRankingPublished: 1,
                    isMorningCallPublished: 1,
                    generatedBy: 1,
                    morningCallPresent: { $cond: [{ $ifNull: ["$content.morningCall", false] }, true, false] },
                    rankingCount: { $size: { $ifNull: ["$content.ranking", []] } } 
                }
            }
        ]);
        
        const mappedReports = reports.map(r => ({
            _id: r._id,
            date: r.date,
            assetClass: r.assetClass,
            strategy: r.strategy,
            isRankingPublished: r.isRankingPublished,
            isMorningCallPublished: r.isMorningCallPublished,
            generatedBy: r.generatedBy,
            content: {
                morningCall: r.morningCallPresent ? "YES" : null, 
                ranking: new Array(r.rankingCount).fill({}) 
            }
        }));

        res.json(mappedReports);
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
    logger.info("Executando rotina automática via trigger.");
    const result = await crunchNumbers({ body: { isBulk: true } }, null, null);
    if (res) res.json({ message: "Batch process finished" });
};
