import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

// Caracterização do scoringEngine.processAsset gravada ANTES de decompor
// calculateIntrinsicValue, generateDynamicTheses, calculateProfileScores,
// calculateConfidenceScore e scoreCryptoProfiles. Uma grade determinística de
// ativos (STOCK, FII, STOCK_US e sub-tipos, ETF nacional e temas, CRYPTO) com
// métricas ausentes, zeradas, negativas e extremas passa pelo export público, e a
// saída INTEIRA (scores, valuation, métricas, teses e auditLog) é congelada:
// qualquer diferença de número, texto ou ordem quebra o teste.

// Gerador determinístico (mulberry32): a grade é a mesma em toda máquina.
const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (r, list) => list[Math.floor(r() * list.length)];

const TYPES = ['STOCK', 'STOCK', 'STOCK', 'FII', 'FII', 'STOCK_US', 'STOCK_US', 'ETF', 'CRYPTO', 'CRYPTO'];
const US_SUB = [undefined, 'STOCK', 'ETF', 'REIT', 'GOLD'];
const STOCK_SECTORS = ['Bancos', 'Seguradoras', 'Holding Financeira', 'Energia Elétrica', 'Saneamento',
    'Varejo', 'Mineração', 'Petróleo', 'Tecnologia', 'Corretagem de Seguros', 'Holding', 'Financials',
    'Consumer Staples', 'Utilities', 'Insurance', 'Technology', undefined];
const FII_SUB = [['TIJOLO', 'Logística'], ['PAPEL', 'Papel'], [null, 'Recebíveis'], [null, 'Shoppings'], ['HIBRIDO', 'Híbrido'], [undefined, undefined]];
const ETF_SECTORS = ['Cripto', 'Crypto Assets', 'Ouro', 'Gold', 'Renda Fixa', 'Índice Amplo', 'Exterior', undefined];
const TICKERS = {
    STOCK: ['CASE3', 'PETR4', 'ITSA4', 'BBSE3', 'WIZC3', 'TAEE11'],
    FII: ['CASE11'], STOCK_US: ['CASEU'], ETF: ['CASE11'],
    CRYPTO: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'USDT', 'PEPE'],
};
const ARCHETYPES = [undefined, undefined, undefined, 'BANK', 'INSURER', 'OIL_GAS_PRODUCER', 'DIVERSIFIED_HOLDING', 'BOGUS'];

const NUM = {
    pl: [undefined, null, -5, 0, 3, 6, 9.9, 10, 15, 25, 79, 80, 120],
    pvp: [undefined, null, -1, 0, 0.5, 0.84, 0.85, 1, 1.05, 1.06, 2.5, 8],
    dy: [undefined, null, -2, 0, 1, 1.5, 2, 3, 3.5, 4, 5, 6, 7.5, 8, 9.2, 12, 14, 18, 25, 60],
    roe: [undefined, null, -10, 0, 4.9, 5, 12, 12.5, 18, 18.1, 30, 120],
    netMargin: [undefined, null, -20, 0, 8, 8.5, 10, 10.5, 25, 101, 250],
    revenueGrowth: [undefined, null, -30, 0, 3, 5, 5.5, 10, 10.5, 11, 25, 40, 90],
    payout: [undefined, 0, 20, 21, 50, 89, 90, 150],
    debtToEquity: [undefined, null, -1, 0, 0.5, 1, 1.5, 2, 2.1, 4, 4.5, 12],
    beta: [undefined, -0.3, 0, 0.5, 0.69, 0.7, 1, 1.1, 1.2, 1.49, 1.5, 2.4],
    volatility: [undefined, null, 0, 10, 11.9, 15, 17.9, 19, 22, 30, 36, 45, 55, 72, 101, 180],
    vacancy: [undefined, 0, 2.9, 3, 8, 12, 12.1, 30],
    qtdImoveis: [undefined, 0, 1, 2, 5, 12, 40],
    vpCota: [undefined, undefined, 0, 80, 100, 130],
    staleDays: [undefined, null, 0, 30, 90, 91, 180, 181, 400],
    smaFactor: [undefined, 0, 0.5, 0.69, 0.75, 0.88, 0.95, 1, 1.05, 1.12, 1.2, 1.4, 1.5],
};
const SCALE = {
    STOCK: { cap: [undefined, 0, 2e8, 9.9e8, 1e9, 5e9, 8e10], liq: [1e5, 2e5, 3e5, 4.99e5, 6e5, 9.99e5, 1e6, 5e6, 3e7, 2.5e8] },
    FII: { cap: [undefined, 0, 3e8, 5e8, 9e8, 3e9], liq: [3e5, 5e5, 6e5, 9e5, 1e6, 2e6, 8e6] },
    STOCK_US: { cap: [0, 5e8, 1e9, 2e10, 3e12], liq: [1e5, 2e5, 4e5, 9e5, 1e6, 6e6, 2.1e7, 6e7, 2.5e8] },
    ETF: { cap: [0, 1e8], liq: [0, 0, 5e5, 9e5, 1e6, 4e6, 6e6, 2.1e7, 6e7] },
    CRYPTO: { cap: [undefined, 0, 5e7, 1.5e8, 1e9, 1.9e9, 2e9, 2.1e9, 5e9, 2e10, 2.1e10, 3e11],
        liq: [0, 1e5, 2e6, 3e7, 4.9e7, 5e7, 1e8, 9e8, 1e9, 1.1e9, 3e9, 5e9, 2e10] },
};
const PRICES = [0.004, 0.01, 0.02, 0.5, 10, 37.31, 250];

const buildMissing = (r) => {
    const roll = r();
    if (roll < 0.2) return undefined;
    const flag = () => pick(r, [true, false, false, undefined]);
    return { roe: flag(), netMargin: flag(), revenueGrowth: flag(), marketCap: flag(), beta: flag() };
};

const buildTypeFields = (r, type) => {
    if (type === 'STOCK' || type === 'STOCK_US') {
        return { sector: pick(r, STOCK_SECTORS), usSubType: type === 'STOCK_US' ? pick(r, US_SUB) : undefined,
            stockArchetype: type === 'STOCK' ? pick(r, ARCHETYPES) : undefined };
    }
    if (type === 'FII') {
        const [fiiSubType, sector] = pick(r, FII_SUB);
        return { sector, fiiSubType };
    }
    if (type === 'ETF') return { sector: pick(r, ETF_SECTORS) };
    return { sector: pick(r, ['Layer 1', 'DeFi', undefined]) };
};

const buildMetrics = (r, type, price, extra) => {
    const smaFactor = pick(r, NUM.smaFactor);
    const staleDays = pick(r, NUM.staleDays);
    const metrics = {
        price,
        pl: pick(r, NUM.pl), pvp: pick(r, NUM.pvp), dy: pick(r, NUM.dy), roe: pick(r, NUM.roe),
        netMargin: pick(r, NUM.netMargin), revenueGrowth: pick(r, NUM.revenueGrowth),
        payout: pick(r, NUM.payout), debtToEquity: pick(r, NUM.debtToEquity), beta: pick(r, NUM.beta),
        volatility: pick(r, NUM.volatility), vacancy: pick(r, NUM.vacancy), qtdImoveis: pick(r, NUM.qtdImoveis),
        vpCota: pick(r, NUM.vpCota), marketCap: pick(r, SCALE[type].cap), avgLiquidity: pick(r, SCALE[type].liq),
        sma200: smaFactor === undefined ? undefined : price * smaFactor,
        evEbitda: pick(r, [undefined, 0, 4, 9, 25]),
        sector: extra.sector, fiiSubType: extra.fiiSubType,
        _missing: buildMissing(r),
    };
    if (staleDays !== undefined) metrics._staleDays = staleDays;
    if (r() < 0.25) metrics.trackRecord = { dividendConsistency: pick(r, [0.5, 0.8, 0.95]) };
    return metrics;
};

const buildContext = (r) => {
    const MACRO = {
        SELIC: pick(r, [10.5, 13.75, 15]), IPCA: pick(r, [4.2, 5.1]), RISK_FREE: pick(r, [10.5, 13.75]),
    };
    const ntnb = pick(r, [undefined, 0, 5.8, 6.4, 7.2, 8.1]);
    if (ntnb !== undefined) MACRO.NTNB_LONG = ntnb;
    if (r() < 0.2) MACRO.RATES_STALE = true;
    return { MACRO };
};

const buildCase = (r, i, forcedType) => {
    const type = forcedType || pick(r, TYPES);
    const price = pick(r, PRICES);
    const extra = buildTypeFields(r, type);
    const asset = {
        ticker: pick(r, TICKERS[type]), type, name: pick(r, [`Caso ${i}`, 'BB Seguridade', 'Holding Financeira X']),
        price, ...extra,
        allocationClass: pick(r, [undefined, 'RV']), currency: pick(r, [undefined, 'BRL', 'USD']),
        dbFlags: r() < 0.04 ? { isBlacklisted: true } : { isBlacklisted: false, isTier1: r() < 0.3 },
        metrics: buildMetrics(r, type, price, extra),
    };
    if (r() < 0.2) asset.sectorMetrics = { roeTtm: pick(r, [null, 8, 13.5, 22]) };
    return { asset, context: buildContext(r) };
};

// Ação US sem Graham nem Bazin (P/VP e DY inválidos): é onde o PEG reverso decide.
const buildPegCase = (r, i) => {
    const base = buildCase(r, i, 'STOCK_US');
    base.asset.usSubType = pick(r, [undefined, 'STOCK']);
    base.asset.price = pick(r, [10, 37.31]);
    Object.assign(base.asset.metrics, {
        pvp: pick(r, [undefined, 0, -1]), dy: pick(r, [undefined, 0, -2]),
        pl: pick(r, [0, 3, 6, 9.9, 10, 10.5, 11, 15, 79, 80]), revenueGrowth: pick(r, [10, 10.5, 11, 12, 25, 40, 55]),
        avgLiquidity: pick(r, [6e6, 2.5e8]),
    });
    return base;
};

// Serialização canônica: chaves ordenadas; -0, NaN, ±Infinity, undefined e Date visíveis.
const canon = (value) => {
    if (typeof value === 'number') {
        if (Object.is(value, -0)) return '"-0"';
        return Number.isFinite(value) ? String(value) : `"${String(value)}"`;
    }
    if (value === undefined) return '"undefined"';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (value instanceof Date) return `"Date(${value.toISOString()})"`;
    if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
};

const runCase = ({ asset, context }) => {
    try {
        return canon(scoringEngine.processAsset(asset, context));
    } catch (error) {
        return canon({ threw: String(error && error.message) });
    }
};

const CASES = (() => {
    const r = rng(20261123);
    const general = Array.from({ length: 3000 }, (_, i) => buildCase(r, i));
    const peg = Array.from({ length: 200 }, (_, i) => buildPegCase(r, 3000 + i));
    return general.concat(peg);
})();

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

describe('scoringEngine.processAsset — caracterização antes da decomposição', () => {
    const outputs = CASES.map(runCase);

    it('cada cenário produz a mesma saída (hash por cenário)', () => {
        expect(outputs.map(hash)).toMatchSnapshot();
    });

    it('a grade passa pelos ramos de valuation, teses, confiança e perfis (cobertura)', () => {
        const parsed = outputs.map(o => JSON.parse(o));
        const shape = text => String(text).replace(/[-+]?\d+(\.\d+)?/g, '#');
        const seen = new Set();
        for (const o of parsed) {
            if (o.threw) seen.add(`threw|${o.threw}`);
            if (o._discarded) seen.add(`discard|${o.reason}`);
            if (o.metrics) seen.add(`method|${shape(o.metrics.method)}`);
            for (const t of o.bullThesis || []) seen.add(`bull|${shape(t)}`);
            for (const t of o.bearThesis || []) seen.add(`bear|${shape(t)}`);
            for (const a of o.auditLog || []) seen.add(`audit|${a.category}|${shape(a.factor)}`);
        }
        expect([...seen].sort()).toMatchSnapshot();
    });

    it('amostra legível de cenários completos (diff útil quando um hash muda)', () => {
        const sample = outputs.filter((_, i) => i % 150 === 0).map(o => JSON.parse(o));
        expect(sample).toMatchSnapshot();
    });
});
