import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

// Caracterização do gate isEligibleForDefensive, gravada sobre a função
// monolítica ANTES da decomposição. O gate não é exportado: lê-se pela saída
// `isDefensiveEligible` de processAsset. Duas travas: uma tabela legível com um
// caso aprovado por classe e um reprovado por regra, e uma grade determinística
// nas bordas de cada régua, congelada por digest.

const CONTEXT = { MACRO: { SELIC: 13.75, IPCA: 4.62, RISK_FREE: 13.75, NTNB_LONG: 6.4 } };

const base = {
    STOCK: {
        ticker: 'BASE3', sector: 'Energia Elétrica',
        metrics: {
            avgLiquidity: 5e6, marketCap: 5e9, beta: 0.6, dy: 7, pl: 8, roe: 15, netMargin: 12,
            payout: 60, debtToEquity: 1.5, pvp: 1.2, evEbitda: 6, revenueGrowth: 5, volatility: 20, _missing: {},
        },
    },
    FII: {
        ticker: 'BASE11', sector: 'Logística', fiiSubType: 'TIJOLO',
        metrics: { avgLiquidity: 3e6, marketCap: 1e9, dy: 10, vacancy: 5, qtdImoveis: 10, pvp: 0.95, beta: 0.4, capRate: 9, _missing: {} },
    },
    STOCK_US: {
        ticker: 'BASE', sector: 'Utilities', usSubType: 'STOCK',
        metrics: { avgLiquidity: 5e7, marketCap: 50e9, beta: 0.5, roe: 12, dy: 3, pl: 18, netMargin: 10, payout: 50, _missing: {} },
    },
    CRYPTO: {
        ticker: 'SOL', sector: 'Crypto',
        metrics: { avgLiquidity: 1e9, marketCap: 80e9, volatility: 60, _missing: {} },
    },
};

const asset = (type, over = {}) => {
    const b = base[type];
    const { metrics: mOver = {}, ...rest } = over;
    return {
        type, name: 'Caso', price: 50, dbFlags: { isBlacklisted: false, isTier1: false },
        ...b, ...rest,
        metrics: { price: 50, ...b.metrics, ...mOver, _missing: { ...b.metrics._missing, ...(mOver._missing || {}) } },
    };
};

const elegivel = (a) => {
    const res = scoringEngine.processAsset(a, CONTEXT);
    return res._discarded ? `descartado: ${res.reason}` : res.isDefensiveEligible;
};

const TABELA = [
    ['STOCK base passa', asset('STOCK'), true],
    ['STOCK liquidez < 200k (descartado antes)', asset('STOCK', { metrics: { avgLiquidity: 150000 } }), 'descartado: Liquidez Insuficiente'],
    ['STOCK marketCap < 1B', asset('STOCK', { metrics: { marketCap: 9e8 } }), false],
    ['STOCK beta ausente', asset('STOCK', { metrics: { beta: 0, _missing: { beta: true } } }), false],
    ['STOCK beta ≥ 1.5', asset('STOCK', { metrics: { beta: 1.5 } }), false],
    ['STOCK beta negativo real passa', asset('STOCK', { metrics: { beta: -0.2 } }), true],
    ['STOCK setor cíclico', asset('STOCK', { sector: 'Mineração' }), false],
    ['STOCK setor não seguro, DY < 6', asset('STOCK', { sector: 'Varejo', metrics: { dy: 5.9 } }), false],
    ['STOCK setor não seguro, P/L 0', asset('STOCK', { sector: 'Varejo', metrics: { pl: 0 } }), false],
    ['STOCK setor não seguro, P/L > 10', asset('STOCK', { sector: 'Varejo', metrics: { pl: 10.5 } }), false],
    // DY ausente (NaN) não reprova a rota de renda: o original testava `dy < 6`, falso para NaN.
    ['STOCK setor não seguro, DY NaN não reprova', asset('STOCK', { sector: 'Varejo', metrics: { dy: NaN } }), true],
    ['STOCK_US fora do setor, DY NaN não reprova', asset('STOCK_US', { sector: 'Technology', metrics: { dy: NaN, pl: 0 } }), true],
    ['STOCK setor não seguro, DY 6 e P/L 10 passa', asset('STOCK', { sector: 'Varejo', metrics: { dy: 6, pl: 10 } }), true],
    ['STOCK ROE ausente', asset('STOCK', { metrics: { _missing: { roe: true } } }), false],
    ['STOCK ROE < 5', asset('STOCK', { metrics: { roe: 4.9 } }), false],
    ['STOCK margem < 3', asset('STOCK', { metrics: { netMargin: 2.9 } }), false],
    ['STOCK margem ausente tolerada', asset('STOCK', { metrics: { netMargin: 0, _missing: { netMargin: true } } }), true],
    ['STOCK payout > 200', asset('STOCK', { metrics: { payout: 201 } }), false],
    ['STOCK payout ausente tolerado', asset('STOCK', { metrics: { payout: 300, _missing: { payout: true } } }), true],
    ['STOCK D/E > 4 fora do financeiro', asset('STOCK', { metrics: { debtToEquity: 4.1 } }), false],
    ['STOCK D/E > 4 em banco passa', asset('STOCK', { sector: 'Bancos', metrics: { debtToEquity: 8 } }), true],
    ['FII base passa', asset('FII'), true],
    ['FII marketCap < 500M', asset('FII', { metrics: { marketCap: 4.9e8 } }), false],
    ['FII DY > 18', asset('FII', { metrics: { dy: 18.1 } }), false],
    ['FII vacância > 12', asset('FII', { metrics: { vacancy: 12.1 } }), false],
    ['FII tijolo mono-ativo', asset('FII', { metrics: { qtdImoveis: 1 } }), false],
    ['FII papel sem imóvel passa', asset('FII', { fiiSubType: 'PAPEL', sector: 'Papel', metrics: { qtdImoveis: 0 } }), true],
    ['FII recebíveis sem subtipo passa', asset('FII', { fiiSubType: null, sector: 'Recebíveis', metrics: { qtdImoveis: 0 } }), true],
    ['FII liquidez < 1M', asset('FII', { metrics: { avgLiquidity: 900000 } }), false],
    ['STOCK_US base passa', asset('STOCK_US'), true],
    ['STOCK_US marketCap < 10B', asset('STOCK_US', { metrics: { marketCap: 9e9 } }), false],
    ['STOCK_US beta ausente', asset('STOCK_US', { metrics: { _missing: { beta: true } } }), false],
    ['STOCK_US beta ≥ 1.8', asset('STOCK_US', { metrics: { beta: 1.8 } }), false],
    ['STOCK_US ROE < 5', asset('STOCK_US', { metrics: { roe: 4 } }), false],
    ['STOCK_US fora do setor, DY < 1.5 e P/E 0', asset('STOCK_US', { sector: 'Technology', metrics: { dy: 1, pl: 0 } }), false],
    ['STOCK_US fora do setor, DY < 1.5 e P/E > 30', asset('STOCK_US', { sector: 'Technology', metrics: { dy: 1, pl: 31 } }), false],
    ['STOCK_US fora do setor, DY < 1.5 e P/E 25 passa', asset('STOCK_US', { sector: 'Technology', metrics: { dy: 1, pl: 25 } }), true],
    ['CRYPTO grande e líquido passa', asset('CRYPTO'), true],
    ['CRYPTO marketCap < 50B', asset('CRYPTO', { metrics: { marketCap: 4e10 } }), false],
    ['CRYPTO BTC pequeno passa', asset('CRYPTO', { ticker: 'BTC', metrics: { marketCap: 1e9 } }), true],
    ['CRYPTO liquidez < 500M', asset('CRYPTO', { metrics: { avgLiquidity: 4e8 } }), false],
];

const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (r, list) => list[Math.floor(r() * list.length)];

const GRADE = {
    STOCK: () => ({
        sector: ['Energia Elétrica', 'Bancos', 'Varejo', 'Mineração', 'Saneamento', 'Tecnologia', '', 'Holding'],
        metrics: {
            avgLiquidity: [150000, 250000, 5e6], marketCap: [9e8, 1e9, 2e10], beta: [-0.3, 0, 0.8, 1.49, 1.5, 2, NaN],
            dy: [0, 5.9, 6, 9], pl: [-3, 0, 5, 10, 10.1, 25], roe: [-2, 4.9, 5, 20, NaN], netMargin: [-5, 2.9, 3, 15],
            payout: [0, 150, 200, 201], debtToEquity: [0.5, 4, 4.1, 9],
        },
        missing: ['beta', 'roe', 'netMargin', 'payout'],
    }),
    FII: () => ({
        sector: ['Logística', 'Papel', 'Recebíveis', 'Shoppings', 'Híbrido'],
        fiiSubType: ['TIJOLO', 'PAPEL', null],
        metrics: {
            avgLiquidity: [600000, 1e6, 999999, 4e6], marketCap: [4.9e8, 5e8, 3e9], dy: [8, 18, 18.1, 30],
            vacancy: [0, 12, 12.1, 40], qtdImoveis: [0, 1, 2, 30],
        },
        missing: [],
    }),
    STOCK_US: () => ({
        sector: ['Utilities', 'Healthcare', 'Technology', 'Energy', 'Financials', ''],
        metrics: {
            avgLiquidity: [1e6, 5e7], marketCap: [9e9, 1e10, 3e11], beta: [0, 0.9, 1.79, 1.8, NaN], roe: [4.9, 5, 30, NaN],
            dy: [0, 1.4, 1.5, 3], pl: [0, 15, 30, 30.1, -5],
        },
        missing: ['beta', 'roe'],
    }),
    CRYPTO: () => ({
        ticker: ['BTC', 'ETH', 'SOL', 'DOGE'],
        metrics: { avgLiquidity: [1e8, 5e8, 4.9e8, 2e9], marketCap: [1e9, 5e10, 4.9e10, 9e11] },
        missing: [],
    }),
};

const sortear = (r, type) => {
    const g = GRADE[type]();
    const over = { metrics: { _missing: {} } };
    for (const campo of ['sector', 'fiiSubType', 'ticker']) if (g[campo]) over[campo] = pick(r, g[campo]);
    for (const [k, vals] of Object.entries(g.metrics)) over.metrics[k] = pick(r, vals);
    for (const k of g.missing) if (r() < 0.15) over.metrics._missing[k] = true;
    return asset(type, over);
};

describe('isEligibleForDefensive — caracterização antes da decomposição', () => {
    it.each(TABELA)('%s', (_nome, a, esperado) => {
        expect(elegivel(a)).toBe(esperado);
    });

    it('a grade de bordas produz a mesma decisão (digest + contagem por classe)', () => {
        const r = rng(20261122);
        const decisoes = [];
        const contagem = {};
        for (const type of Object.keys(GRADE)) {
            for (let i = 0; i < 1500; i++) {
                const d = elegivel(sortear(r, type));
                decisoes.push(d);
                const chave = `${type}|${d}`;
                contagem[chave] = (contagem[chave] || 0) + 1;
            }
        }
        expect(contagem).toMatchSnapshot();
        expect(createHash('sha256').update(JSON.stringify(decisoes)).digest('hex')).toMatchSnapshot();
    });
});
