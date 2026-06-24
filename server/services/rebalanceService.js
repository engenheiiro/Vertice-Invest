/**
 * Rebalanceamento IA (plano BLACK) — gera um PLANO de ordens (read-only) cruzando
 * a carteira real do usuário com a carteira-modelo do motor quant.
 *
 * Profundidade HÍBRIDA: as metas por classe (User.targetAllocation + targetReserve)
 * definem os baldes; dentro de cada balde os scores persistidos no MarketAnalysis
 * decidem o que REDUZIR (sobrealocado / AGUARDAR / baixa qualidade) e o que
 * COMPRAR/REFORÇAR (top picks do perfil escolhido). Sem chamada ao Gemini — as
 * justificativas vêm de score/action/bullThesis/bearThesis já calculados.
 *
 * Nada é persistido: o usuário executa as ordens na corretora dele.
 */

import UserAsset from '../models/UserAsset.js';
import User from '../models/User.js';
import MarketAnalysis from '../models/MarketAnalysis.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from './marketDataService.js';
import { countBusinessDays } from '../utils/dateUtils.js';
import { safeFloat, safeCurrency, safeDiv, safeValue, QUANTITY_EPSILON } from '../utils/mathUtils.js';
import {
    FI_SUB_KEYS, US_SUB_KEYS, SUB_LABELS,
    fixedIncomeSubKey, usSubKeyOf, hasSubMetas,
    currentValueBySub, splitNeedBySubMeta, subGaps,
} from '../utils/subAllocation.js';
import { BUY_THRESHOLD, CAPITAL_GAINS_TAX, DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';
import logger from '../config/logger.js';

// A classe ETF (Carteira Ideal) cobre só ETFs NACIONAIS; o ranking 'ETF' une nacionais +
// internacionais, então filtramos os nacionais aqui. ETFs internacionais e ouro lastreado
// são candidatos do Exterior (vêm do ranking STOCK_US, sub-tipo ETF). OURO permanece por
// compatibilidade (holdings legados, fora da UI) e não tem ranking/candidatos próprios.
const ENGINE_CLASSES = ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'ETF'];
const RISK_CLASSES = ['STOCK', 'FII', 'STOCK_US', 'ETF', 'CRYPTO', 'FIXED_INCOME', 'OURO'];
const ALL_CLASSES = [...RISK_CLASSES, 'CASH'];

const CLASS_LABELS = {
    STOCK: 'Ações BR',
    FII: 'FIIs',
    STOCK_US: 'Exterior',
    ETF: 'ETFs',
    CRYPTO: 'Cripto',
    FIXED_INCOME: 'Renda Fixa',
    OURO: 'Ouro',
    CASH: 'Reserva',
};

// Drift mínimo (em % do patrimônio) para uma classe ser considerada fora da meta.
// Evita gerar microvendas/microcompras por flutuação de mercado.
const MIN_GAP_PCT = 1;
// Quantos ativos no máximo entram do lado da compra por classe (não pulverizar).
const MAX_BUYS_PER_CLASS = 4;

const isDollarized = (asset) =>
    asset.currency === 'USD' || asset.type === 'STOCK_US' || asset.type === 'CRYPTO';

const tierFromScore = (score) => {
    if (score == null) return null;
    if (score >= 55) return 'GOLD';
    if (score >= 40) return 'SILVER';
    return 'BRONZE';
};

// ─────────────────────────────────────────────────────────────────────────────
// I/O — valuation da carteira (valor de mercado atual por ativo e por classe)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Espelha a matemática de valor atual de walletController.getWalletData (sem a
 * variação diária/TWRR, que o rebalance não usa). Retorna valores já em BRL.
 */
export const computeWalletValuation = async (userId) => {
    const userAssets = await UserAsset.find({ user: userId });
    const activeAssets = userAssets.filter((a) => a.quantity > QUANTITY_EPSILON);

    const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean();
    const usdRate = safeFloat(config?.dollar || 5.75);
    const currentCdi =
        config?.cdi > 0 ? safeFloat(config.cdi)
        : config?.selic > 0 ? safeFloat(config.selic)
        : DEFAULT_SELIC_FALLBACK;

    if (activeAssets.length === 0) {
        const valueByClass = Object.fromEntries(ALL_CLASSES.map((c) => [c, 0]));
        return { assets: [], totalEquity: 0, valueByClass, usdRate };
    }

    // Atualiza cotações dos voláteis (best-effort; não bloqueia o plano).
    const liveTickers = activeAssets
        .filter((a) => a.type !== 'FIXED_INCOME' && a.type !== 'CASH')
        .map((a) => a.ticker);
    if (liveTickers.length > 0) {
        // Best-effort: o plano segue com o cache atual se o refresh falhar — mas
        // logamos a falha em vez de silenciá-la.
        await marketDataService.refreshQuotesBatch(liveTickers)
            .catch(err => logger.warn(`[Rebalance] Refresh de cotações falhou: ${err.message}`));
    }

    // (5.8) Cotações em lote (1 query) em vez de um findOne por ativo (N+1).
    const marketMap = await marketDataService.getMarketDataMap(liveTickers);

    const valueByClass = Object.fromEntries(ALL_CLASSES.map((c) => [c, 0]));
    const assets = [];

    for (const asset of activeAssets) {
        const multiplier = isDollarized(asset) ? usdRate : 1;
        let priceNative = 0; // preço unitário na moeda nativa do ativo
        let valueNative = 0; // valor da posição na moeda nativa

        if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
            const { valueNative: v, unitPrice } = compoundFixedIncome(asset, currentCdi);
            valueNative = v;
            priceNative = unitPrice;
        } else {
            const mData = marketMap.get(asset.ticker);
            priceNative = safeFloat(mData?.price || 0);
            valueNative = safeValue(asset.quantity, priceNative);
        }

        const valueBr = safeCurrency(valueNative * multiplier);
        const priceBr = asset.quantity > 0 ? safeDiv(valueBr, asset.quantity) : 0;

        // Classe = type. ETFs internacionais (type STOCK_US) contam no Exterior; ETF
        // nacional (type 'ETF') é classe própria.
        valueByClass[asset.type] = safeCurrency((valueByClass[asset.type] || 0) + valueBr);

        assets.push({
            ticker: asset.ticker,
            type: asset.type,
            sector: asset.type === 'FIXED_INCOME' ? 'Renda Fixa' : asset.type === 'CASH' ? 'Caixa' : null,
            // Sub-tipos da ramificação (Carteira Ideal): permitem quebrar o gap da classe.
            fixedIncomeIndex: asset.fixedIncomeIndex || null,
            usSubType: asset.usSubType || null,
            quantity: asset.quantity,
            currency: asset.currency,
            valueBr,
            priceBr,
            priceNative,
            totalCostNative: safeFloat(asset.totalCost),
            taxLots: (asset.taxLots || []).map((l) => ({ date: l.date, quantity: l.quantity, price: l.price })),
            multiplier,
        });
    }

    const totalEquity = safeCurrency(Object.values(valueByClass).reduce((a, b) => a + b, 0));
    return { assets, totalEquity, valueByClass, usdRate };
};

// Juros compostos de RF/Caixa via lotes (mesma lógica de getWalletData, simplificada).
const compoundFixedIncome = (asset, currentCdi) => {
    const rawRate = asset.fixedIncomeRate > 0 ? asset.fixedIncomeRate : 100;
    const selicDailyFactor = Math.pow(1 + currentCdi / 100, 1 / 252);
    const effectiveDailyFactor =
        rawRate > 50 ? (selicDailyFactor - 1) * (rawRate / 100) + 1 : Math.pow(1 + rawRate / 100, 1 / 252);

    const calcDate = new Date();
    calcDate.setHours(0, 0, 0, 0);

    const factorFor = (date) => {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const days = countBusinessDays(start, calcDate);
        const f = Math.pow(effectiveDailyFactor, days);
        return !isFinite(f) || f < 1 ? 1 : f;
    };

    let valueNative = 0;
    let totalQty = 0;

    if (asset.taxLots && asset.taxLots.length > 0) {
        for (const lot of asset.taxLots) {
            const f = factorFor(lot.date);
            valueNative += asset.type === 'CASH' ? lot.quantity * f : lot.quantity * lot.price * f;
            totalQty += lot.quantity;
        }
    } else {
        const f = factorFor(asset.startDate || asset.createdAt);
        const avg = safeDiv(asset.totalCost, asset.quantity);
        valueNative = asset.type === 'CASH' ? asset.quantity * f : asset.quantity * avg * f;
        totalQty = asset.quantity;
    }

    const unitPrice = totalQty > 0 ? valueNative / totalQty : 1;
    return { valueNative, unitPrice };
};

// ─────────────────────────────────────────────────────────────────────────────
// I/O — dados do motor quant (scores + carteira-modelo do perfil escolhido)
// ─────────────────────────────────────────────────────────────────────────────

export const loadEngineData = async (riskProfile) => {
    const scoreByTicker = {};
    // OURO não tem MarketAnalysis própria — derivado do ranking STOCK_US (sub-tipo GOLD).
    const idealBuysByClass = Object.fromEntries([...ENGINE_CLASSES, 'OURO'].map((c) => [c, []]));
    const coveredClasses = [];
    let dataAsOf = null;

    for (const assetClass of ENGINE_CLASSES) {
        const analysis = await MarketAnalysis.findOne({
            assetClass,
            strategy: 'BUY_HOLD',
            isRankingPublished: true,
        })
            .sort({ createdAt: -1 })
            .select('content.ranking content.fullAuditLog createdAt')
            .lean();

        if (!analysis) continue;
        coveredClasses.push(assetClass);
        if (!dataAsOf || analysis.createdAt > dataAsOf) dataAsOf = analysis.createdAt;

        const full = analysis.content?.fullAuditLog?.length
            ? analysis.content.fullAuditLog
            : analysis.content?.ranking || [];
        for (const item of full) {
            // fullAuditLog guarda UM score por ticker (perfil atribuído/melhor) — suficiente
            // para sinalizar holdings AGUARDAR/baixa qualidade. Mantém o já visto (1º vence).
            if (!scoreByTicker[item.ticker]) {
                scoreByTicker[item.ticker] = {
                    score: item.score,
                    action: item.action,
                    bull: item.bullThesis || [],
                    bear: item.bearThesis || [],
                };
            }
        }

        const ranking = analysis.content?.ranking || [];
        const mapItem = (r) => ({
            ticker: r.ticker,
            name: r.name,
            sector: r.sector,
            type: r.type,
            usSubType: r.usSubType || null,
            score: r.score,
            currentPrice: r.currentPrice,
            targetPrice: r.targetPrice,
            bull: r.bullThesis || [],
        });
        const buys = ranking.filter((r) => r.riskProfile === riskProfile && r.action === 'BUY');

        if (assetClass === 'ETF') {
            // Classe ETF (Carteira Ideal) = só ETFs NACIONAIS (type 'ETF'). O ranking 'ETF'
            // une nacionais + internacionais; os internacionais (type STOCK_US) são
            // candidatos do Exterior, não desta classe.
            idealBuysByClass['ETF'] = buys.filter((r) => r.type === 'ETF').map(mapItem);
        } else {
            // Exterior (STOCK_US) inclui ações/REITs/ETFs internacionais/ouro lastreado do
            // seu próprio ranking. As demais classes mapeiam o ranking inteiro.
            idealBuysByClass[assetClass] = buys.map(mapItem);
        }
    }

    return { scoreByTicker, idealBuysByClass, coveredClasses, dataAsOf };
};

// ─────────────────────────────────────────────────────────────────────────────
// IR estimado (FIFO) sobre uma venda parcial
// ─────────────────────────────────────────────────────────────────────────────

export const estimateCapitalGainsTax = (asset, sellValueBr) => {
    const rate = CAPITAL_GAINS_TAX[asset.type] ?? 0;
    if (rate <= 0 || !asset.priceNative || asset.priceNative <= 0) return 0;

    const multiplier = asset.multiplier || 1;
    const unitsToSell = sellValueBr / multiplier / asset.priceNative;
    if (unitsToSell <= 0) return 0;

    const lots = [...(asset.taxLots || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    let gainNative = 0;
    let remaining = unitsToSell;

    if (lots.length === 0) {
        const avg = safeDiv(asset.totalCostNative, asset.quantity);
        gainNative = (asset.priceNative - avg) * unitsToSell;
    } else {
        for (const lot of lots) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, lot.quantity);
            gainNative += (asset.priceNative - lot.price) * take;
            remaining -= take;
        }
        // Lotes não cobriram tudo (split/migração antiga): resto pelo custo médio.
        if (remaining > 0) {
            const avg = safeDiv(asset.totalCostNative, asset.quantity);
            gainNative += (asset.priceNative - avg) * remaining;
        }
    }

    const gainBr = gainNative * multiplier;
    return Math.max(0, safeCurrency(gainBr * rate));
};

// ─────────────────────────────────────────────────────────────────────────────
// Núcleo PURO — recebe insumos já calculados e devolve o plano. Fácil de testar.
// ─────────────────────────────────────────────────────────────────────────────

export const buildRebalancePlan = ({
    valuation,
    targetAllocation,
    targetReserve,
    targetSubAllocation = {},
    scoreByTicker,
    idealBuysByClass,
    coveredClasses,
    riskProfile,
    dataAsOf = null,
    usdRate = 1,
}) => {
    const { assets, totalEquity, valueByClass } = valuation;
    const covered = new Set(coveredClasses || []);

    const emptyPlan = {
        riskProfile,
        dataAsOf,
        totalEquity,
        classGaps: [],
        sells: [],
        buys: [],
        coveredClasses: [...covered],
        summary: { totalSell: 0, totalBuy: 0, estTaxTotal: 0, tradeCount: 0 },
    };
    if (!totalEquity || totalEquity <= 0) return emptyPlan;

    // Enriquece holdings com score/teses do motor. A classe de cada holding é o próprio
    // `type` (ETF nacional é classe própria; ETFs internacionais têm type STOCK_US).
    const enriched = assets.map((a) => {
        const s = scoreByTicker[a.ticker];
        return {
            ...a,
            score: s?.score ?? null,
            action: s?.action ?? null,
            bull: s?.bull ?? [],
            bear: s?.bear ?? [],
        };
    });
    const heldTickers = new Set(enriched.map((a) => a.ticker));

    // --- Metas e gaps por classe ---
    // A reserva (CASH) é uma meta em VALOR fixo; o restante (investível) é distribuído
    // pelos percentuais de classe, igual ao Aporte Inteligente.
    const idealReserve = Math.min(targetReserve || 0, totalEquity);
    const investable = Math.max(0, totalEquity - idealReserve);
    const minGapValue = (MIN_GAP_PCT / 100) * totalEquity;

    const classGaps = ALL_CLASSES.map((cls) => {
        const currentValue = safeCurrency(valueByClass[cls] || 0);
        const idealValue =
            cls === 'CASH' ? safeCurrency(idealReserve) : safeCurrency(investable * ((targetAllocation[cls] || 0) / 100));
        return {
            class: cls,
            label: CLASS_LABELS[cls],
            currentValue,
            idealValue,
            currentPct: safeFloat((currentValue / totalEquity) * 100),
            targetPct: cls === 'CASH' ? safeFloat((idealValue / totalEquity) * 100) : safeFloat(targetAllocation[cls] || 0),
            gapValue: safeCurrency(idealValue - currentValue),
            coverage: cls === 'CASH' || cls === 'FIXED_INCOME' || covered.has(cls) ? 'full' : 'allocation-only',
        };
    });

    const sells = [];
    const buys = [];

    // --- LADO VENDA: classes acima da meta ---
    for (const gap of classGaps) {
        if (gap.gapValue >= -minGapValue) continue; // não está sobrealocada
        let excess = -gap.gapValue;

        // Holdings da classe ordenados por prioridade de corte: pior qualidade primeiro.
        // Sem score → 60 (neutro): cortado depois de scored ruins, antes de scored bons.
        // Desempate: trima a maior posição primeiro (reduz concentração).
        const holdings = enriched
            .filter((a) => a.type === gap.class)
            .sort((a, b) => {
                const sa = a.score ?? 60;
                const sb = b.score ?? 60;
                if (sa !== sb) return sa - sb;
                return b.valueBr - a.valueBr;
            });

        for (const h of holdings) {
            if (excess <= minGapValue) break;
            const amount = safeCurrency(Math.min(excess, h.valueBr));
            if (amount <= 0) continue;

            const quantity = h.priceBr > 0 ? safeFloat(amount / h.priceBr) : 0;
            const estTax = estimateCapitalGainsTax(h, amount);
            const isFull = amount >= h.valueBr - 0.01;

            const reasons = [];
            reasons.push(`${gap.label} ${gap.currentPct.toFixed(0)}% acima da meta de ${gap.targetPct.toFixed(0)}%`);
            if (h.score == null) {
                reasons.push('Sem cobertura quant — corte por alocação');
            } else if (h.action === 'WAIT' || h.score < BUY_THRESHOLD) {
                reasons.push(`Score ${Math.round(h.score)} (AGUARDAR)`);
                if (h.bear?.[0]) reasons.push(h.bear[0]);
            } else {
                reasons.push(`Reduzir excesso (mantém posição, score ${Math.round(h.score)})`);
            }

            // Rótulo de sub-tipo (ramificação) para RF/Exterior — espelha o lado compra.
            let subLabel = null;
            if (gap.class === 'FIXED_INCOME') subLabel = SUB_LABELS.FIXED_INCOME[fixedIncomeSubKey(h.fixedIncomeIndex)];
            else if (gap.class === 'STOCK_US') subLabel = SUB_LABELS.STOCK_US[usSubKeyOf(h.usSubType)];

            sells.push({
                ticker: h.ticker,
                class: h.type,
                type: h.type,
                subLabel,
                amount,
                quantity,
                positionValue: h.valueBr,
                isFullExit: isFull,
                score: h.score,
                action: h.action,
                estTax,
                reasons,
            });
            excess = safeCurrency(excess - amount);
        }
    }

    // --- LADO COMPRA: classes abaixo da meta ---
    for (const gap of classGaps) {
        if (gap.gapValue <= minGapValue) continue; // não está subalocada
        const need = gap.gapValue;

        // Reserva e Renda Fixa não têm ranking de tickers → sugestão genérica.
        if (gap.class === 'CASH' || gap.class === 'FIXED_INCOME') {
            // Ramificação: se a Renda Fixa tem sub-metas, quebra o aporte por sub-tipo
            // (IPCA / Pós-fixado / Prefixado) para o usuário saber quanto vai em cada um.
            let subBreakdown = null;
            if (gap.class === 'FIXED_INCOME' && hasSubMetas(targetSubAllocation.FIXED_INCOME)) {
                subBreakdown = splitNeedBySubMeta(need, targetSubAllocation.FIXED_INCOME, FI_SUB_KEYS)
                    .map((x) => ({ ...x, label: SUB_LABELS.FIXED_INCOME[x.sub] }));
            }
            buys.push({
                ticker: null,
                label: gap.label,
                class: gap.class,
                type: gap.class,
                kind: 'GENERIC',
                amount: safeCurrency(need),
                quantity: null,
                subBreakdown,
                reasons: [
                    `${gap.label} ${gap.currentPct.toFixed(0)}% abaixo da meta de ${gap.targetPct.toFixed(0)}%`,
                    gap.class === 'CASH' ? 'Reforçar reserva de emergência'
                        : subBreakdown ? 'Aportar em Renda Fixa por sub-meta (escolha os títulos)'
                        : 'Aportar em Renda Fixa (escolha o título)',
                ],
            });
            continue;
        }

        // Candidatos: (a) REFORÇO de holdings ainda BUY; (b) NOVOS top picks do perfil.
        const reinforce = enriched
            .filter((a) => a.type === gap.class && a.score != null && a.score >= BUY_THRESHOLD)
            .map((a) => ({
                ticker: a.ticker,
                kind: 'REINFORCE',
                score: a.score,
                priceBr: a.priceBr,
                bull: a.bull,
                usSubType: a.usSubType || null,
            }));

        // Exterior/Cripto/Ouro são dolarizados (preço do ranking em USD → converte). ETF
        // nacional e demais classes BRL não convertem.
        const usdClass = gap.class === 'STOCK_US' || gap.class === 'CRYPTO' || gap.class === 'OURO';
        const ideal = covered.has(gap.class) ? idealBuysByClass[gap.class] || [] : [];
        const news = ideal
            .filter((r) => !heldTickers.has(r.ticker))
            .map((r) => ({
                ticker: r.ticker,
                kind: 'NEW',
                score: r.score,
                priceBr: safeFloat((r.currentPrice || 0) * (usdClass ? usdRate : 1)),
                bull: r.bull,
                usSubType: r.usSubType || null,
            }));

        // Dedup (reforço tem prioridade), ordena por score desc, limita o nº de tickers.
        const seen = new Set();
        const candidates = [...reinforce, ...news]
            .filter((c) => {
                if (seen.has(c.ticker)) return false;
                seen.add(c.ticker);
                return true;
            })
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, MAX_BUYS_PER_CLASS);

        if (candidates.length === 0) {
            // Classe subalocada sem ranking disponível → aporte manual.
            buys.push({
                ticker: null,
                label: gap.label,
                class: gap.class,
                type: gap.class,
                kind: 'GENERIC',
                amount: safeCurrency(need),
                quantity: null,
                reasons: [
                    `${gap.label} ${gap.currentPct.toFixed(0)}% abaixo da meta de ${gap.targetPct.toFixed(0)}%`,
                    covered.has(gap.class) ? 'Sem recomendações de compra no ranking atual' : 'Sem ranking publicado para a classe',
                ],
            });
            continue;
        }

        // Ramificação do Exterior (Stocks/REITs/ETFs/Dólar): enviesa o peso de cada
        // candidato pelo sub-gap do seu sub-tipo — prioriza o mais defasado da meta. Sem
        // sub-metas (ou sem sub-gap positivo entre os candidatos) → só por score.
        let subWeightByTicker = null;
        if (gap.class === 'STOCK_US' && hasSubMetas(targetSubAllocation.STOCK_US)) {
            const currentBySub = currentValueBySub(enriched, 'STOCK_US');
            const gapsBySub = subGaps(gap.idealValue, currentBySub, targetSubAllocation.STOCK_US, US_SUB_KEYS);
            const biased = candidates.map((c) => (c.score ?? 0) * gapsBySub[usSubKeyOf(c.usSubType)]);
            if (biased.some((w) => w > 0)) {
                subWeightByTicker = new Map(candidates.map((c, i) => [c.ticker, biased[i]]));
            }
        }

        const weightOf = (c) => (subWeightByTicker ? subWeightByTicker.get(c.ticker) || 0 : (c.score ?? 0));
        const rawWeightSum = candidates.reduce((acc, c) => acc + weightOf(c), 0);
        // Sem pesos válidos (todos 0) → rateio igualitário; senão respeita o zero (sub-tipo no alvo).
        const weightSum = rawWeightSum > 0 ? rawWeightSum : candidates.length;
        for (const c of candidates) {
            const weight = rawWeightSum > 0 ? weightOf(c) / weightSum : 1 / candidates.length;
            const amount = safeCurrency(need * weight);
            if (amount <= 0) continue;
            const quantity = c.priceBr > 0 ? safeFloat(amount / c.priceBr) : null;

            const reasons = [];
            reasons.push(`${gap.label} ${gap.currentPct.toFixed(0)}% abaixo da meta de ${gap.targetPct.toFixed(0)}%`);
            const tier = tierFromScore(c.score);
            reasons.push(`${tier ? tier + ' · ' : ''}COMPRAR (score ${Math.round(c.score ?? 0)})`);
            if (gap.class === 'STOCK_US' && c.usSubType) reasons.push(`Reforça ${SUB_LABELS.STOCK_US[usSubKeyOf(c.usSubType)]} (sub-meta)`);
            if (c.bull?.[0]) reasons.push(c.bull[0]);

            buys.push({
                ticker: c.ticker,
                class: gap.class,
                type: gap.class,
                kind: c.kind,
                tier,
                subLabel: gap.class === 'STOCK_US' ? SUB_LABELS.STOCK_US[usSubKeyOf(c.usSubType)] : null,
                amount,
                quantity,
                score: c.score,
                reasons,
            });
        }
    }

    const totalSell = safeCurrency(sells.reduce((a, s) => a + s.amount, 0));
    const totalBuy = safeCurrency(buys.reduce((a, b) => a + b.amount, 0));
    const estTaxTotal = safeCurrency(sells.reduce((a, s) => a + (s.estTax || 0), 0));

    return {
        riskProfile,
        dataAsOf,
        totalEquity,
        classGaps,
        sells: sells.sort((a, b) => b.amount - a.amount),
        buys: buys.sort((a, b) => b.amount - a.amount),
        coveredClasses: [...covered],
        summary: { totalSell, totalBuy, estTaxTotal, tradeCount: sells.length + buys.length },
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// Orquestração
// ─────────────────────────────────────────────────────────────────────────────

export const rebalanceService = {
    buildRebalancePlan,
    computeWalletValuation,
    loadEngineData,
    estimateCapitalGainsTax,

    async generatePlan(userId, riskProfile = 'MODERATE') {
        const [valuation, prefs, engine] = await Promise.all([
            computeWalletValuation(userId),
            User.findById(userId).select('targetAllocation targetReserve targetSubAllocation').lean(),
            loadEngineData(riskProfile),
        ]);

        const targetAllocation = prefs?.targetAllocation || { STOCK: 40, FII: 30, STOCK_US: 20, CRYPTO: 10, FIXED_INCOME: 0 };
        const targetReserve = typeof prefs?.targetReserve === 'number' ? prefs.targetReserve : 10000;
        const targetSubAllocation = prefs?.targetSubAllocation || {};

        const plan = buildRebalancePlan({
            valuation,
            targetAllocation,
            targetReserve,
            targetSubAllocation,
            scoreByTicker: engine.scoreByTicker,
            idealBuysByClass: engine.idealBuysByClass,
            coveredClasses: engine.coveredClasses,
            riskProfile,
            dataAsOf: engine.dataAsOf,
            usdRate: valuation.usdRate,
        });

        logger.info(
            `[Rebalance] user ${userId} perfil ${riskProfile}: ${plan.sells.length} vendas / ${plan.buys.length} compras / IR est. R$${plan.summary.estTaxTotal}`,
        );
        return plan;
    },
};

export default rebalanceService;
