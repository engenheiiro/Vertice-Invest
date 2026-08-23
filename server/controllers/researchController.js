
import MarketAnalysis from '../models/MarketAnalysis.js';
import TreasuryBond from '../models/TreasuryBond.js';
import QuantSignal from '../models/QuantSignal.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';
import RecommendedPortfolioCurve from '../models/RecommendedPortfolioCurve.js';
import DiscardLog from '../models/DiscardLog.js'; // Novo
import PublishedResearchPointer from '../models/PublishedResearchPointer.js';
import { createBroadcast } from '../services/notificationService.js';
import { aiResearchService } from '../services/aiResearchService.js';
import { aiEnhancementService } from '../services/aiEnhancementService.js';
import { marketDataService } from '../services/marketDataService.js';
import { buyAndHoldService } from '../services/buyAndHoldService.js';
import { fiiBuyAndHoldService } from '../services/fiiBuyAndHoldService.js';
import { anchorPublicationService } from '../services/anchorPublicationService.js';
import { ANCHOR_STRATEGY } from '../config/buyAndHoldPublication.js';
import { macroDataService } from '../services/macroDataService.js';
import { syncService } from '../services/syncService.js';
import { backfillSectors } from '../services/sectorBackfillService.js';
import { signalEngine } from '../services/engines/signalEngine.js';
import { LIMITS_CONFIG, getSignalAccess } from '../config/subscription.js';
import { normalizeTreasuryBonds } from '../utils/fixedIncomeView.js';
import { HISTORY_CAP_EXEMPT_TICKERS, V2_SIGNAL_START_DATE } from '../config/financialConstants.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import logger from '../config/logger.js';
import { validateFundamentalsPublicationHealth } from '../utils/ingestionHealth.js';
import {
    activateResearchSections,
    composeActiveResearchReport,
    hasSectionContent,
    pendingSectionsFor,
    sectionsForPublicationType,
} from '../services/researchPublicationService.js';
import { generateExplainableText, saveExplainableText } from '../services/explainableAIService.js';

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

// Metadata do último scan para exibição no frontend (countdown, contexto).
// `activeSignalsTotal` vem do scan (total real, independente do que o plano do
// usuário enxerga) — é contagem agregada, nunca identifica ativo, então serve de
// isca de upsell mesmo para quem não recebe sinal.
const buildRadarScanMeta = async (visibleSignals) => {
    const scanMetaDoc = await SystemConfig.findOne({ key: 'RADAR_SCAN_META' }).lean();
    const scanMeta = scanMetaDoc?.value || null;
    const fallbackActive = visibleSignals.filter(s => s.status === 'ACTIVE').length;

    if (!scanMeta) {
        return {
            lastScanAt: null,
            nextScanAt: null,
            assetsScanned: 0,
            assetsWithHistory: 0,
            activeSignalsTotal: fallbackActive,
            scanIntervalMinutes: 15,
        };
    }

    return {
        lastScanAt: scanMeta.lastScanAt,
        nextScanAt: new Date(new Date(scanMeta.lastScanAt).getTime() + 15 * 60 * 1000).toISOString(),
        assetsScanned: scanMeta.assetsScanned || 0,
        assetsWithHistory: scanMeta.assetsWithHistory || 0,
        activeSignalsTotal: scanMeta.activeSignalsTotal ?? fallbackActive,
        scanIntervalMinutes: 15,
    };
};

export const getQuantSignals = async (req, res, next) => {
    try {
        const { history } = req.query;
        let query = history === 'true' ? {} : { status: 'ACTIVE' };
        const limit = 200;

        // Gate de plano AUTORITATIVO (o front só rotula; a autorização é aqui).
        // Antes, o payload íntegro ia para qualquer autenticado e o "atraso" do
        // ESSENTIAL era só a `message` reescrita no client — ticker e valor
        // chegavam intactos e visíveis na aba Network.
        const access = getSignalAccess(req.user);

        // GUEST não recebe sinal nenhum. Devolve 200 (não 403) para o dashboard
        // seguir montando com a isca de upsell: `meta.activeSignalsTotal` é uma
        // contagem agregada, não identifica ativo.
        if (access.tier === 'NONE') {
            return res.json({ signals: [], meta: await buildRadarScanMeta([]), access });
        }

        // Atraso real: corta na origem, no filtro do banco. O sinal entregue é
        // íntegro — só não é o mais recente.
        if (access.delayMinutes > 0) {
            query.timestamp = { $lte: new Date(Date.now() - access.delayMinutes * 60 * 1000) };
        }

        const signals = await QuantSignal.find(query).sort({ timestamp: -1 }).limit(limit).lean();

        if (signals.length > 0) {
            const tickers = signals.map(s => s.ticker);
            const assets = await MarketAsset.find({ ticker: { $in: tickers } }).select('ticker lastPrice');
            const priceMap = new Map();
            assets.forEach(a => priceMap.set(a.ticker, a.lastPrice));
            signals.forEach(s => { if (s.status === 'ACTIVE') s.finalPrice = priceMap.get(s.ticker); });
        }

        res.json({ signals, meta: await buildRadarScanMeta(signals), access });
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
        
        // Idade média das séries temporais — só da COORTE QUE O SISTEMA MANTÉM.
        //
        // A média era tirada sobre `AssetHistory.find({})`, a coleção inteira. Só que
        // a coleção guarda documentos que ninguém atualiza: chaves de uma convenção
        // de armazenamento antiga (163 documentos com sufixo `.SA`, congelados em
        // 31/07/2026) e séries de ativos que saíram do universo. Eles não envelhecem
        // por defeito — envelhecem porque não têm dono.
        //
        // O efeito no painel não era cosmético: o card fica VERMELHO acima de 48h, e
        // a média contaminada marcava 116,7h contra 40,0h da coorte real (medição de
        // 22/08/2026, 166 órfãos em 1.472 documentos). Ou seja, alarme permanente de
        // uma defasagem que não existia — o tipo de alerta que ensina a ignorar alerta.
        //
        // A coorte é a MESMA do timeSeriesWorker (`isActive: true`, chave resolvida
        // por historyStorageKey), mais os tickers isentos de cap, que o macro e o
        // câmbio mantêm por fora. Assim a métrica responde "as séries que eu cuido
        // estão atualizadas?" em vez de "o que existe na coleção é recente?".
        const maintainedAssets = await MarketAsset.find({ isActive: true }).select('ticker type').lean();
        const cohortKeys = [...new Set([
            ...maintainedAssets.map(a => historyStorageKey(a.ticker, a.type)).filter(Boolean),
            ...HISTORY_CAP_EXEMPT_TICKERS,
        ])];

        const [histories, totalSeries] = await Promise.all([
            AssetHistory.find({ ticker: { $in: cohortKeys } }, 'lastUpdated').lean(),
            AssetHistory.countDocuments({}),
        ]);

        // `lastUpdated` ausente vira documento IGNORADO, nunca idade zero: sem o
        // filtro, `new Date(undefined)` é NaN e contamina a soma inteira, zerando a
        // métrica em vez de acusar o problema.
        const dated = histories.filter(h => h.lastUpdated);
        let avgAgeHours = 0;
        if (dated.length > 0) {
            const now = Date.now();
            const totalAgeMs = dated.reduce((sum, h) => sum + (now - new Date(h.lastUpdated).getTime()), 0);
            avgAgeHours = (totalAgeMs / dated.length) / (1000 * 60 * 60);
        }
        // Fora da coorte deixa de ser distorção invisível e passa a ser número.
        const orphanSeries = Math.max(0, totalSeries - histories.length);

        res.json({
            typosFixed: config?.lastSyncStats?.typosFixed || 0,
            assetsProcessed: config?.lastSyncStats?.assetsProcessed || 0,
            lastSyncDate: config?.lastSyncStats?.timestamp || null,
            snapshotStats: config?.lastSnapshotStats || { created: 0, skipped: 0, timestamp: null },
            blacklistedAssets: inactiveCount,
            totalAssets,
            timeSeriesAgeHours: avgAgeHours,
            timeSeriesTracked: dated.length,
            timeSeriesOrphans: orphanSeries,
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

export const enhanceWithAI = async (req, res, next) => {
    try {
        const { assetClass, strategy } = req.body;
        const latestReport = await MarketAnalysis.findOne({ assetClass, strategy }).sort({ createdAt: -1 });
        if (!latestReport) return res.status(404).json({ message: "Relatório não encontrado." });

        const enhancedRanking = await aiEnhancementService.enhanceRankingWithNews(
            latestReport.content.ranking,
            assetClass,
        );
        const source = latestReport.toObject();
        delete source._id;
        delete source.__v;
        delete source.createdAt;
        const revision = await MarketAnalysis.create({
            ...source,
            parentAnalysis: latestReport._id,
            revision: (latestReport.revision || 1) + 1,
            generatedBy: req.user?.id || latestReport.generatedBy,
            content: { ...source.content, ranking: enhancedRanking },
            isRankingPublished: false,
            isMorningCallPublished: false,
            isReportPublished: false,
            isExplainableAIPublished: false,
            publication: {},
        });
        return res.json({
            message: "Refinamento IA concluído em nova revisão não publicada.",
            analysisId: revision._id,
            ranking: enhancedRanking,
        });
    } catch (error) { next(error); }
};
export const generateNarrative = async (req, res, next) => { try { const { analysisId } = req.body; const analysis = await MarketAnalysis.findById(analysisId); if (!analysis) return res.status(404).json({ message: "Not found" }); const narrative = await aiResearchService.generateNarrative(analysis.content.ranking, analysis.assetClass); analysis.content.morningCall = narrative; await analysis.save(); if (res) res.json({ morningCall: narrative }); } catch (error) { next(error); } };

export const publishContent = async (req, res, next) => {
    try {
        const { analysisId, type, partial = false } = req.body;
        const analysis = await MarketAnalysis.findById(analysisId);
        if (!analysis) return res.status(404).json({ message: "Not found" });

        const sections = sectionsForPublicationType(type);
        const rankingWasAlreadyPublished = analysis.isRankingPublished;
        // Em modo parcial o ranking só vai ao ar se tiver conteúdo — sem isso, o
        // gate de fundamentos bloquearia a publicação de seções que nem envolvem
        // o ranking.
        const publishesRanking = sections.includes('RANKING')
            && (!partial || hasSectionContent(analysis, 'RANKING'));

        if (publishesRanking) {
            const systemConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' })
                .select('lastSyncStats')
                .lean();
            const fundamentalsGate = validateFundamentalsPublicationHealth(
                analysis.assetClass,
                systemConfig?.lastSyncStats || null,
            );
            if (!fundamentalsGate.ok) {
                return res.status(409).json({
                    message: 'Publicação bloqueada por dados fundamentais degradados.',
                    error: fundamentalsGate.reason,
                });
            }
        }

        const publication = await activateResearchSections({
            analysis,
            sections,
            activatedBy: req.user?.id || null,
            // Em modo parcial as seções sem conteúdo são puladas (voltam em
            // `skipped`) em vez de derrubar a publicação inteira.
            requireAll: !partial,
        });

        // Dispara broadcast apenas quando o ranking passa a publicado pela primeira vez
        if (!rankingWasAlreadyPublished && analysis.isRankingPublished) {
            const assetClass = analysis.assetClass || '';
            const assetClassLabels = {
                STOCK: 'Ações BR', FII: 'FIIs', CRYPTO: 'Cripto',
                STOCK_US: 'Ações EUA', REIT: 'REITs', ETF: 'ETFs', BRASIL_10: 'Brasil 10',
            };
            const label = assetClassLabels[assetClass] || assetClass;
            await createBroadcast({
                type: 'RANKING_PUBLISHED',
                title: 'Novo ranking publicado',
                message: `Novo ranking de ${label} está disponível. Confira as recomendações atualizadas.`,
                relatedAssetClass: assetClass,
            });
        }

        if (res) res.json({ message: "Publicado.", ...publication });
    } catch (error) {
        if (['INVALID_RANKING', 'SECTION_CONTENT_MISSING'].includes(error.code)) {
            return res.status(409).json({ message: error.message });
        }
        next(error);
    }
};

export const getPublishStatus = async (req, res, next) => {
    try {
        const classes = ['STOCK', 'FII', 'CRYPTO', 'BRASIL_10', 'STOCK_US', 'REIT', 'ETF'];
        const status = await Promise.all(classes.map(async (assetClass) => {
            const latest = await MarketAnalysis.findOne({ assetClass, strategy: 'BUY_HOLD' })
                .sort({ createdAt: -1 })
                .select('createdAt isRankingPublished isMorningCallPublished isReportPublished isExplainableAIPublished comparisonReport explainableAIPrompt generatedExplainableAI generatedExplainableAIByProfile content.morningCall content.ranking');
            const lastPublished = await MarketAnalysis.findOne({ assetClass, strategy: 'BUY_HOLD', isRankingPublished: true })
                .sort({ createdAt: -1 })
                .select('createdAt');

            // Uma seção está pendente quando TEM conteúdo e AINDA NÃO foi publicada.
            // Antes o "pronto para publicar" era só `!isRankingPublished`, então uma
            // narrativa gerada depois do ranking ir ao ar nunca acendia o botão de
            // publicação em massa — ficava só nos botões granulares.
            const pendingSections = pendingSectionsFor(latest);

            return {
                assetClass,
                lastSyncAt: latest?.createdAt || null,
                lastPublishedAt: lastPublished?.createdAt || null,
                isRankingPublished: latest?.isRankingPublished || false,
                isMorningCallPublished: latest?.isMorningCallPublished || false,
                isReportPublished: latest?.isReportPublished || false,
                isExplainableAIPublished: latest?.isExplainableAIPublished || false,
                hasComparisonReport: !!latest?.comparisonReport,
                hasExplainableAIPrompt: !!(latest?.explainableAIPrompt),
                hasGeneratedExplainableAI: !!(latest?.generatedExplainableAI),
                latestId: latest?._id || null,
                pendingSections,
                readyToPublish: pendingSections.length > 0,
            };
        }));
        res.json(status);
    } catch (error) { next(error); }
};

export const generateExplainableAI = async (req, res, next) => {
    try {
        const { analysisId, customText, profile } = req.body;
        if (!analysisId) return res.status(400).json({ message: "analysisId obrigatório." });
        const analysis = await MarketAnalysis.findById(analysisId);
        if (!analysis) return res.status(404).json({ message: "Análise não encontrada." });

        // Perfil opcional: grava a narrativa específica do perfil; sem perfil usa o campo único (legado/fallback).
        const validProfile = ['DEFENSIVE', 'MODERATE', 'BOLD'].includes(profile) ? profile : null;

        if (customText) {
            saveExplainableText(analysis, customText, validProfile);
            await analysis.save();
            return res.json({ generatedExplainableAI: customText, profile: validProfile });
        }

        const text = await generateExplainableText(analysis, validProfile);
        saveExplainableText(analysis, text, validProfile);
        await analysis.save();
        res.json({ generatedExplainableAI: text, profile: validProfile });
    } catch (error) {
        if (error.code === 'PROMPT_MISSING') return res.status(400).json({ message: error.message });
        if (error.code === 'API_KEY_MISSING') return res.status(503).json({ message: error.message });
        if (error.code === 'EMPTY_RESPONSE') return res.status(502).json({ message: error.message });
        next(error);
    }
};

export const listReports = async (req, res, next) => { try { const reports = await MarketAnalysis.aggregate([ { $sort: { createdAt: -1 } }, { $limit: 50 }, { $project: { date: 1, assetClass: 1, strategy: 1, isRankingPublished: 1, isMorningCallPublished: 1, isReportPublished: 1, isExplainableAIPublished: 1, generatedBy: 1, morningCallPresent: { $cond: [{ $ifNull: ["$content.morningCall", false] }, true, false] }, rankingCount: { $size: { $ifNull: ["$content.ranking", []] } }, hasComparisonReport: { $cond: [{ $ifNull: ["$comparisonReport", false] }, true, false] }, hasGeneratedAI: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$generatedExplainableAI", ""] } }, 0] }, true, false] } } } ]); res.json(reports); } catch (error) { next(error); } };
export const getReportDetails = async (req, res, next) => { try { const report = await MarketAnalysis.findById(req.params.id); if (!report) return res.status(404).json({ message: "Not found" }); res.json(report); } catch (error) { next(error); } };

// Ranking Buy-and-Hold (estratégia BUY_AND_HOLD) em SHADOW — admin-only.
// Calcula on-demand a partir dos dados atuais (read-only): não persiste
// MarketAnalysis nem publica. Consumido pela aba Operações do AdminPanel.
export const getBuyAndHoldShadow = async (req, res, next) => {
    try {
        const includeExcluded = req.query.excluded === 'true' || req.query.excluded === '1';
        const assetClass = req.query.assetClass === 'FII' ? 'FII' : 'STOCK';
        const result = assetClass === 'FII'
            ? await fiiBuyAndHoldService.generateFiiBuyAndHoldRanking({ includeExcluded })
            : await buyAndHoldService.generateBuyAndHoldRanking({ includeExcluded });
        res.json(result);
    } catch (error) { next(error); }
};

// Publicação sob demanda da lista âncora (estratégia BUY_AND_HOLD). O cron é
// mensal; isto é a válvula manual do admin — e, com `dryRun`, a prévia do que
// iria ao ar, calculada pelo MESMO caminho que o cron usa.
//
// Não toca na estratégia legada BUY_HOLD: outro ponteiro, outro documento.
export const publishAnchorRankingHandler = async (req, res, next) => {
    try {
        const { assetClass, dryRun } = req.body || {};
        if (assetClass) {
            const result = await anchorPublicationService.publishAnchorRanking({
                assetClass,
                dryRun,
                activatedBy: req.user?.id || null,
            });
            return res.json({ strategy: ANCHOR_STRATEGY, dryRun: !!dryRun, results: [result] });
        }
        const result = await anchorPublicationService.runAnchorPublication({
            dryRun,
            activatedBy: req.user?.id || null,
        });
        res.json(result);
    } catch (error) { next(error); }
};
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

        const pointers = await PublishedResearchPointer.find({ assetClass, strategy }).lean();
        if (pointers.length) {
            const ids = [...new Set(pointers.map(pointer => String(pointer.analysis)))];
            const documents = await MarketAnalysis.find({ _id: { $in: ids } })
                .select('-content.fullAuditLog')
                .lean();
            const response = composeActiveResearchReport({ pointers, documents });
            if (response) {
                return res.json(response);
            }
        }

        const legacyReport = await MarketAnalysis.findOne({
            assetClass,
            strategy,
            $or: [
                { isRankingPublished: true },
                { isMorningCallPublished: true },
                { isReportPublished: true },
                { isExplainableAIPublished: true },
            ]
        }).select('-content.fullAuditLog').sort({ createdAt: -1 });

        if (!legacyReport) return res.status(404).json({ message: "Indisponível" });
        const response = legacyReport.toObject ? legacyReport.toObject() : structuredClone(legacyReport);
        response.content = response.content || {};
        // As saídas por retenção pertencem à seção RANKING: sem zerá-las junto, o
        // cliente receberia as saídas de uma lista que não está no ar — nomes
        // "que saíram" de um ranking que ele nunca viu. O caminho novo
        // (`composeActiveResearchReport`) já amarra as duas coisas ao documento
        // da seção; aqui o documento é um só, então o vínculo é a flag.
        if (!response.isRankingPublished) {
            response.content.ranking = [];
            response.retentionExits = [];
        }
        if (!response.isMorningCallPublished) response.content.morningCall = '';
        if (!response.isReportPublished) response.comparisonReport = null;
        if (!response.isExplainableAIPublished) {
            response.generatedExplainableAI = '';
            response.generatedExplainableAIByProfile = {};
        }
        res.json(response);
    } catch (error) { next(error); }
};
