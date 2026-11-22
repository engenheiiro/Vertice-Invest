import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

// Caracterização do score por perfil de FII (scoreFiiProfiles), gravada sobre o
// código monolítico ANTES da decomposição. Uma grade determinística de FIIs passa
// por processAsset e a saída de perfil (scores + linhas de auditoria DEF/MOD/BOLD)
// é congelada: qualquer diferença de ponto, texto ou ordem quebra o teste.

// Gerador determinístico (mulberry32): a grade é a mesma em toda máquina.
const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Valores nas bordas e entre as bordas de cada faixa da função.
const GRID = {
    dy: [3, 6.4, 6.9, 7.2, 7.9, 8.5, 9.4, 10.5, 11.4, 12.4, 13.4, 14.5, 16, 18, 19.5, 25, 47],
    pvp: [0.6, 0.74, 0.76, 0.8, 0.81, 0.83, 0.86, 0.88, 0.89, 0.91, 0.93, 0.95, 0.96, 0.98, 1.0, 1.04, 1.05, 1.08, 1.1, 1.11, 1.12, 1.15, 1.4],
    beta: [0, -0.2, 0.2, 0.39, 0.4, 0.6, 0.69, 0.7, 0.8, 0.9, 0.95, 1.3],
    avgLiquidity: [600000, 1500000, 2000000, 3000000, 5000000, 8000000],
    marketCap: [300000000, 500000000, 900000000, 3000000000],
    vacancy: [0, 5, 10, 11, 12, 13, 15, 16, 30],
    capRate: [0, 5, 6.5, 7.5, 9, 10, 11, 12.5, 14],
    qtdImoveis: [0, 5, 10, 11, 20, 21, 40],
    subtype: [['TIJOLO', 'Logística'], ['PAPEL', 'Papel'], [null, 'Recebíveis'], [null, 'Shoppings'], ['HIBRIDO', 'Híbrido']],
    tier1: [false, true],
    consistency: [null, 0.5, 0.8, 0.95],
    ntnb: [6.4, 7.5, undefined],
};

const pick = (r, list) => list[Math.floor(r() * list.length)];

const buildCase = (r, i) => {
    const [fiiSubType, sector] = pick(r, GRID.subtype);
    const consistency = pick(r, GRID.consistency);
    const asset = {
        ticker: `CASE${i}11`, type: 'FII', name: `Caso ${i}`, sector, fiiSubType, price: 100,
        dbFlags: { isBlacklisted: false, isTier1: pick(r, GRID.tier1) },
        metrics: {
            price: 100, pl: 0, roe: 0, netMargin: 0, evEbitda: 0, revenueGrowth: 0, debtToEquity: 0, payout: 0,
            dy: pick(r, GRID.dy), pvp: pick(r, GRID.pvp), beta: pick(r, GRID.beta),
            avgLiquidity: pick(r, GRID.avgLiquidity), marketCap: pick(r, GRID.marketCap),
            vacancy: pick(r, GRID.vacancy), capRate: pick(r, GRID.capRate), qtdImoveis: pick(r, GRID.qtdImoveis),
            volatility: 12, sector, fiiSubType,
            ...(consistency === null ? {} : { trackRecord: { dividendConsistency: consistency } }),
            _missing: { roe: true, netMargin: true, revenueGrowth: true, marketCap: false },
            _staleDays: 20,
        },
    };
    const ntnb = pick(r, GRID.ntnb);
    const context = { MACRO: { SELIC: 13.75, IPCA: 4.62, RISK_FREE: 13.75, ...(ntnb === undefined ? {} : { NTNB_LONG: ntnb }) } };
    return { asset, context };
};

const PROFILE_CATEGORIES = new Set(['Perfil Defensivo', 'Perfil Moderado', 'Perfil Arrojado']);

const runCase = ({ asset, context }) => {
    const res = scoringEngine.processAsset(asset, context);
    if (res._discarded) return { discarded: res.reason };
    const audit = res.auditLog
        .filter(a => PROFILE_CATEGORIES.has(a.category))
        .map(a => `${a.category[7]}|${a.points}|${a.type}|${a.factor}`);
    return { scores: res.scores, audit };
};

const CASES = (() => {
    const r = rng(20261122);
    return Array.from({ length: 1500 }, (_, i) => buildCase(r, i));
})();

describe('scoreFiiProfiles — caracterização antes da decomposição', () => {
    const outputs = CASES.map(runCase);

    it('a grade inteira produz a mesma saída de perfil (digest)', () => {
        const digest = createHash('sha256').update(JSON.stringify(outputs)).digest('hex');
        expect(digest).toMatchSnapshot();
    });

    it('a grade passa por todos os fatores de perfil FII (cobertura dos ramos)', () => {
        const factors = new Set(outputs.flatMap(o => (o.audit || [])
            .map(line => line.split('|').slice(0, 1).concat(line.split('|')[3].replace(/[-+]?\d+(\.\d+)?/g, '#')).join('|'))));
        expect([...factors].sort()).toMatchSnapshot();
    });

    it('amostra legível de casos (diff útil quando o digest muda)', () => {
        expect(outputs.slice(0, 25)).toMatchSnapshot();
    });
});
