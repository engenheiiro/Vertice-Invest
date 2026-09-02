
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
import { GEMINI_TEXT_MODEL } from '../config/aiModels.js';
import { randomUUID } from 'crypto';
import ResearchBatch from '../models/ResearchBatch.js';
import { finalizeRanking, normalizeRankingTicker } from '../utils/rankingContract.js';
import { WEEKLY_HYSTERESIS, WEEKLY_STRATEGY, isWeeklyRetentionEnabled } from '../config/weeklyHysteresis.js';
import { applyWeeklyRetention, applyBrasil10Retention } from '../utils/weeklyRetention.js';
import {
    calculateStockCalibrationConfidence,
    calculateStockShadowAxes,
} from './engines/stockSectorAxisEngine.js';
import {
    STOCK_CALIBRATION_SHADOW_VERSION,
    STOCK_STRICT_SECTOR_CAP_BY_PROFILE,
    buildCompetitiveCohesiveShadowTop10s,
} from './engines/stockCalibrationShadowEngine.js';
import { assessStockMetricCoverage } from '../config/stockCalibration.js';
import { measurePerformance } from '../utils/performanceMetrics.js';

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

/**
 * Auditoria da retenção de assento, no formato que vai para o `inputManifest` do
 * documento. Enxuta de propósito: o manifesto é metadado da apuração, não uma
 * segunda cópia do ranking.
 */
const buildRetentionAudit = ({ assetClass, result, applied }) => ({
    version: 'WEEKLY_RETENTION_V1',
    assetClass,
    // `shadow: true` = calculado e registrado, mas o ranking publicado é o do draft.
    shadow: WEEKLY_HYSTERESIS.shadow,
    applied,
    holdScore: WEEKLY_HYSTERESIS.holdScore,
    maxRetentionShare: WEEKLY_HYSTERESIS.maxRetentionShare,
    bootstrap: result.bootstrap,
    counts: result.counts,
    retained: result.retained.map(r => ({
        ticker: r.ticker,
        profile: r.profile,
        previousProfile: r.previousProfile ?? null,
        previousScore: r.previousScore ?? null,
        score: r.score,
        // Registrado para tornar visível o que a regra inviolável garante: um
        // incumbente retido abaixo de 70 aparece na lista como AGUARDAR.
        action: r.action,
        displaced: r.displaced,
    })),
    exits: result.exits.map(e => ({
        ticker: e.ticker,
        outcome: e.outcome,
        reason: e.reason,
        score: e.score ?? null,
        previousScore: e.previousScore ?? null,
    })),
});

/** Log + Sentry do resultado da retenção. Estourar o teto é sinal, não rotina. */
const reportRetention = (assetClass, result) => {
    const mode = WEEKLY_HYSTERESIS.shadow ? 'shadow' : 'ativo';
    logger.info(
        `[Retenção ${assetClass}] ${mode}: ${result.counts.retained} retidos, `
        + `${result.counts.exits} saídas (teto ${result.counts.maxRetentions}/${result.counts.seats})`,
        {
            assetClass,
            shadow: WEEKLY_HYSTERESIS.shadow,
            bootstrap: result.bootstrap,
            ...result.counts,
            retained: result.retained.map(r => `${r.ticker}:${r.previousScore}->${r.score}/${r.action}`),
        },
    );
    if (result.counts.budgetExhausted) {
        // Base degradada (sync parcial, fonte fora do ar) congelaria a lista em
        // incumbentes; o teto impede, mas o fato de ele ter mordido é um aviso.
        const msg = `Teto de retenções estourado em ${assetClass} `
            + `(${result.counts.maxRetentions} de ${result.counts.seats} assentos)`;
        logger.warn(`⚠️ [Retenção ${assetClass}] ${msg}`);
        Sentry.captureMessage(msg, 'warning');
    }
};

export class RankingCalculationError extends Error {
    constructor(assetClass, cause) {
        super(`Falha ao calcular ranking de ${assetClass}: ${cause?.message || 'erro desconhecido'}`, { cause });
        this.name = 'RankingCalculationError';
        this.code = 'RANKING_CALCULATION_FAILED';
        this.assetClass = assetClass;
    }
}

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
//
// RETENÇÃO DE ASSENTO: o Brasil 10 não passa pelo draft, então ganha o seu passo
// próprio aqui. Ele mora em `buildBrasil10` — e não dentro de `getTop5Defensive` —
// porque o teto de retenções é do POOL DE 10 (3 assentos), não de cada metade de 5:
// dar meio orçamento a cada chamada daria teto 1, apertado demais para as 112
// trocas de assento medidas. As metades continuam fixas em 5+5.
//
// @param {object} [options]
// @param {Map|Array|null} [options.previous] baseline publicado de BRASIL_10.
//   Ausente (`undefined`) = não avaliar retenção; `null` = primeira apuração.
// @param {string} [options.strategy] estratégia da apuração. O Brasil 10 é, por
//   definição, uma lista do semanal — daí o default — mas o guard de retenção é
//   consultado com ela do mesmo jeito, para não haver um caminho que decida
//   retenção sem olhar a estratégia.
// @param {function} [options.onRetentionAudit] recebe a auditoria (padrão
//   `options.trace` do portfolioEngine: coleta sem mudar o valor de retorno).
export const buildBrasil10 = (stockProcessed, fiiProcessed, options = {}) => {
    let halves = [
        { selected: getTop5Defensive(stockProcessed), universe: stockProcessed || [] },
        { selected: getTop5Defensive(fiiProcessed), universe: fiiProcessed || [] },
    ];

    if (options.previous !== undefined
        && isWeeklyRetentionEnabled('BRASIL_10', options.strategy || WEEKLY_STRATEGY)) {
        const retention = applyBrasil10Retention({ halves, previous: options.previous });
        if (options.onRetentionAudit) {
            options.onRetentionAudit(buildRetentionAudit({
                assetClass: 'BRASIL_10',
                result: retention,
                applied: !WEEKLY_HYSTERESIS.shadow,
            }));
        }
        reportRetention('BRASIL_10', retention);
        if (!WEEKLY_HYSTERESIS.shadow) halves = retention.halves;
    }

    const merged = halves.flatMap(half => half.selected)
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

// Uma chave de identidade só entre apurações. `normalizeRankingTicker` é a mesma
// função que o contrato de ranking usa; o delta de posição e a retenção de
// assento precisam concordar sobre o que é "o mesmo ticker", senão a retenção
// veria uma saída onde o delta vê permanência.
const normalize = normalizeRankingTicker;

/**
 * Baseline PUBLICADO da classe: `Map<tickerNormalizado, {ticker, name, position,
 * score, action, riskProfile}>`, ou `null` quando não há publicação anterior
 * (primeira apuração — `bootstrap`, e a retenção não retém ninguém).
 *
 * Filtra por `isRankingPublished` pelo mesmo motivo do `generateComparisonReport`:
 * sem o filtro, o baseline seria um rascunho que o TTL apaga.
 *
 * Extraído para ser lido UMA vez por apuração e consumido pelos dois clientes
 * (delta de posição e retenção de assento) — antes eram duas idas ao banco pela
 * mesma linha.
 */
export const loadPublishedRankingBaseline = async (assetClass, strategy) => {
    try {
        const lastReport = await MarketAnalysis.findOne(
            { assetClass, strategy, isRankingPublished: true },
        ).sort({ createdAt: -1 }).select('content.ranking').lean();
        if (!lastReport?.content?.ranking) return null;
        const baseline = new Map();
        lastReport.content.ranking.forEach(item => {
            const key = normalize(item.ticker);
            if (!key) return;
            baseline.set(key, {
                ticker: item.ticker,
                name: item.name ?? null,
                position: item.position ?? null,
                score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
                action: item.action ?? null,
                riskProfile: item.riskProfile ?? null,
            });
        });
        return baseline;
    } catch (e) {
        // Fail-closed: sem baseline, o delta fica nulo e a retenção não age —
        // exatamente o comportamento anterior a ela existir.
        logger.warn(`[Ranking ${assetClass}] baseline publicado indisponível: ${e.message}`);
        return null;
    }
};

// Exportado para teste (baseline publicado — ver comentário interno).
// `baseline` opcional evita a segunda leitura quando quem chama já o carregou.
export const calculateRankingDelta = async (currentList, assetClass, strategy, baseline) => {
    try {
        const prev = baseline !== undefined
            ? baseline
            : await loadPublishedRankingBaseline(assetClass, strategy);
        return currentList.map(item => {
            const entry = prev?.get(normalize(item.ticker));
            return { ...item, previousPosition: entry?.position ?? null };
        });
    } catch {
        return currentList;
    }
};

export const aiResearchService = {
    async calculateRanking(assetClass, strategy = 'BUY_HOLD') {
        try {
            const rawData = await marketDataService.getMarketData(assetClass);
            
            if (!rawData || rawData.length === 0) {
                logger.warn("⚠️ Nenhum dado encontrado no Banco. Execute 'Sync Preços' primeiro.");
                return {
                    ranking: [],
                    fullList: [],
                    processedAssets: [],
                    emptyReason: 'NO_MARKET_DATA',
                };
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
                // A régua de 'métrica inaplicável = ausente' vive DENTRO do scorer
                // (applyArchetypeApplicability), para que o semanal e o motor âncora
                // não possam divergir sobre o mesmo ticker.
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
                        if (assetClass === 'STOCK') {
                            const calibrationAsset = { ...asset, metrics: result.metrics };
                            const coverage = assessStockMetricCoverage(calibrationAsset);
                            const axes = calculateStockShadowAxes(calibrationAsset);
                            stockCalibrationCandidates.push({
                                ticker: result.ticker,
                                name: result.name,
                                sector: result.sector,
                                type: result.type,
                                metrics: result.metrics,
                                sectorMetrics: asset.sectorMetrics || {},
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

            // A RÉGUA DA CLASSE, para a retenção não cobrar o que o draft dela não
            // cobra. Ações são a exceção: o draft de calibração decide por CAP e não
            // reescreve a avaliação fundamental depois da seleção — cobrar -5 de
            // concentração de um readmitido colocaria na mesma lista um item pagando
            // o que nenhum outro pagou, e -5 basta para virar 72 em 67. O teto do
            // balde vem da MESMA constante que o draft de ações usa (4 no Defensivo),
            // senão a retenção barraria uma composição que o draft aceita montar.
            const retentionOptions = assetClass === 'STOCK'
                ? {
                    applyConcentrationPenalty: false,
                    sectorCapByProfile: STOCK_STRICT_SECTOR_CAP_BY_PROFILE,
                }
                : { applyConcentrationPenalty: true };

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

            // ── RETENÇÃO DE ASSENTO ────────────────────────────────────────────
            // Passo ÚNICO na fresta entre o draft e o sort global: as três
            // seleções acima (calibração de ações, draft duplo de ETF, draft
            // padrão) convergem aqui, então nenhuma delas precisa conhecer a
            // retenção. Ela decide QUEM FICA na lista — nunca a `action`, que
            // segue derivada do score logo adiante por `finalizeRanking`.
            // BRASIL_10 não passa por aqui no pipeline real (é montado por
            // `buildBrasil10` a partir dos universos de STOCK e FII) e tem o seu
            // próprio passo lá; excluí-lo evita duas semânticas para a mesma classe.
            let retentionAudit = null;
            const baseline = await loadPublishedRankingBaseline(assetClass, strategy);
            if (isWeeklyRetentionEnabled(assetClass, strategy) && assetClass !== 'BRASIL_10') {
                const retention = applyWeeklyRetention({
                    current: ranking,
                    previous: baseline,
                    processedAssets,
                    options: {
                        ...retentionOptions,
                        relaxSectorConcentration: !!draftOptions.relaxSectorConcentration,
                    },
                });
                reportRetention(assetClass, retention);
                retentionAudit = buildRetentionAudit({
                    assetClass,
                    result: retention,
                    applied: !WEEKLY_HYSTERESIS.shadow,
                });
                if (!WEEKLY_HYSTERESIS.shadow) ranking = retention.ranking;
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

            ranking = await calculateRankingDelta(ranking, assetClass, strategy, baseline);

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
            return { ranking, fullList, processedAssets, tierStats, discardLogs: discardOperations, retentionAudit, baseline };

        } catch (error) {
            const rankingError = error instanceof RankingCalculationError
                ? error
                : new RankingCalculationError(assetClass, error);
            logger.error(`Erro ranking ${assetClass}: ${rankingError.message}`);
            throw rankingError;
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

            const saveAnalysis = async (assetClass, ranking, fullList, retentionAudit = null) => {
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
                    // A auditoria completa (retidos, deslocados, contagens) é
                    // metadado da apuração e fica no manifesto.
                    inputManifest: { ...batch.inputManifest, retentionAudit },
                    // As SAÍDAS sobem para o topo do documento porque são conteúdo
                    // de produto, não metadado: a tela as mostra ao assinante, e o
                    // endpoint público não devolve o manifesto por item.
                    // `applied: false` (shadow) mantém a lista publicada igual à do
                    // draft — e então as saídas são contrafactuais e não vão à tela.
                    retentionExits: retentionAudit?.applied ? retentionAudit.exits : [],
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
            const stockData = await measurePerformance('pipeline', 'ranking STOCK', () => this.calculateRanking('STOCK', strat));
            await saveAnalysis('STOCK', stockData.ranking, stockData.fullList, stockData.retentionAudit);

            currentClass = 'FII';
            logger.info("ℹ️ [AI Research] Processando FIIs...");
            const fiiData = await measurePerformance('pipeline', 'ranking FII', () => this.calculateRanking('FII', strat));
            await saveAnalysis('FII', fiiData.ranking, fiiData.fullList, fiiData.retentionAudit);

            currentClass = 'CRYPTO';
            logger.info("ℹ️ [AI Research] Processando Criptomoedas...");
            const cryptoData = await measurePerformance('pipeline', 'ranking CRYPTO', () => this.calculateRanking('CRYPTO', strat));
            await saveAnalysis('CRYPTO', cryptoData.ranking, cryptoData.fullList);

            currentClass = 'STOCK_US';
            logger.info("ℹ️ [AI Research] Processando Ativos Globais (S&P 500)...");
            const stockUsData = await measurePerformance('pipeline', 'ranking STOCK_US', () => this.calculateRanking('STOCK_US', strat));
            await saveAnalysis('STOCK_US', stockUsData.ranking, stockUsData.fullList);

            currentClass = 'REIT';
            logger.info("ℹ️ [AI Research] Processando REITs (imobiliário US)...");
            const reitData = await measurePerformance('pipeline', 'ranking REIT', () => this.calculateRanking('REIT', strat));
            await saveAnalysis('REIT', reitData.ranking, reitData.fullList);

            currentClass = 'ETF';
            logger.info("ℹ️ [AI Research] Processando ETFs (nacionais + internacionais)...");
            const etfData = await measurePerformance('pipeline', 'ranking ETF', () => this.calculateRanking('ETF', strat));
            await saveAnalysis('ETF', etfData.ranking, etfData.fullList);

            currentClass = 'BRASIL_10';
            logger.info("ℹ️ [AI Research] Processando Brasil 10...");
            // O baseline do Brasil 10 é o documento publicado da própria classe
            // BRASIL_10 — separado do de STOCK e do de FII — e é lido uma vez só,
            // servindo tanto à retenção de assento quanto ao delta de posição.
            const brasil10Baseline = await loadPublishedRankingBaseline('BRASIL_10', strat);
            let brasil10Retention = null;
            let brasil10List = buildBrasil10(stockData.processedAssets, fiiData.processedAssets, {
                previous: brasil10Baseline,
                strategy: strat,
                onRetentionAudit: audit => { brasil10Retention = audit; },
            });
            brasil10List = await calculateRankingDelta(brasil10List, 'BRASIL_10', strat, brasil10Baseline);
            await saveAnalysis('BRASIL_10', brasil10List, brasil10List, brasil10Retention);

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
            const response = await ai.models.generateContent({ model: GEMINI_TEXT_MODEL, contents: prompt });
            return response.text;
        } catch { return "Análise IA indisponível."; }
    }
};
