// Lado COMPRA do Rebalanceamento IA (núcleo puro de buildRebalancePlan, em
// rebalanceService.js): para cada classe abaixo da meta, sugestão genérica
// (Reserva/RF/sem ranking) ou candidatos — reforço de holdings BUY + novos top
// picks do perfil — com peso por score, enviesado pelo sub-gap do sub-tipo.
import { safeFloat, safeCurrency } from '../utils/mathUtils.js';
import {
    STOCK_SUB_KEYS, FI_SUB_KEYS, US_SUB_KEYS, SUB_LABELS,
    usSubKeyOf, stockSubKeyOf, hasSubMetas, currentValueBySub, splitNeedBySubMeta, subGaps,
} from '../utils/subAllocation.js';
import { BUY_THRESHOLD } from '../config/financialConstants.js';

// Quantos ativos no máximo entram do lado da compra por classe (não pulverizar).
const MAX_BUYS_PER_CLASS = 4;

const tierFromScore = (score) => {
    if (score == null) return null;
    if (score >= 55) return 'GOLD';
    if (score >= 40) return 'SILVER';
    return 'BRONZE';
};

export const gapHeadline = (gap, side) => `${gap.label} ${gap.currentPct.toFixed(0)}% ${side} da meta de ${gap.targetPct.toFixed(0)}%`;

// Reserva e Renda Fixa não têm ranking de tickers → sugestão genérica. Se a Renda
// Fixa tem sub-metas, quebra o aporte por sub-tipo (IPCA / Pós-fixado / Prefixado)
// para o usuário saber quanto vai em cada um.
const genericReserveOrFixedBuy = (gap, need, targetSubAllocation) => {
    let subBreakdown = null;
    if (gap.class === 'FIXED_INCOME' && hasSubMetas(targetSubAllocation.FIXED_INCOME)) {
        subBreakdown = splitNeedBySubMeta(need, targetSubAllocation.FIXED_INCOME, FI_SUB_KEYS)
            .map((x) => ({ ...x, label: SUB_LABELS.FIXED_INCOME[x.sub] }));
    }
    let hint = 'Aportar em Renda Fixa (escolha o título)';
    if (gap.class === 'CASH') hint = 'Reforçar reserva de emergência';
    else if (subBreakdown) hint = 'Aportar em Renda Fixa por sub-meta (escolha os títulos)';
    return {
        ticker: null,
        label: gap.label,
        class: gap.class,
        type: gap.class,
        kind: 'GENERIC',
        amount: safeCurrency(need),
        quantity: null,
        subBreakdown,
        reasons: [gapHeadline(gap, 'abaixo'), hint],
    };
};

// Fontes de NOVOS candidatos da classe. Ações BR também recebe candidatos do
// ranking de ETFs NACIONAIS (sub-tipo ETF).
const idealSourcesFor = (gapClass, covered, idealBuysByClass) => {
    if (gapClass === 'STOCK') {
        return [...(covered.has('STOCK') ? idealBuysByClass.STOCK || [] : []),
            ...(covered.has('ETF') ? idealBuysByClass.ETF || [] : [])];
    }
    if (gapClass === 'STOCK_US') {
        return (covered.has('STOCK_US') || covered.has('ETF')) ? idealBuysByClass.STOCK_US || [] : [];
    }
    return covered.has(gapClass) ? idealBuysByClass[gapClass] || [] : [];
};

const toNewCandidate = (r, usdClass, usdRate) => ({
    ticker: r.ticker,
    kind: 'NEW',
    score: r.score,
    priceBr: safeFloat((r.currentPrice || 0) * (usdClass && r.currency !== 'BRL' ? usdRate : 1)),
    bull: r.bull,
    usSubType: r.usSubType || null,
    rawType: r.type,
    currency: r.currency || null,
});

// Candidatos: (a) REFORÇO de holdings ainda BUY; (b) NOVOS top picks do perfil.
// Dedup (reforço tem prioridade), ordena por score desc, limita o nº de tickers.
const buyCandidatesFor = (gapClass, { enriched, heldTickers, covered, idealBuysByClass, usdRate }) => {
    const reinforce = enriched
        .filter((a) => a.type === gapClass && a.score != null && a.score >= BUY_THRESHOLD)
        .map((a) => ({
            ticker: a.ticker,
            kind: 'REINFORCE',
            score: a.score,
            priceBr: a.priceBr,
            bull: a.bull,
            usSubType: a.usSubType || null,
            rawType: a.rawType ?? a.type,
        }));
    // Exterior/Cripto/Ouro normalmente são dolarizados, mas ETFs locais de
    // exposição internacional (IVVB11 etc.) já chegam cotados em BRL.
    const usdClass = gapClass === 'STOCK_US' || gapClass === 'CRYPTO' || gapClass === 'OURO';
    const news = idealSourcesFor(gapClass, covered, idealBuysByClass)
        .filter((r) => !heldTickers.has(r.ticker))
        .map((r) => toNewCandidate(r, usdClass, usdRate));

    const seen = new Set();
    return [...reinforce, ...news]
        .filter((c) => {
            if (seen.has(c.ticker)) return false;
            seen.add(c.ticker);
            return true;
        })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, MAX_BUYS_PER_CLASS);
};

// Ramificação de Ações BR (Ações/ETFs) e do Exterior (Stocks/REITs/ETFs/Dólar):
// enviesa o peso de cada candidato pelo sub-gap do seu sub-tipo — prioriza o mais
// defasado da meta. Sem sub-metas (ou sem sub-gap positivo) → null (só por score).
const subWeightsFor = (gap, candidates, enriched, targetSubAllocation) => {
    let subCfg = null;
    if (gap.class === 'STOCK_US') subCfg = { keys: US_SUB_KEYS, metas: targetSubAllocation.STOCK_US, subKeyOf: (c) => usSubKeyOf(c.usSubType) };
    else if (gap.class === 'STOCK') subCfg = { keys: STOCK_SUB_KEYS, metas: targetSubAllocation.STOCK, subKeyOf: (c) => stockSubKeyOf(c.rawType) };
    if (!subCfg || !hasSubMetas(subCfg.metas)) return null;
    const currentBySub = currentValueBySub(enriched, gap.class);
    const gapsBySub = subGaps(gap.idealValue, currentBySub, subCfg.metas, subCfg.keys);
    const biased = candidates.map((c) => (c.score ?? 0) * gapsBySub[subCfg.subKeyOf(c)]);
    if (!biased.some((w) => w > 0)) return null;
    return new Map(candidates.map((c, i) => [c.ticker, biased[i]]));
};

const isStockEtf = (gapClass, c) => gapClass === 'STOCK' && stockSubKeyOf(c.rawType) === 'ETF';

const buyReasons = (gap, c, tier) => {
    const reasons = [gapHeadline(gap, 'abaixo')];
    reasons.push(`${tier ? tier + ' · ' : ''}COMPRAR (score ${Math.round(c.score ?? 0)})`);
    if (gap.class === 'STOCK_US' && c.usSubType) reasons.push(`Reforça ${SUB_LABELS.STOCK_US[usSubKeyOf(c.usSubType)]} (sub-meta)`);
    else if (isStockEtf(gap.class, c)) reasons.push(`Reforça ${SUB_LABELS.STOCK.ETF} (sub-meta)`);
    if (c.bull?.[0]) reasons.push(c.bull[0]);
    return reasons;
};

const buySubLabel = (gapClass, c) => {
    if (gapClass === 'STOCK_US') return SUB_LABELS.STOCK_US[usSubKeyOf(c.usSubType)];
    return isStockEtf(gapClass, c) ? SUB_LABELS.STOCK.ETF : null;
};

export const planBuysForGap = (gap, ctx, buys) => {
    const need = gap.gapValue;
    if (gap.class === 'CASH' || gap.class === 'FIXED_INCOME') {
        buys.push(genericReserveOrFixedBuy(gap, need, ctx.targetSubAllocation));
        return;
    }

    const candidates = buyCandidatesFor(gap.class, ctx);
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
                gapHeadline(gap, 'abaixo'),
                ctx.covered.has(gap.class) ? 'Sem recomendações de compra no ranking atual' : 'Sem ranking publicado para a classe',
            ],
        });
        return;
    }

    const subWeightByTicker = subWeightsFor(gap, candidates, ctx.enriched, ctx.targetSubAllocation);
    const weightOf = (c) => (subWeightByTicker ? subWeightByTicker.get(c.ticker) || 0 : (c.score ?? 0));
    const rawWeightSum = candidates.reduce((acc, c) => acc + weightOf(c), 0);
    // Sem pesos válidos (todos 0) → rateio igualitário; senão respeita o zero (sub-tipo no alvo).
    const weightSum = rawWeightSum > 0 ? rawWeightSum : candidates.length;
    for (const c of candidates) {
        const weight = rawWeightSum > 0 ? weightOf(c) / weightSum : 1 / candidates.length;
        const amount = safeCurrency(need * weight);
        if (amount <= 0) continue;
        const quantity = c.priceBr > 0 ? safeFloat(amount / c.priceBr) : null;
        const tier = tierFromScore(c.score);
        const reasons = buyReasons(gap, c, tier);

        buys.push({
            ticker: c.ticker,
            class: gap.class,
            type: gap.class,
            kind: c.kind,
            tier,
            subLabel: buySubLabel(gap.class, c),
            amount,
            quantity,
            score: c.score,
            reasons,
        });
    }
};
