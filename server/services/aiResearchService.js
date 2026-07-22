
import { GoogleGenAI } from "@google/genai";
import * as Sentry from "@sentry/node";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';
import { scoringEngine } from './engines/scoringEngine.js';
import { portfolioEngine } from './engines/portfolioEngine.js';
import SystemConfig from '../models/SystemConfig.js';
import MarketAnalysis from '../models/MarketAnalysis.js';
import DiscardLog from '../models/DiscardLog.js';
import { rankingTxtExportService } from './rankingTxtExportService.js';
// (M9) Threshold global e fallback de Selic centralizados em financialConstants.
import { BUY_THRESHOLD, DEFAULT_SELIC_FALLBACK, DEFAULT_NTNB_FALLBACK } from '../config/financialConstants.js';
import { randomUUID } from 'crypto';
import ResearchBatch from '../models/ResearchBatch.js';
import { finalizeRanking } from '../utils/rankingContract.js';
import {
    calculateStockCalibrationConfidence,
    calculateStockShadowAxes,
    normalizeStockScoringOutputForPersistence,
    prepareStockForSectorScoring,
} from './engines/stockSectorAxisEngine.js';
import {
    STOCK_CALIBRATION_SHADOW_VERSION,
    buildCompetitiveCohesiveShadowTop10s,
} from './engines/stockCalibrationShadowEngine.js';
import { assessStockMetricCoverage } from '../config/stockCalibration.js';

const stockWeakAxisReason = axes => {
    const labels = {
        durability: 'durabilidade e qualidade do negócio',
        entry: 'preço e margem de segurança',
        resilience: 'resiliência financeira',
    };
    const [weakest] = Object.entries({
        durability: axes.durability,
        entry: axes.entry,
        resilience: axes.resilience,
    }).sort((a, b) => a[1] - b[1]);
    return `Eixo limitante: ${labels[weakest[0]]} (${weakest[1]}/100)`;
};

// O ranking é o contrato do usuário final. Cobertura e eixos V3 pertencem à
// Auditoria Completa (admin) e não devem vazar como uma segunda leitura pública.
export const stripStockCalibrationInternals = item => {
    const {
        stockCalibration: _stockCalibration,
        coverage: _coverage,
        shadowAuditByProfile: _shadowAuditByProfile,
        scores: _scores,
        ...publicItem
    } = item || {};
    return publicItem;
};

// Exportado para teste (T6). Função pura: calcula o delta entre dois rankings.
export const generateComparisonReport = (assetClass, newRanking, previousRanking) => {
    if (!previousRanking || previousRanking.length === 0) return null;

    const prevMap = new Map(previousRanking.map(r => [r.ticker, r]));
    const newMap = new Map(newRanking.map(r => [r.ticker, r]));

    const newEntries = newRanking.filter(r => !prevMap.has(r.ticker)).map(r => ({
        ticker: r.ticker, name: r.name, score: r.score, action: r.action, riskProfile: r.riskProfile
    }));

    const exits = previousRanking.filter(r => !newMap.has(r.ticker)).map(r => ({
        ticker: r.ticker, name: r.name, reason: 'Saiu do ranking'
    }));

    const upgrades = [];
    const downgrades = [];
    const biggestMovers = [];

    newRanking.forEach(r => {
        const prev = prevMap.get(r.ticker);
        if (!prev) return;
        if (prev.action === 'WAIT' && r.action === 'BUY') upgrades.push({ ticker: r.ticker, name: r.name, previousScore: prev.score, newScore: r.score });
        if (prev.action === 'BUY' && r.action === 'WAIT') downgrades.push({ ticker: r.ticker, name: r.name, previousScore: prev.score, newScore: r.score, reason: 'Score abaixo do threshold' });
        const posChange = (prev.position || 0) - (r.position || 0);
        const scoreDelta = r.score - prev.score;
        if (Math.abs(posChange) >= 3 || Math.abs(scoreDelta) >= 5) {
            biggestMovers.push({ ticker: r.ticker, name: r.name, positionChange: posChange, scoreDelta: parseFloat(scoreDelta.toFixed(2)) });
        }
    });

    biggestMovers.sort((a, b) => Math.abs(b.positionChange) - Math.abs(a.positionChange));

    return {
        assetClass,
        generatedAt: new Date(),
        summary: {
            totalAssets: newRanking.length,
            newEntries: newEntries.length,
            exits: exits.length,
            upgrades: upgrades.length,
            downgrades: downgrades.length,
            positionChanges: biggestMovers.length
        },
        newEntries,
        exits,
        upgrades,
        downgrades,
        biggestMovers: biggestMovers.slice(0, 8),
        topBuys: newRanking.filter(r => r.action === 'BUY').slice(0, 5).map(r => ({
            ticker: r.ticker, name: r.name, score: r.score, riskProfile: r.riskProfile, sector: r.sector
        }))
    };
};

const buildExplainableAIPrompt = (assetClass, newRanking, comparisonReport, macroConfig) => {
    const labelMap = {
        STOCK: 'Ações (B3)',
        FII: 'Fundos Imobiliários',
        CRYPTO: 'Criptoativos',
        BRASIL_10: 'Brasil 10',
        STOCK_US: 'Ativos Globais (S&P 500)',
    };
    const label = labelMap[assetClass] || assetClass;
    const macro = macroConfig || {};
    const topBuys = newRanking.filter(r => r.action === 'BUY').slice(0, 5);
    const date = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    let prompt = `# Prompt para Análise Explicável — ${label} (${date})\n\n`;
    prompt += `## Contexto Macroeconômico\n`;
    prompt += `- SELIC: ${macro.selic ?? 'N/D'}% a.a.\n`;
    prompt += `- IPCA (12m): ${macro.ipca ?? 'N/D'}%\n`;
    prompt += `- CDI: ${macro.cdi ?? 'N/D'}% a.a.\n`;
    prompt += `- IBOV (último): ${macro.ibov ? macro.ibov.toLocaleString('pt-BR') : 'N/D'} pts\n`;
    prompt += `- Dólar: R$ ${macro.dollar ?? 'N/D'}\n\n`;

    prompt += `## Top Recomendações de Compra (${label})\n`;
    topBuys.forEach((r, i) => {
        prompt += `\n${i + 1}. **${r.ticker}** — ${r.name || ''} (${r.sector || 'Setor N/D'})\n`;
        prompt += `   - Score: ${r.score?.toFixed(1) ?? 'N/D'} | Perfil: ${r.riskProfile} | Ação: ${r.action}\n`;
        prompt += `   - Preço atual: R$ ${r.currentPrice ?? 'N/D'}\n`;
        if (r.bullThesis?.length) prompt += `   - Bull: ${r.bullThesis.slice(0, 2).join('; ')}\n`;
        if (r.bearThesis?.length) prompt += `   - Bear: ${r.bearThesis.slice(0, 1).join('; ')}\n`;
    });

    if (comparisonReport) {
        const s = comparisonReport.summary;
        prompt += `\n## Mudanças vs. Semana Anterior\n`;
        prompt += `- Total no ranking: ${s.totalAssets} ativos\n`;
        prompt += `- Novos entrantes: ${s.newEntries}\n`;
        prompt += `- Saídas: ${s.exits}\n`;
        prompt += `- Upgrades (WAIT→BUY): ${s.upgrades}\n`;
        prompt += `- Downgrades (BUY→WAIT): ${s.downgrades}\n`;

        if (comparisonReport.newEntries?.length) {
            prompt += `\n### Novos Entrantes\n`;
            comparisonReport.newEntries.forEach(e => { prompt += `- ${e.ticker} (${e.name}) — Score: ${e.score?.toFixed(1)} — ${e.action}\n`; });
        }
        if (comparisonReport.exits?.length) {
            prompt += `\n### Saídas\n`;
            comparisonReport.exits.forEach(e => { prompt += `- ${e.ticker} (${e.name})\n`; });
        }
        if (comparisonReport.upgrades?.length) {
            prompt += `\n### Upgrades para COMPRAR\n`;
            comparisonReport.upgrades.forEach(e => { prompt += `- ${e.ticker}: Score ${e.previousScore?.toFixed(1)} → ${e.newScore?.toFixed(1)}\n`; });
        }
        if (comparisonReport.downgrades?.length) {
            prompt += `\n### Downgrades para AGUARDAR\n`;
            comparisonReport.downgrades.forEach(e => { prompt += `- ${e.ticker}: Score ${e.previousScore?.toFixed(1)} → ${e.newScore?.toFixed(1)}\n`; });
        }
        if (comparisonReport.biggestMovers?.length) {
            prompt += `\n### Maiores Movimentações\n`;
            comparisonReport.biggestMovers.forEach(e => {
                const dir = e.positionChange > 0 ? `↑${e.positionChange}` : `↓${Math.abs(e.positionChange)}`;
                prompt += `- ${e.ticker}: ${dir} posições, Δscore: ${e.scoreDelta > 0 ? '+' : ''}${e.scoreDelta}\n`;
            });
        }
    }

    prompt += `\n---\n`;
    prompt += `## TAREFA\n`;
    prompt += `Com base nos dados acima, gere uma análise semanal para investidores pessoa física.\n\n`;

    prompt += `## FORMATO DE RESPOSTA (SIGA EXATAMENTE)\n`;
    prompt += `Sua resposta deve usar OBRIGATORIAMENTE esta estrutura de seções, com exatamente estes cabeçalhos:\n\n`;

    prompt += `## 📊 Cenário Macro\n`;
    prompt += `[1-2 parágrafos contextualizando o ambiente macro e como impacta a classe de ativos desta semana]\n\n`;

    prompt += `## 🏆 Destaques da Semana\n`;
    prompt += `[Lista dos principais ativos de compra, um por linha, no formato:]\n`;
    prompt += `- 🟢 **TICKER** — [tese de 1-2 linhas sem mencionar scores]\n\n`;

    prompt += `## 🔄 Movimentações Relevantes\n`;
    prompt += `[Bullet points sobre entradas, saídas e upgrades/downgrades, no formato:]\n`;
    prompt += `- 🟢 **TICKER** — [motivo do upgrade ou entrada]\n`;
    prompt += `- 🟡 **TICKER** — [motivo do downgrade ou saída]\n\n`;

    prompt += `## ⚠️ Pontos de Atenção\n`;
    prompt += `[Bullet points sobre riscos e ativos em observação, no formato:]\n`;
    prompt += `- **TICKER** — [risco ou ponto de atenção em uma linha]\n\n`;

    prompt += `## 💡 Conclusão\n`;
    prompt += `[1 parágrafo objetivo com visão geral e orientação para o investidor]\n\n`;

    prompt += `## REGRAS OBRIGATÓRIAS\n`;
    prompt += `- Use **negrito** (dois asteriscos) para tickers e termos-chave\n`;
    prompt += `- Prefixe ativos com sinal COMPRAR com 🟢 e AGUARDAR com 🟡\n`;
    prompt += `- NÃO mencione scores numéricos — use "forte posicionamento", "pressão vendedora", "momento favorável", etc.\n`;
    prompt += `- NÃO use tabelas, NÃO use código, NÃO use HTML\n`;
    prompt += `- Use APENAS os cabeçalhos ## indicados acima, sem criar novos\n`;
    prompt += `- Total entre 400 e 600 palavras\n`;
    prompt += `- Linguagem profissional mas acessível\n`;

    return prompt;
};

// Exportado para teste. Brasil 10 não usa draft competitivo: pega o top 5 por score
// DEFENSIVO de um conjunto já processado (STOCK ou FII), forçando perfil DEFENSIVE.
// O score já vem capado pelo scoringEngine (maxScoreAllowed); aqui não há penalidade
// de concentração (por design — é uma lista curinga, não uma carteira; por isso o
// score pode diferir do ranking de classe, que penaliza concentração por grupo).
// Prioriza quem passou no gate isEligibleForDefensive: um ativo reprovado no gate
// não deve aparecer rotulado DEFENSIVE — inelegíveis só completam se faltar elegível.
export const getTop5Defensive = (processedAssets) => {
    const ranked = (processedAssets || [])
        .map(a => ({
            ...a,
            score: a.scores['DEFENSIVE'],
            riskProfile: 'DEFENSIVE',
            action: 'WAIT', // redefinido por buildBrasil10 conforme o threshold
            tier: 'GOLD',
            thesis: `Brasil 10: Score Defensivo ${a.scores['DEFENSIVE']}`
        }))
        .sort((a, b) => b.score - a.score);
    const eligible = ranked.filter(a => a.isDefensiveEligible !== false);
    const backfill = ranked.filter(a => a.isDefensiveEligible === false);
    return [...eligible, ...backfill].slice(0, 5);
};

// Exportado para teste. Monta o Brasil 10 (≤5 STOCK + ≤5 FII) a partir dos universos
// já processados, reaplica action pelo threshold global e ordena/posiciona. Função pura
// (sem I/O); o delta de posição é aplicado por quem chama via calculateRankingDelta.
export const buildBrasil10 = (stockProcessed, fiiProcessed) => {
    const merged = [...getTop5Defensive(stockProcessed), ...getTop5Defensive(fiiProcessed)]
        .map(item => ({ ...item, action: item.score >= BUY_THRESHOLD ? 'BUY' : 'WAIT' }))
        .sort((a, b) => {
            const scoreDiff = b.score - a.score;
            if (scoreDiff !== 0) return scoreDiff;
            const composite = (item) => {
                const structural = item.metrics?.structural;
                return structural ? (structural.quality + structural.valuation + structural.risk) / 3 : 0;
            };
            return composite(b) - composite(a);
        });
    return merged.map((item, idx) => ({ ...item, position: idx + 1 }));
};

const normalize = (ticker) => {
    if (!ticker) return '';
    return ticker.toUpperCase().replace('.SA', '').replace(/[^A-Z0-9]/g, '').trim();
};

// Exportado para teste (baseline publicado — ver comentário interno).
export const calculateRankingDelta = async (currentList, assetClass, strategy) => {
    try {
        // Baseline PUBLICADO — mesmo critério do generateComparisonReport. Sem o filtro,
        // as setas de posição comparavam contra rascunhos não publicados (que o TTL apaga).
        const lastReport = await MarketAnalysis.findOne({ assetClass, strategy, isRankingPublished: true }).sort({ createdAt: -1 });
        const prevPosMap = new Map();
        if (lastReport && lastReport.content && lastReport.content.ranking) {
            lastReport.content.ranking.forEach(r => {
                const t = normalize(r.ticker);
                if (t) prevPosMap.set(t, r.position);
            });
        }
        return currentList.map(item => {
            const t = normalize(item.ticker);
            const prev = prevPosMap.get(t);
            return { ...item, previousPosition: prev !== undefined ? prev : null };
        });
    } catch (e) {
        return currentList;
    }
};

export const aiResearchService = {
    async calculateRanking(assetClass, strategy = 'BUY_HOLD') {
        try {
            const rawData = await marketDataService.getMarketData(assetClass);
            
            if (!rawData || rawData.length === 0) {
                logger.warn("⚠️ Nenhum dado encontrado no Banco. Execute 'Sync Preços' primeiro.");
                return { ranking: [], fullList: [], processedAssets: [] };
            }
            
            const macroConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            
            const context = {
                MACRO: macroConfig ? {
                    SELIC: macroConfig.selic,
                    IPCA: macroConfig.ipca,
                    RISK_FREE: macroConfig.riskFree,
                    NTNB_LONG: macroConfig.ntnbLong,
                    // (I) Observabilidade macro → confiança: taxas em fallback descontam confiança
                    // de ativos BR sensíveis a juros (ver calculateConfidenceScore).
                    RATES_STALE: !!macroConfig.ratesStale
                } : {
                    // Sem MACRO_INDICATORS no banco: opera 100% em fallback → stale por definição.
                    SELIC: DEFAULT_SELIC_FALLBACK, IPCA: 4.50, RISK_FREE: DEFAULT_SELIC_FALLBACK, NTNB_LONG: DEFAULT_NTNB_FALLBACK,
                    RATES_STALE: true
                }
            };

            let processedAssets = [];
            const stockCalibrationCandidates = [];
            const discardOperations = [];
            const runId = Date.now().toString();

            rawData.forEach(asset => {
                const scoringAsset = assetClass === 'STOCK'
                    ? prepareStockForSectorScoring(asset)
                    : asset;
                const scoringResult = scoringEngine.processAsset(scoringAsset, context);
                const result = assetClass === 'STOCK' && scoringResult && !scoringResult._discarded
                    ? normalizeStockScoringOutputForPersistence(scoringResult)
                    : scoringResult;
                if (result) {
                    if (result._discarded) {
                        // Log de Descarte
                        discardOperations.push({
                            runId,
                            ticker: asset.ticker,
                            reason: result.reason,
                            details: result.details,
                            assetType: assetClass
                        });
                    } else {
                        processedAssets.push(result);
                        if (assetClass === 'STOCK') {
                            const calibrationAsset = {
                                ...scoringAsset,
                                metrics: result.metrics,
                            };
                            const coverage = assessStockMetricCoverage(calibrationAsset);
                            const axes = calculateStockShadowAxes(calibrationAsset);
                            stockCalibrationCandidates.push({
                                ticker: result.ticker,
                                name: result.name,
                                sector: result.sector,
                                type: result.type,
                                metrics: result.metrics,
                                sectorMetrics: scoringAsset.sectorMetrics || {},
                                archetype: coverage.archetype,
                                eligibleByProfile: {
                                    DEFENSIVE: result.isDefensiveEligible !== false,
                                    MODERATE: true,
                                    BOLD: true,
                                },
                                coverage,
                                dataConfidence: calculateStockCalibrationConfidence(
                                    calibrationAsset,
                                    coverage,
                                    context.MACRO.RATES_STALE,
                                ),
                                axes,
                                currentScores: result.scores,
                                processedAsset: result,
                                reason: stockWeakAxisReason(axes),
                            });
                        }
                    }
                }
            });

            // Persiste Logs de Descarte (Async para não travar)
            if (discardOperations.length > 0) {
                DiscardLog.insertMany(discardOperations).catch(e => logger.error(`Erro salvando discard logs: ${e.message}`));
            }

            // Opções de draft por classe:
            // - REIT é mono-setor (todo o universo cai em REAL_ESTATE) → relaxa cap/penalidade.
            // - CRYPTO dedicado → relaxa o cap de cripto/perfil (Defensivo segue limitado pelo gate).
            const draftOptions = assetClass === 'REIT' ? { relaxSectorConcentration: true }
                : assetClass === 'CRYPTO' ? { relaxCryptoCap: true }
                : {};

            // draft + penalidade de concentração sobre um conjunto de ativos já processados.
            const draftAndPenalize = (assets, opts = draftOptions) =>
                portfolioEngine.applyConcentrationPenalty(
                    portfolioEngine.performCompetitiveDraft(assets, opts),
                    opts
                );

            let ranking;
            if (assetClass === 'STOCK') {
                const calibratedDraft = buildCompetitiveCohesiveShadowTop10s(stockCalibrationCandidates);
                ranking = calibratedDraft.selectedItems;
                processedAssets = calibratedDraft.calibratedAssets;
                const excludedCoverage = processedAssets.filter(asset => !asset.stockCalibration?.eligible).length;
                logger.info(
                    `[Ranking STOCK] ${STOCK_CALIBRATION_SHADOW_VERSION}: `
                    + `${ranking.length} selecionados únicos; ${processedAssets.length} auditados; `
                    + `${excludedCoverage} excluídos por cobertura.`,
                );
            } else if (assetClass === 'ETF') {
                // ETF roda DOIS drafts independentes (nacional B3 vs internacional/ouro) para
                // que o universo BR tenha seu próprio top-10 por perfil e nunca seja espremido
                // pelos ETFs US (que pontuam mais alto). Os dois são concatenados e o sort
                // global abaixo só define a posição ordinal — o front fatia por origem.
                const brAssets = processedAssets.filter(a => a.type === 'ETF');
                const usAssets = processedAssets.filter(a => a.type !== 'ETF');
                ranking = [...draftAndPenalize(brAssets), ...draftAndPenalize(usAssets)];
            } else {
                ranking = draftAndPenalize(processedAssets);
            }

            // Ordenação Global por Score. Empates (pós-penalidade de concentração) desempatados
            // pelo composite estrutural para evitar que ordem de inserção do draft determine posição.
            ranking.sort((a, b) => {
                const diff = b.score - a.score;
                if (diff !== 0) return diff;
                const compA = a.metrics?.structural ? (a.metrics.structural.quality + a.metrics.structural.valuation + a.metrics.structural.risk) / 3 : 0;
                const compB = b.metrics?.structural ? (b.metrics.structural.quality + b.metrics.structural.valuation + b.metrics.structural.risk) / 3 : 0;
                return compB - compA;
            });

            // Atribuição de Posição Global (Essencial para o cálculo de Delta/Setas nas próximas revisões)
            ranking = ranking.map((item, idx) => ({ ...item, position: idx + 1 }));

            ranking = await calculateRankingDelta(ranking, assetClass, strategy);

            // Estatísticas de Tier para Monitoramento
            const tierStats = {
                GOLD: ranking.filter(r => r.tier === 'GOLD').length,
                SILVER: ranking.filter(r => r.tier === 'SILVER').length,
                BRONZE: ranking.filter(r => r.tier === 'BRONZE').length
            };
            logger.info(`🏆 [Ranking ${assetClass}] G:${tierStats.GOLD} S:${tierStats.SILVER} B:${tierStats.BRONZE}`);
            
            // THRESHOLD GLOBAL (BUY_THRESHOLD): COMPRAR apenas acima de 70 pontos — ver financialConstants
            // Ativos no ranking já têm perfil e score atribuídos pelo draft competitivo
            // (incluindo penalidades de concentração). A auditoria deve refletir exatamente
            // os mesmos valores para evitar inconsistência entre as duas abas.
            const rankingProfileMap = new Map(
                ranking.map(r => [r.ticker, { riskProfile: r.riskProfile, score: r.score, action: r.action, auditLog: r.auditLog }])
            );

            const fullList = processedAssets.map(asset => {
                const inRanking = rankingProfileMap.get(asset.ticker);
                if (inRanking) {
                    return {
                        ...asset,
                        riskProfile: inRanking.riskProfile,
                        score: inRanking.score,
                        action: inRanking.action,
                        // O auditLog do item do ranking inclui a penalidade de concentração
                        // (quando houve); o asset original em processedAssets não a tem. Usa o
                        // do ranking para a Auditoria Completa reconciliar com o score exibido.
                        auditLog: inRanking.auditLog || asset.auditLog,
                        thesis: `Audit: Score ${inRanking.score} em ${inRanking.riskProfile}`
                    };
                }
                // Ativos fora do ranking: usa o melhor perfil disponível
                const entries = Object.entries(asset.scores);
                const [bestProfile, bestScore] = entries.reduce((a, b) => a[1] > b[1] ? a : b);
                return {
                    ...asset,
                    riskProfile: bestProfile,
                    score: bestScore,
                    action: bestScore >= BUY_THRESHOLD ? 'BUY' : 'WAIT',
                    thesis: `Audit: Score ${bestScore} em ${bestProfile}`
                };
            }).sort((a, b) => b.score - a.score);

            // discardLogs em memória: o relatório TXT usa isto diretamente em vez de
            // reconsultar o banco por janela de tempo (que perdia/misturava runs).
            return { ranking, fullList, processedAssets, tierStats, discardLogs: discardOperations };

        } catch (error) {
            logger.error(`Erro ranking: ${error.message}`);
            return { ranking: [], fullList: [], processedAssets: [], discardLogs: [] };
        }
    },

    async runBatchAnalysis(adminId = null) {
        const strat = 'BUY_HOLD';
        const runId = randomUUID();
        const algorithmVersion = process.env.RENDER_GIT_COMMIT
            || process.env.GIT_COMMIT
            || process.env.npm_package_version
            || STOCK_CALIBRATION_SHADOW_VERSION;
        const expectedClasses = ['STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'REIT', 'ETF', 'BRASIL_10'];
        const batch = await ResearchBatch.create({
            runId,
            strategy: strat,
            expectedClasses,
            generatedBy: adminId,
            algorithmVersion,
        });
        let currentClass = 'BATCH';

        try {
            const macroConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
            batch.inputManifest = {
                capturedAt: new Date(),
                macroConfigId: macroConfig?._id || null,
                macroLastSync: macroConfig?.lastUpdated || macroConfig?.updatedAt || null,
                fundamentalsSync: macroConfig?.lastSyncStats?.timestamp || null,
                stockCalibrationVersion: STOCK_CALIBRATION_SHADOW_VERSION,
            };
            await batch.save();

            const saveAnalysis = async (assetClass, ranking, fullList) => {
                if (!ranking || ranking.length === 0) {
                    logger.warn(`🚨 [Research] Ranking VAZIO gerado para ${assetClass}`);
                    Sentry.captureMessage(`Ranking vazio gerado para ${assetClass}`, 'warning');
                    batch.warnings.push({
                        assetClass,
                        code: 'EMPTY_RANKING',
                        message: 'Ranking vazio salvo como rascunho e inelegível para publicação automática.',
                    });
                }
                const prevAnalysis = await MarketAnalysis.findOne({
                    assetClass,
                    strategy: strat,
                    isRankingPublished: true,
                }).sort({ createdAt: -1 }).select('content.ranking date');
                const finalizedRanking = finalizeRanking(ranking, prevAnalysis?.content?.ranking || []);
                const publicRanking = finalizedRanking.map(stripStockCalibrationInternals);
                const comparisonReport = generateComparisonReport(
                    assetClass,
                    publicRanking,
                    prevAnalysis?.content?.ranking || [],
                );
                const explainableAIPrompt = buildExplainableAIPrompt(
                    assetClass,
                    publicRanking,
                    comparisonReport,
                    macroConfig,
                );
                const analysis = await MarketAnalysis.create({
                    assetClass,
                    strategy: strat,
                    batchId: batch._id,
                    runId,
                    algorithmVersion,
                    inputManifest: batch.inputManifest,
                    content: { ranking: publicRanking, fullAuditLog: fullList },
                    generatedBy: adminId,
                    comparisonReport,
                    explainableAIPrompt,
                });
                if (!batch.completedClasses.includes(assetClass)) batch.completedClasses.push(assetClass);
                await batch.save();
                return analysis;
            };

            currentClass = 'STOCK';
            logger.info("ℹ️ [AI Research] Processando Ações...");
            const stockData = await this.calculateRanking('STOCK', strat);
            await saveAnalysis('STOCK', stockData.ranking, stockData.fullList);

            currentClass = 'FII';
            logger.info("ℹ️ [AI Research] Processando FIIs...");
            const fiiData = await this.calculateRanking('FII', strat);
            await saveAnalysis('FII', fiiData.ranking, fiiData.fullList);

            currentClass = 'CRYPTO';
            logger.info("ℹ️ [AI Research] Processando Criptomoedas...");
            const cryptoData = await this.calculateRanking('CRYPTO', strat);
            await saveAnalysis('CRYPTO', cryptoData.ranking, cryptoData.fullList);

            currentClass = 'STOCK_US';
            logger.info("ℹ️ [AI Research] Processando Ativos Globais (S&P 500)...");
            const stockUsData = await this.calculateRanking('STOCK_US', strat);
            await saveAnalysis('STOCK_US', stockUsData.ranking, stockUsData.fullList);

            currentClass = 'REIT';
            logger.info("ℹ️ [AI Research] Processando REITs (imobiliário US)...");
            const reitData = await this.calculateRanking('REIT', strat);
            await saveAnalysis('REIT', reitData.ranking, reitData.fullList);

            currentClass = 'ETF';
            logger.info("ℹ️ [AI Research] Processando ETFs (nacionais + internacionais)...");
            const etfData = await this.calculateRanking('ETF', strat);
            await saveAnalysis('ETF', etfData.ranking, etfData.fullList);

            currentClass = 'BRASIL_10';
            logger.info("ℹ️ [AI Research] Processando Brasil 10...");
            let brasil10List = buildBrasil10(stockData.processedAssets, fiiData.processedAssets);
            brasil10List = await calculateRankingDelta(brasil10List, 'BRASIL_10', strat);
            await saveAnalysis('BRASIL_10', brasil10List, brasil10List);

            try {
                const allData = {
                    BRASIL_10: { ranking: brasil10List, fullList: brasil10List, discardLogs: [] },
                    STOCK: { ranking: stockData.ranking, fullList: stockData.fullList, discardLogs: stockData.discardLogs },
                    FII: { ranking: fiiData.ranking, fullList: fiiData.fullList, discardLogs: fiiData.discardLogs },
                    CRYPTO: { ranking: cryptoData.ranking, fullList: cryptoData.fullList, discardLogs: cryptoData.discardLogs },
                    STOCK_US: { ranking: stockUsData.ranking, fullList: stockUsData.fullList, discardLogs: stockUsData.discardLogs },
                    REIT: { ranking: reitData.ranking, fullList: reitData.fullList, discardLogs: reitData.discardLogs },
                    ETF: { ranking: etfData.ranking, fullList: etfData.fullList, discardLogs: etfData.discardLogs },
                };
                const exportResult = await rankingTxtExportService.saveRankingReport(allData, macroConfig);
                if (exportResult.success) logger.info(`📄 [Export TXT] Relatório salvo: ${exportResult.filename}`);
                else logger.warn(`⚠️ [Export TXT] Falha ao salvar relatório: ${exportResult.error}`);
            } catch (exportErr) {
                logger.warn(`⚠️ [Export TXT] Erro inesperado: ${exportErr.message}`);
            }

            batch.status = batch.warnings.length ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';
            batch.completedAt = new Date();
            await batch.save();
            return { success: true, runId, batchId: batch._id, status: batch.status };
        } catch (error) {
            if (currentClass !== 'BATCH' && !batch.failedClasses.includes(currentClass)) {
                batch.failedClasses.push(currentClass);
            }
            batch.failures.push({
                assetClass: currentClass,
                code: error.code || 'BATCH_FAILURE',
                message: error.message,
            });
            batch.status = batch.completedClasses.length ? 'PARTIAL' : 'FAILED';
            batch.completedAt = new Date();
            await batch.save();
            throw error;
        }
    },

    async generateNarrative(ranking, assetClass) {
        if (!process.env.API_KEY || ranking.length === 0) return "Análise indisponível.";
        const highlights = ranking.filter(r => r.action === 'BUY').slice(0, 5);
        const contextItems = highlights.map(a => `- ${a.ticker} (${a.riskProfile}): R$ ${a.currentPrice} (Score ${a.score}). ${a.thesis}`).join('\n');
        const prompt = `Aja como Head Research. Morning Call curto sobre ${assetClass}.\nDestaques:\n${contextItems}`;
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({ model: 'gemini-2.0-flash-exp', contents: prompt });
            return response.text;
        } catch (e) { return "Análise IA indisponível."; }
    }
};
