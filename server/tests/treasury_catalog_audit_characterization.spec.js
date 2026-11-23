// Caracterização de `auditTreasuryCatalog`: congela a saída sobre catálogos
// gerados por PRNG semeado, cobrindo duplicata, selo colado, taxa fora da faixa,
// índice trocado, mínimo acima do PU, PU ausente e frescor.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { auditTreasuryCatalog } from '../utils/treasuryCatalogAudit.js';
import { mulberry32, canon, hash16 } from './helpers/characterization.js';

const NOW = new Date('2026-11-20T15:00:00.000Z');

const TITLES = [
    'Tesouro IPCA+ 2035', 'Tesouro IPCA+ com Juros Semestrais 2040', 'Tesouro IPCA+ 2045Juros Semestrais',
    'Tesouro  IPCA+   2035', ' Tesouro Selic 2029 ', 'Tesouro Prefixado 2031', 'tesouro prefixado 2031',
    'Tesouro Renda+ 2065', 'Tesouro Educa+ 2040', 'Tesouro Reserva 2036', 'Tesouro 2050Ágio', '', null, undefined, 42,
];
const TYPES = ['IPCA', 'RENDAMAIS', 'EDUCA', 'SELIC', 'PREFIXADO', 'OUTRO', undefined, null];
const RATES = [0, -1, -1.5, 3, 3.01, 5, 6.2, 10, 10.01, 14, 25, 26, null, undefined, 'abc', '5.5', '', NaN, Infinity];
const INDEXES = ['IPCA', 'SELIC', 'PRE', 'CDI', '', undefined, null];
const PRICES = [10.93, 3000, 0, -5, null, undefined, 'x', '150.5', 30];
const DATES = [
    new Date('2026-11-20T10:00:00Z'), new Date('2026-06-01T00:00:00Z'), '2026-11-10T00:00:00Z', 'invalid',
    undefined, null, 0, Date.UTC(2026, 9, 1), new Date('2027-01-01T00:00:00Z'), new Date('nope'),
];

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

const genBond = (rnd) => {
    if (rnd() < 0.03) return null;
    const b = {};
    if (rnd() < 0.95) b.title = pick(rnd, TITLES);
    if (rnd() < 0.95) b.type = pick(rnd, TYPES);
    if (rnd() < 0.9) b.rate = pick(rnd, RATES);
    if (rnd() < 0.85) b.index = pick(rnd, INDEXES);
    if (rnd() < 0.9) b.unitPrice = pick(rnd, PRICES);
    if (rnd() < 0.9) b.minInvestment = pick(rnd, PRICES);
    if (rnd() < 0.9) b.updatedAt = pick(rnd, DATES);
    return b;
};

const genCatalog = (seed) => {
    const rnd = mulberry32(seed);
    const n = Math.floor(rnd() * 12);
    return Array.from({ length: n }, () => genBond(rnd));
};

describe('auditTreasuryCatalog — caracterização', () => {
    afterEach(() => vi.useRealTimers());

    it('hash por cenário (250 catálogos semeados)', () => {
        const hashes = {};
        for (let seed = 1; seed <= 250; seed += 1) {
            hashes[seed] = hash16(auditTreasuryCatalog(genCatalog(seed), { now: NOW }));
        }
        expect(hashes).toMatchSnapshot();
    });

    it('cenários completos legíveis', () => {
        const out = [3, 7, 11, 42].map((seed) => canon(auditTreasuryCatalog(genCatalog(seed), { now: NOW })));
        expect(out).toMatchSnapshot();
    });

    it('entradas degeneradas e relógio padrão', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const out = [
            auditTreasuryCatalog(),
            auditTreasuryCatalog(null),
            auditTreasuryCatalog('x'),
            auditTreasuryCatalog({ length: 2 }),
            auditTreasuryCatalog([null, undefined, {}]),
            auditTreasuryCatalog([{ title: 'A', updatedAt: '2026-11-01T00:00:00Z' }]),
        ].map(canon);
        expect(out).toMatchSnapshot();
    });
});
