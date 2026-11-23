// Preço justo (valor intrínseco) do scorer legado: Graham, Bazin, PEG reverso,
// VP de FII e a referência de mercado das classes sem fundamento de empresa.
// Saiu do scoringEngine sem mudar número: mesma aritmética, mesma ordem.
import {
    DEFAULT_NTNB_FALLBACK,
    BAZIN_MIN_YIELD,
    BAZIN_NTNB_PREMIUM,
} from '../../config/financialConstants.js';
import { resolvePapel } from './sectorRules.js';

const safeVal = (val) => {
    if (val === Infinity || val === -Infinity || isNaN(val) || val === null || val === undefined) return 0;
    return Number(val.toFixed(2));
};

const finish = ({ fairPrice, method }, grahamPrice = 0, bazinPrice = 0, pegRatio = null) => ({
    fairPrice: safeVal(fairPrice),
    method,
    grahamPrice: safeVal(grahamPrice),
    bazinPrice: safeVal(bazinPrice),
    pegRatio: pegRatio !== null ? safeVal(pegRatio) : null,
});

// Cesta/commodity/cripto: sem valor intrínseco de empresa — referência é o mercado.
const marketValuation = (price) => finish({ fairPrice: price, method: 'Mercado' });

// REIT é veículo de renda: preço justo por Bazin (dividendo / yield-alvo 6%).
const reitValuation = (m, price) => {
    let bazinPrice = 0;
    if (m.dy > 0) {
        const dividendPerShare = price * (Math.min(m.dy, 14) / 100);
        bazinPrice = dividendPerShare / 0.06;
    }
    const fairPrice = bazinPrice > 0 ? Math.min(bazinPrice, price * 2.5) : price;
    const method = bazinPrice > 0 ? 'Bazin (REIT)' : 'Mercado';
    return finish({ fairPrice, method }, 0, bazinPrice);
};

const grahamOf = (m, price) => {
    if (!(m.pl > 0 && m.pl < 80 && m.pvp > 0)) return 0;
    const lpa = price / m.pl;
    const vpa = price / m.pvp;
    return Math.sqrt(22.5 * lpa * vpa);
};

// Yield-alvo Bazin ancorado no macro — só para ação BR: max(6% clássico,
// NTN-B + prêmio). O 6% fixo inflava o preço justo de dividendeiras com
// Selic ~14%. STOCK_US mantém 6%: NTN-B é taxa real BR e não é âncora
// válida para ativos em dólar (ambiente de juros US ~4-5%).
const bazinYieldPctOf = (type, MACRO) => (type === 'STOCK'
    ? Math.max(BAZIN_MIN_YIELD, (MACRO.NTNB_LONG || DEFAULT_NTNB_FALLBACK) + BAZIN_NTNB_PREMIUM)
    : 6);

const bazinOf = (m, price, bazinYieldPct) => {
    if (!(m.dy > 0)) return 0;
    const adjustedDy = Math.min(m.dy, 14) / 100;
    const dividendPerShare = price * adjustedDy;
    return dividendPerShare / (bazinYieldPct / 100);
};

const blendGrahamBazin = (grahamPrice, bazinPrice, bazinYieldPct, price) => {
    if (grahamPrice > 0 && bazinPrice > 0) {
        return { fairPrice: (grahamPrice * 0.4) + (bazinPrice * 0.6), method: `Híbrido (Bazin ${bazinYieldPct.toFixed(1)}% + Graham)` };
    }
    if (grahamPrice > 0) return { fairPrice: grahamPrice, method: 'Graham' };
    if (bazinPrice > 0) return { fairPrice: bazinPrice, method: `Bazin (${bazinYieldPct.toFixed(1)}%)` };
    return { fairPrice: price, method: 'Mercado' };
};

// PEG reverso para STOCK_US: aplica método Lynch quando Graham e Bazin não produzem
// preço justo e o ativo está barato em relação ao crescimento (PEG < 1.0)
const applyPegReverso = (valuation, m, price) => {
    if (!(m.pl > 0 && m.pl < 80 && m.revenueGrowth > 10)) return valuation;
    const lpa = price / m.pl;
    const cappedGrowth = Math.min(m.revenueGrowth, 40);
    const pegReversoPrice = lpa * cappedGrowth; // Lynch: fair P/E = taxa de crescimento
    // somente se o ativo está subavaliado (PEG < 1)
    return pegReversoPrice > price ? { fairPrice: pegReversoPrice, method: 'PEG Reverso' } : valuation;
};

const stockValuation = (m, type, price, MACRO) => {
    const grahamPrice = grahamOf(m, price);
    const bazinYieldPct = bazinYieldPctOf(type, MACRO);
    const bazinPrice = bazinOf(m, price, bazinYieldPct);
    const pegRatio = (m.pl > 0 && m.revenueGrowth > 0) ? m.pl / m.revenueGrowth : null;
    let valuation = blendGrahamBazin(grahamPrice, bazinPrice, bazinYieldPct, price);
    if (type === 'STOCK_US' && grahamPrice === 0 && bazinPrice === 0) valuation = applyPegReverso(valuation, m, price);
    if (valuation.fairPrice > price * 2.5) valuation = { ...valuation, fairPrice: price * 2.5 };
    return finish(valuation, grahamPrice, bazinPrice, pegRatio);
};

// vpCota persiste no MarketAsset; o fallback por P/VP (mesma fórmula: price/pvp)
// continua valendo para documentos antigos e para FIIs cuja fonte não publica o
// valor patrimonial. Sem ele o VP colapsava para o próprio preço (upside ~0).
// fiiSubType (explícito) ou sector como fallback decide se é FII de papel.
const fiiValuation = (m, price, MACRO) => {
    const vp = m.vpCota || (m.pvp > 0 ? price / m.pvp : price);
    if (resolvePapel(m.fiiSubType, m.sector)) return finish({ fairPrice: vp, method: 'VP (Papel)' });
    const ntnb = MACRO.NTNB_LONG || DEFAULT_NTNB_FALLBACK;
    const yieldPremium = Math.max(0, m.dy - ntnb);
    return finish({ fairPrice: vp * (1 + (yieldPremium / 100)), method: 'VP Ajustado' });
};

// Exterior não-ação (ETF/REIT/Ouro): não cabe Graham/Bazin de empresa. ETF nacional
// (classe própria) e cripto: referência é o mercado.
export const calculateIntrinsicValue = (m, type, price, context, usSubType = null) => {
    const { MACRO } = context;
    const usSub = type === 'STOCK_US' ? (usSubType || 'STOCK') : null;
    if (usSub === 'REIT') return reitValuation(m, price);
    if (usSub === 'ETF' || usSub === 'GOLD') return marketValuation(price);
    if (type === 'STOCK' || type === 'STOCK_US') return stockValuation(m, type, price, MACRO);
    if (type === 'FII') return fiiValuation(m, price, MACRO);
    return marketValuation(price);
};
