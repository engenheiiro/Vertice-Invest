
import MarketAnalysis from '../models/MarketAnalysis.js';
import { aiResearchService } from '../services/aiResearchService.js';
import { aiEnhancementService } from '../services/aiEnhancementService.js';
import { marketDataService } from '../services/marketDataService.js';
import logger from '../config/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const generateDataBump = (assetClass, dataList) => {
    try {
        const dumpDir = path.resolve(__dirname, '../data_dump');
        if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
        
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        
        const fileName = `RANKING_${assetClass}_${dateStr}_${timeStr}.txt`;
        const filePath = path.join(dumpDir, fileName);
        
        let content = `VÉRTICE RESEARCH - PROTOCOLO FORTRESS v6.0\n`;
        content += `Data: ${now.toLocaleString('pt-BR')}\n`;
        content += `Classe: ${assetClass}\n`;
        content += `------------------------------------------------------------------------------------------------\n`;
        content += `POS | TICKER | SETOR          | PERFIL    | SCORE | AÇÃO   | PREÇO   | TETO (VI) | YIELD | TESE\n`;
        content += `------------------------------------------------------------------------------------------------\n`;
        
        dataList.forEach((item, idx) => {
            const pos = (idx + 1).toString().padEnd(3);
            const ticker = (item.ticker || 'N/A').padEnd(6);
            const setor = (item.sector || 'Geral').substring(0, 14).padEnd(14);
            const perfil = (item.riskProfile || 'MODERATE').padEnd(9);
            const score = (item.score || 0).toString().padEnd(5);
            const acao = (item.action || 'WAIT').padEnd(6);
            const preco = (item.currentPrice?.toFixed(2) || '0.00').padEnd(7);
            const teto = (item.targetPrice?.toFixed(2) || '0.00').padEnd(9);
            const dy = (item.metrics?.dy?.toFixed(1) || '0.0').padEnd(5);
            const tese = (item.thesis || '').substring(0, 40);

            const line = `${pos} | ${ticker} | ${setor} | ${perfil} | ${score} | ${acao} | ${preco} | ${teto} | ${dy} | ${tese}\n`;
            content += line;
        });
        
        fs.writeFileSync(filePath, content, 'utf-8');
        logger.info(`📄 Dump gerado: ${fileName} com ${dataList.length} itens.`);
    } catch (e) { 
        logger.error(`Erro Databump: ${e.message}`); 
    }
};

export const getMacroData = async (req, res, next) => {
    try {
        const data = await marketDataService.getMacroIndicators();
        res.json(data);
    } catch (error) { next(error); }
};

export const crunchNumbers = async (req, res, next) => {
    try {
        const { assetClass, strategy, isBulk } = req.body;
        const strat = 'BUY_HOLD';
        const adminId = req.user?.id;
        
        if (isBulk) {
            logger.info("🚀 [FORTRESS] Iniciando Bulk Run (Processamento em Massa)...");
            
            // 1. Processa AÇÕES (STOCK)
            logger.info("========================================");
            logger.info("📊 INICIANDO CÁLCULO DE AÇÕES (STOCK)");
            const stockData = await aiResearchService.calculateRanking('STOCK', strat);
            
            await MarketAnalysis.create({
                assetClass: 'STOCK', strategy: strat,
                content: { ranking: stockData.ranking, fullAuditLog: stockData.fullList }, 
                generatedBy: adminId
            });
            generateDataBump('STOCK', stockData.ranking);
            
            // 2. Processa FIIs (FII)
            logger.info("========================================");
            logger.info("🏢 INICIANDO CÁLCULO DE FIIs");
            const fiiData = await aiResearchService.calculateRanking('FII', strat);

            await MarketAnalysis.create({
                assetClass: 'FII', strategy: strat,
                content: { ranking: fiiData.ranking, fullAuditLog: fiiData.fullList }, 
                generatedBy: adminId
            });
            generateDataBump('FII', fiiData.ranking);

            // 3. Processa BRASIL 10 (MIX PURO DEFENSIVO)
            logger.info("========================================");
            logger.info("🏆 INICIANDO CÁLCULO BRASIL 10 (50/50 STRICT)");
            
            // Filtra EXCLUSIVAMENTE o perfil DEFENSIVE de cada lista
            // Se não houver defensivos suficientes, pega os melhores Moderados como fallback
            const getBestCandidates = (list, count) => {
                let defensives = list.filter(a => a.riskProfile === 'DEFENSIVE').sort((a,b) => b.score - a.score);
                if (defensives.length < count) {
                    const moderates = list.filter(a => a.riskProfile === 'MODERATE').sort((a,b) => b.score - a.score);
                    defensives = [...defensives, ...moderates];
                }
                return defensives.slice(0, count);
            };

            const top5Stocks = getBestCandidates(stockData.fullList, 5); // Busca na lista completa para garantir
            const top5FIIs = getBestCandidates(fiiData.fullList, 5);

            // Mescla e ordena por score para definir as posições 1 a 10
            let brasil10List = [...top5Stocks, ...top5FIIs]
                .sort((a, b) => b.score - a.score)
                .map((item, idx) => ({ 
                    ...item, 
                    position: idx + 1,
                    // Força a tag 'DEFENSIVE' visualmente se veio da seleção de segurança, 
                    // para manter a consistência da carteira Brasil 10
                    riskProfile: 'DEFENSIVE' 
                })); 
            
            await MarketAnalysis.create({
                assetClass: 'BRASIL_10', strategy: strat,
                content: { ranking: brasil10List, fullAuditLog: brasil10List },
                generatedBy: adminId
            });
            generateDataBump('BRASIL_10', brasil10List);

            logger.info("========================================");
            logger.info("✅ Bulk Run Finalizado com Sucesso.");
            if (res) return res.json({ message: "Cálculo Matemático Finalizado e Arquivos Gerados." });
            return;
        }

        // --- Single Request (Botão Individual) ---
        logger.info(`🚀 [FORTRESS] Calculando Single: ${assetClass}...`);
        
        // Se for Brasil 10 Single, precisa processar Stocks e FIIs primeiro
        if (assetClass === 'BRASIL_10') {
             const stockData = await aiResearchService.calculateRanking('STOCK', strat);
             const fiiData = await aiResearchService.calculateRanking('FII', strat);
             
             const getBestCandidates = (list, count) => {
                let defensives = list.filter(a => a.riskProfile === 'DEFENSIVE').sort((a,b) => b.score - a.score);
                if (defensives.length < count) {
                    const moderates = list.filter(a => a.riskProfile === 'MODERATE').sort((a,b) => b.score - a.score);
                    defensives = [...defensives, ...moderates];
                }
                return defensives.slice(0, count);
            };

            const top5Stocks = getBestCandidates(stockData.fullList, 5);
            const top5FIIs = getBestCandidates(fiiData.fullList, 5);

            const ranking = [...top5Stocks, ...top5FIIs].sort((a, b) => b.score - a.score);
            
            await MarketAnalysis.create({
                assetClass, strategy: strat,
                content: { ranking, fullAuditLog: ranking },
                generatedBy: adminId
            });
            
            generateDataBump(assetClass, ranking);
            return res.status(201).json({ message: "Brasil 10 Gerado." });
        }

        // Fluxo Normal (Stock/FII)
        const { ranking, fullList } = await aiResearchService.calculateRanking(assetClass, strat);
        
        await MarketAnalysis.create({
            assetClass, strategy: strat,
            content: { ranking, fullAuditLog: fullList }, 
            generatedBy: adminId
        });
        
        generateDataBump(assetClass, ranking);

        return res.status(201).json({ message: "Análise Quantitativa Gerada." });

    } catch (error) { 
        logger.error(`FATAL: ${error.message}`);
        if (next) next(error);
    }
};

export const enhanceWithAI = async (req, res, next) => {
    try {
        const { assetClass, strategy } = req.body;
        
        logger.info(`✨ [IA Request] Iniciando Refinamento para ${assetClass}...`);

        const latestReport = await MarketAnalysis.findOne({ 
            assetClass, 
            strategy 
        }).sort({ createdAt: -1 });

        if (!latestReport) {
            return res.status(404).json({ message: "Gere a análise matemática primeiro." });
        }

        // Envia o Ranking (Top 50) para a IA processar
        const enhancedRanking = await aiEnhancementService.enhanceRankingWithNews(
            latestReport.content.ranking, 
            assetClass
        );

        latestReport.content.ranking = enhancedRanking;
        latestReport.isMorningCallPublished = false; 
        await latestReport.save();

        generateDataBump(`${assetClass}_IA_ENHANCED`, enhancedRanking);

        return res.json({ message: "Ranking refinado com IA e Google Search.", ranking: enhancedRanking });

    } catch (error) {
        logger.error(`Erro Enhance AI: ${error.message}`);
        next(error);
    }
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
            { $sort: { createdAt: -1 } },
            { $limit: 50 },
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
