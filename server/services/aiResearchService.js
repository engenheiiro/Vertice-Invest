
import { GoogleGenAI } from "@google/genai";
import logger from '../config/logger.js';
import { marketDataService } from './marketDataService.js';
import { scoringEngine } from './engines/scoringEngine.js';
import { portfolioEngine } from './engines/portfolioEngine.js';
import SystemConfig from '../models/SystemConfig.js';
import MarketAnalysis from '../models/MarketAnalysis.js';
import DiscardLog from '../models/DiscardLog.js';
import { rankingTxtExportService } from './rankingTxtExportService.js';

const generateComparisonReport = (assetClass, newRanking, previousRanking) => {
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

const normalize = (ticker) => {
    if (!ticker) return '';
    return ticker.toUpperCase().replace('.SA', '').replace(/[^A-Z0-9]/g, '').trim();
};

const calculateRankingDelta = async (currentList, assetClass, strategy) => {
    try {
        const lastReport = await MarketAnalysis.findOne({ assetClass, strategy }).sort({ createdAt: -1 });
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
                    NTNB_LONG: macroConfig.ntnbLong
                } : {
                    SELIC: 11.25, IPCA: 4.50, RISK_FREE: 11.25, NTNB_LONG: 6.30
                }
            };

            const processedAssets = [];
            const discardOperations = [];
            const runId = Date.now().toString();

            rawData.forEach(asset => {
                const result = scoringEngine.processAsset(asset, context);
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
                    }
                }
            });

            // Persiste Logs de Descarte (Async para não travar)
            if (discardOperations.length > 0) {
                DiscardLog.insertMany(discardOperations).catch(e => logger.error(`Erro salvando discard logs: ${e.message}`));
            }

            let ranking = portfolioEngine.performCompetitiveDraft(processedAssets);
            ranking = portfolioEngine.applyConcentrationPenalty(ranking);
            
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
            
            // THRESHOLD GLOBAL: COMPRAR apenas acima de 70 pontos
            const BUY_THRESHOLD = 70;

            // Ativos no ranking já têm perfil e score atribuídos pelo draft competitivo
            // (incluindo penalidades de concentração). A auditoria deve refletir exatamente
            // os mesmos valores para evitar inconsistência entre as duas abas.
            const rankingProfileMap = new Map(
                ranking.map(r => [r.ticker, { riskProfile: r.riskProfile, score: r.score, action: r.action }])
            );

            const fullList = processedAssets.map(asset => {
                const inRanking = rankingProfileMap.get(asset.ticker);
                if (inRanking) {
                    return {
                        ...asset,
                        riskProfile: inRanking.riskProfile,
                        score: inRanking.score,
                        action: inRanking.action,
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

            return { ranking, fullList, processedAssets, tierStats }; 

        } catch (error) {
            logger.error(`Erro ranking: ${error.message}`);
            return { ranking: [], fullList: [], processedAssets: [] };
        }
    },

    async runBatchAnalysis(adminId = null) {
        const strat = 'BUY_HOLD';
        
        const macroConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });

        const saveAnalysis = async (assetClass, ranking, fullList) => {
            const prevAnalysis = await MarketAnalysis.findOne({ assetClass, strategy: strat, isRankingPublished: true }).sort({ createdAt: -1 }).select('content.ranking date');
            const comparisonReport = generateComparisonReport(assetClass, ranking, prevAnalysis?.content?.ranking || []);
            const explainableAIPrompt = buildExplainableAIPrompt(assetClass, ranking, comparisonReport, macroConfig);
            return MarketAnalysis.create({ assetClass, strategy: strat, content: { ranking, fullAuditLog: fullList }, generatedBy: adminId, comparisonReport, explainableAIPrompt });
        };

        logger.info("ℹ️ [AI Research] Processando Ações...");
        const stockData = await this.calculateRanking('STOCK', strat);
        await saveAnalysis('STOCK', stockData.ranking, stockData.fullList);

        logger.info("ℹ️ [AI Research] Processando FIIs...");
        const fiiData = await this.calculateRanking('FII', strat);
        await saveAnalysis('FII', fiiData.ranking, fiiData.fullList);

        logger.info("ℹ️ [AI Research] Processando Criptomoedas...");
        const cryptoData = await this.calculateRanking('CRYPTO', strat);
        await saveAnalysis('CRYPTO', cryptoData.ranking, cryptoData.fullList);

        logger.info("ℹ️ [AI Research] Processando Ativos Globais (S&P 500)...");
        const stockUsData = await this.calculateRanking('STOCK_US', strat);
        await saveAnalysis('STOCK_US', stockUsData.ranking, stockUsData.fullList);

        logger.info("ℹ️ [AI Research] Processando Brasil 10...");
        
        const getTop5Defensive = (fullList) => {
            return fullList
                .map(a => ({
                    ...a,
                    score: a.scores['DEFENSIVE'], 
                    riskProfile: 'DEFENSIVE',     
                    action: 'WAIT', // Será redefinido abaixo
                    tier: 'GOLD', 
                    thesis: `Brasil 10: Score Defensivo ${a.scores['DEFENSIVE']}`
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 5); 
        };

        const BUY_THRESHOLD = 70;

        const top5Stocks = getTop5Defensive(stockData.processedAssets);
        const top5FIIs = getTop5Defensive(fiiData.processedAssets);
        
        let brasil10List = [...top5Stocks, ...top5FIIs];
        
        // Re-aplica a ação baseada no threshold global de 70
        brasil10List = brasil10List.map(item => ({
            ...item,
            action: item.score >= BUY_THRESHOLD ? 'BUY' : 'WAIT'
        }));
        brasil10List.sort((a, b) => b.score - a.score);

        brasil10List = brasil10List.map((item, idx) => ({ ...item, position: idx + 1 }));
        brasil10List = await calculateRankingDelta(brasil10List, 'BRASIL_10', strat);

        await saveAnalysis('BRASIL_10', brasil10List, brasil10List);

        // Exporta ranking completo para TXT local
        try {
            const allData = {
                BRASIL_10: { ranking: brasil10List,          fullList: brasil10List             },
                STOCK:     { ranking: stockData.ranking,     fullList: stockData.fullList       },
                FII:       { ranking: fiiData.ranking,       fullList: fiiData.fullList         },
                CRYPTO:    { ranking: cryptoData.ranking,    fullList: cryptoData.fullList      },
                STOCK_US:  { ranking: stockUsData.ranking,   fullList: stockUsData.fullList     },
            };

            // Coleta discard logs do run atual (últimos 10 min) para incluir no relatório
            const since = new Date(Date.now() - 10 * 60 * 1000);
            const discardLogs = await DiscardLog.find({ createdAt: { $gte: since } }).lean();
            Object.keys(allData).forEach(cls => { allData[cls].discardLogs = discardLogs; });

            const exportResult = await rankingTxtExportService.saveRankingReport(allData, macroConfig);
            if (exportResult.success) {
                logger.info(`📄 [Export TXT] Relatório salvo: ${exportResult.filename}`);
            } else {
                logger.warn(`⚠️ [Export TXT] Falha ao salvar relatório: ${exportResult.error}`);
            }
        } catch (exportErr) {
            logger.warn(`⚠️ [Export TXT] Erro inesperado: ${exportErr.message}`);
        }

        return true;
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
