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
 */

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Number(n.toFixed(2));

export const normalizeTreasuryBonds = (bonds = [], macro = {}) => {
    const ipca = num(macro.ipca);
    const selic = num(macro.selic);
    const cdi = num(macro.cdi) > 0 ? num(macro.cdi) : selic;

    return (bonds || []).map((b) => {
        const rate = num(b.rate);
        const type = b.type || 'IPCA';

        let nominalEstimate;
        if (type === 'IPCA' || type === 'RENDAMAIS' || type === 'EDUCA') nominalEstimate = rate + ipca;
        else if (type === 'SELIC') nominalEstimate = selic + rate;
        else nominalEstimate = rate; // PREFIXADO

        const realEstimate = nominalEstimate - ipca;
        const vsCdi = cdi > 0 ? nominalEstimate - cdi : null;

        return {
            title: b.title,
            type,
            index: b.index || ((type === 'IPCA' || type === 'RENDAMAIS' || type === 'EDUCA') ? 'IPCA' : type === 'SELIC' ? 'SELIC' : 'PRE'),
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
