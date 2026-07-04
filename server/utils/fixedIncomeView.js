/**
 * Normalização (PURA) da vitrine de Renda Fixa do Tesouro Direto.
 *
 * Renda fixa NÃO é ranking competitivo (não se pontua um título contra outro como
 * ação/FII). Aqui apenas estimamos, a partir da taxa contratada e do macro atual,
 * o rendimento nominal anual, o ganho real (acima da inflação) e a comparação vs CDI.
 *
 * Estimativa de rendimento NOMINAL por tipo:
 *  - IPCA+ (e RENDAMAIS/EDUCA): cupom real contratado + IPCA projetado
 *  - SELIC: Selic + ágio/deságio (o campo `rate` costuma ser o spread, ~0)
 *  - PREFIXADO: a própria taxa contratada já é nominal
 *
 * Saneamento da contaminação NOMINAL: o raspador do Investidor10 passou a devolver,
 * para títulos IPCA-indexados, o retorno NOMINAL projetado (cupom real ⊕ IPCA, ex.:
 * 7,3% ⊕ 4,7% ≈ 12,4%) no lugar do cupom REAL contratado. Um cupom real acima de
 * ~10% a.a. nunca existiu em NTN-B/Educa+/Renda+; quando o `rate` de um título
 * IPCA-indexado ultrapassa esse teto, ele é a contaminação nominal e o cupom real é
 * recuperado subtraindo o IPCA (modelo aditivo do app: nominal ≈ real + IPCA). Isso
 * é espelho da guarda `isPlausibleNtnbRate` do scoring (macroDataService).
 */

// Cupom real contratado plausível em títulos IPCA-indexados fica bem abaixo disso.
const REAL_COUPON_CEILING = 10;

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Number(n.toFixed(2));

const isIpcaLinked = (type) => type === 'IPCA' || type === 'RENDAMAIS' || type === 'EDUCA';

// Recupera o cupom REAL quando o valor persistido é, na verdade, o nominal (real+IPCA).
const effectiveRealCoupon = (rate, type, ipca) => {
    if (isIpcaLinked(type) && ipca > 0 && rate > REAL_COUPON_CEILING) {
        const real = rate - ipca;
        return real > 0 ? round2(real) : rate;
    }
    return rate;
};

export const normalizeTreasuryBonds = (bonds = [], macro = {}) => {
    const ipca = num(macro.ipca);
    const selic = num(macro.selic);
    const cdi = num(macro.cdi) > 0 ? num(macro.cdi) : selic;

    return (bonds || []).map((b) => {
        const type = b.type || 'IPCA';
        const rate = effectiveRealCoupon(num(b.rate), type, ipca);

        let nominalEstimate;
        if (isIpcaLinked(type)) nominalEstimate = rate + ipca;
        else if (type === 'SELIC') nominalEstimate = selic + rate;
        else nominalEstimate = rate; // PREFIXADO

        const realEstimate = nominalEstimate - ipca;
        const vsCdi = cdi > 0 ? nominalEstimate - cdi : null;

        return {
            title: b.title,
            type,
            index: b.index || (isIpcaLinked(type) ? 'IPCA' : type === 'SELIC' ? 'SELIC' : 'PRE'),
            rate,
            maturityDate: b.maturityDate || null,
            minInvestment: num(b.minInvestment),
            unitPrice: num(b.unitPrice),
            nominalEstimate: round2(nominalEstimate),
            realEstimate: round2(realEstimate),
            vsCdi: vsCdi === null ? null : round2(vsCdi),
        };
    });
};

export default normalizeTreasuryBonds;
