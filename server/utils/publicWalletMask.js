import { safeFloat, safeCurrency, safeMult, safeDiv } from './mathUtils.js';

/**
 * (C4) Máscara da carteira PÚBLICA.
 *
 * O link compartilhado renderiza a MESMA página Carteira do dono. Quando ele
 * mantém "Exibir valores em R$" desligado, não basta esconder os números na
 * tela: eles não podem sequer trafegar — a resposta da API é visível a qualquer
 * visitante. Então:
 *
 *  - todo campo monetário é NORMALIZADO por um fator único (patrimônio = 100),
 *    o que preserva exatamente pesos, proporções, formato das curvas e
 *    percentuais, sem carregar um único valor real;
 *  - quantidade e preços (unitário e médio) são zerados, porque quantidade ×
 *    preço reconstruiria o fator e, com ele, o patrimônio verdadeiro;
 *  - percentuais, datas, tickers e classificações passam intactos — são o que a
 *    página realmente mostra nesse modo (o front entra em modo privacidade e
 *    mascara todo R$ com ••••••).
 *
 * Com `showValues` ligado o fator é 1 e nada é alterado: o visitante vê os
 * mesmos números do dono.
 */

/** Fator único da resposta. `factor: 1` quando o dono liberou os valores. */
export const buildPublicScale = ({ showValues, totalEquity }) => {
    if (showValues) return { showValues: true, factor: 1 };
    const equity = safeFloat(totalEquity);
    // Sem patrimônio (carteira vazia) não há o que normalizar: tudo vira 0.
    return { showValues: false, factor: equity > 0 ? safeDiv(100, equity) : 0 };
};

/** Escala um monetário preservando `null`/`undefined` (≠ zero, ver KPI Sharpe). */
const money = (scale, value) => {
    if (value === null || value === undefined) return value;
    if (scale.factor === 1) return value;
    return safeCurrency(safeMult(safeFloat(value), scale.factor));
};

/** Zera o campo quando os valores estão ocultos (quantidade, preços). */
const hidden = (scale, value) => (scale.showValues ? value : 0);

export const maskAsset = (scale, asset) => {
    if (scale.showValues) return asset;
    return {
        ...asset,
        quantity: hidden(scale, asset.quantity),
        averagePrice: hidden(scale, asset.averagePrice),
        currentPrice: hidden(scale, asset.currentPrice),
        totalValue: money(scale, asset.totalValue),
        totalCost: money(scale, asset.totalCost),
        profit: money(scale, asset.profit),
        dividendsReceived: money(scale, asset.dividendsReceived),
        accruedValue: money(scale, asset.accruedValue),
    };
};

export const maskKpis = (scale, kpis = {}) => {
    if (scale.showValues) return kpis;
    return {
        ...kpis,
        totalEquity: money(scale, kpis.totalEquity),
        totalInvested: money(scale, kpis.totalInvested),
        totalResult: money(scale, kpis.totalResult),
        dayVariation: money(scale, kpis.dayVariation),
        totalDividends: money(scale, kpis.totalDividends),
        projectedDividends: money(scale, kpis.projectedDividends),
    };
};

/** GET /wallet — assets + kpis + meta. Metas da Carteira Ideal ficam de fora. */
export const maskWalletPayload = (scale, payload = {}) => ({
    assets: (payload.assets || []).map((a) => maskAsset(scale, a)),
    kpis: maskKpis(scale, payload.kpis || {}),
    meta: payload.meta,
});

/** Snapshots do histórico patrimonial (EvolutionChart). */
export const maskHistory = (scale, snapshots = []) => {
    if (scale.showValues) return snapshots;
    return snapshots.map((s) => ({
        ...s,
        totalEquity: money(scale, s.totalEquity),
        totalInvested: money(scale, s.totalInvested),
        totalDividends: money(scale, s.totalDividends),
        profit: money(scale, s.profit),
        // quotaPrice é a cota TWRR (base 100) — já é uma grandeza relativa.
    }));
};

/** Série de rentabilidade: % passa intacto; R$ (carteira e benchmarks) escala. */
export const maskPerformance = (scale, payload) => {
    if (scale.showValues || Array.isArray(payload)) return payload;
    return {
        ...payload,
        history: (payload?.history || []).map((p) => ({
            ...p,
            equity: money(scale, p.equity),
            invested: money(scale, p.invested),
            cdiValue: money(scale, p.cdiValue),
            ipcaValue: money(scale, p.ipcaValue),
            ibovValue: money(scale, p.ibovValue),
        })),
    };
};

export const maskDividends = (scale, payload = {}) => {
    if (scale.showValues) return payload;
    return {
        ...payload,
        history: (payload.history || []).map((h) => ({
            ...h,
            value: money(scale, h.value),
            breakdown: (h.breakdown || []).map((b) => ({ ...b, amount: money(scale, b.amount) })),
        })),
        provisioned: (payload.provisioned || []).map((p) => ({ ...p, amount: money(scale, p.amount) })),
        totalAllTime: money(scale, payload.totalAllTime),
        projectedMonthly: money(scale, payload.projectedMonthly),
        yieldOnCost: (payload.yieldOnCost || []).map((y) => ({
            ...y,
            receivedLast12Months: money(scale, y.receivedLast12Months),
            totalCost: money(scale, y.totalCost),
            // yocPercent é razão entre os dois — imune ao fator.
        })),
        goal: payload.goal
            ? { ...payload.goal, target: money(scale, payload.goal.target), current: money(scale, payload.goal.current) }
            : payload.goal,
    };
};

/** Extrato: preço e quantidade somem; só o valor normalizado da operação fica. */
export const maskCashFlow = (scale, payload = {}) => {
    if (scale.showValues) return payload;
    return {
        ...payload,
        transactions: (payload.transactions || []).map((t) => ({
            ...t,
            quantity: hidden(scale, t.quantity),
            price: hidden(scale, t.price),
            totalValue: money(scale, t.totalValue),
            fxRate: hidden(scale, t.fxRate),
        })),
    };
};
