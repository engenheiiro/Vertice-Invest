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

/**
 * Fração mínima negociável no Tesouro Direto: 1% do título (0,01 título).
 * "Investimento mínimo" e "preço unitário" são coisas diferentes por duas ordens
 * de grandeza — R$ 30 contra R$ 3.000 num IPCA+ 2032.
 */
const MIN_FRACTION = 0.01;

/**
 * Piso do programa: 1% de um título barato dá menos que isso (o Prefixado 2032,
 * com PU de R$ 485,54, daria R$ 4,86), mas a plataforma não aceita compra abaixo
 * de R$ 30. Sem o piso, a coluna diria que dá para começar com R$ 4,86 numa
 * ordem que seria recusada — e errar para baixo, nesta coluna, é pior que errar
 * para cima.
 */
const MIN_FLOOR = 30;

// Acima disto o "mínimo" não é mínimo: é o próprio PU (ou outra coluna) que veio
// parar no campo errado. Folga generosa — o mínimo real é 1% do PU.
const MIN_PLAUSIBLE_CEILING = 0.05;

/**
 * Investimento mínimo do título, saneado.
 *
 * O raspador coleta os valores monetários da linha e, quando encontra UM só,
 * atribui o mesmo número ao mínimo e ao PU (`macroDataService`). O resultado é a
 * aba Indicadores anunciando "Investimento Mín. R$ 3.002,69" num título cujo
 * mínimo é R$ 30,03 — dois zeros de diferença, na coluna que existe justamente
 * para dizer com quanto dá para começar.
 *
 * Quando o valor raspado não é plausível como mínimo, ele é derivado do PU. Sem
 * PU não há o que derivar: devolve 0 e a tela mostra o vazio em vez de um número
 * inventado.
 *
 * O piso nunca ultrapassa o PU: num título mais barato que R$ 30 (o "Tesouro
 * Reserva 2036" tem PU de R$ 10,93), o piso mandaria a tela pedir R$ 30,00 para
 * comprar algo que custa R$ 10,93 inteiro.
 */
export const resolveMinInvestment = (minInvestment, unitPrice) => {
    const min = num(minInvestment);
    const pu = num(unitPrice);
    if (pu <= 0) return min;
    if (min > 0 && min <= pu * MIN_PLAUSIBLE_CEILING) return min;
    return round2(Math.min(Math.max(pu * MIN_FRACTION, MIN_FLOOR), pu));
};

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
            _id: b._id,
            title: b.title,
            type,
            index: b.index || (isIpcaLinked(type) ? 'IPCA' : type === 'SELIC' ? 'SELIC' : 'PRE'),
            rate,
            maturityDate: b.maturityDate || null,
            minInvestment: resolveMinInvestment(b.minInvestment, b.unitPrice),
            unitPrice: num(b.unitPrice),
            nominalEstimate: round2(nominalEstimate),
            realEstimate: round2(realEstimate),
            vsCdi: vsCdi === null ? null : round2(vsCdi),
        };
    });
};

export default normalizeTreasuryBonds;
