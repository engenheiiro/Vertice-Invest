
import MarketAnalysis from '../models/MarketAnalysis.js';
import { aiResearchService } from '../services/aiResearchService.js';
import logger from '../config/logger.js';

// Delay reduzido para 12s
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const triggerDailyRoutine = async (req, res, isInternal = false) => {
    const forceGenerate = req?.body?.force === true;

    const ROUTINE_CONFIG = [
        { assetClass: 'BRASIL_10', strategy: 'BUY_HOLD' },
        { assetClass: 'STOCK', strategy: 'BUY_HOLD' },
        { assetClass: 'FII', strategy: 'BUY_HOLD' },
        { assetClass: 'STOCK_US', strategy: 'BUY_HOLD' },
        { assetClass: 'CRYPTO', strategy: 'SWING' }
    ];

    if (!isInternal && res) {
        res.status(202).json({ 
            message: "Protocolo de Ingestão iniciado em background.", 
            estimatedTime: "~2 minutos" 
        });
    }

    const runBatch = async () => {
        logger.info(`===========================================================`);
        logger.info(`🚀 [BATCH] INICIANDO PROTOCOLO DE INGESTÃO (Force: ${forceGenerate})`);
        logger.info(`===========================================================`);
        
        for (const task of ROUTINE_CONFIG) {
            try {
                if (!forceGenerate) {
                    const existing = await MarketAnalysis.findOne({
                        assetClass: task.assetClass,
                        strategy: task.strategy,
                        createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) }
                    });

                    if (existing) {
                        logger.info(`⏩ [BATCH] ${task.assetClass} ignorado (cache recente).`);
                        continue;
                    }
                }

                const analysis = await aiResearchService.generateAnalysis(task.assetClass, task.strategy);
                
                if (analysis) {
                    await MarketAnalysis.create({
                        assetClass: task.assetClass,
                        strategy: task.strategy,
                        content: {
                            morningCall: analysis.morningCall,
                            ranking: analysis.ranking
                        },
                        generatedBy: req?.user?.id || null
                    });
                    logger.info(`✅ [BATCH] ${task.assetClass} persistido no banco.`);
                    
                    await sleep(12000); 
                }
            } catch (error) {
                if (error.code === 'FATAL_AUTH_ERROR' || error.message.includes('FATAL_AUTH_ERROR')) {
                    logger.error(`⛔ [BATCH] API KEY BLOQUEADA. ABORTANDO.`);
                    break;
                }

                logger.error(`❌ [BATCH] Pulo de emergência em ${task.assetClass}. Continuando...`);
                await sleep(5000); 
            }
        }
        logger.info(`===========================================================`);
        logger.info("🏁 [BATCH] ROTINA FINALIZADA");
        logger.info(`===========================================================`);
    };

    if (isInternal) {
        await runBatch();
    } else {
        runBatch().catch(err => logger.error(`Falha no Async Batch: ${err.message}`));
    }
};

export const getLatestReport = async (req, res, next) => {
    try {
        const { assetClass, strategy } = req.query;
        const report = await MarketAnalysis.findOne({ assetClass, strategy })
            .sort({ createdAt: -1 });

        if (!report) return res.status(404).json({ message: "Relatório indisponível" });
        res.json(report);
    } catch (error) {
        next(error);
    }
};

export const generateReport = async (req, res, next) => {
    try {
        const { assetClass, strategy } = req.body;
        // Geração manual (Single Shot)
        const analysis = await aiResearchService.generateAnalysis(assetClass, strategy);
        
        if (analysis) {
            const newReport = await MarketAnalysis.create({
                assetClass, 
                strategy, 
                content: {
                    morningCall: analysis.morningCall,
                    ranking: analysis.ranking
                }, 
                generatedBy: req.user.id
            });
            res.status(201).json(newReport);
        } else {
            res.status(500).json({ message: "Falha ao gerar análise." });
        }
    } catch (error) { next(error); }
};

export const listReports = async (req, res, next) => {
    try {
        const reports = await MarketAnalysis.find().sort({ createdAt: -1 }).limit(50);
        res.json(reports);
    } catch (error) { next(error); }
};
