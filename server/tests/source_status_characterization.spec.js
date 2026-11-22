import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildSourceStatuses } from '../utils/dataSourceStatus.js';
import { _resetSourceStats, getSourceStats } from '../utils/sourceHealth.js';

// Caracterização de buildSourceStatuses, gravada sobre a função monolítica ANTES
// da decomposição. Uma grade determinística de estatísticas de fonte e de
// escaladas passa pelo veredito; a saída inteira é congelada.

const NOW = new Date('2026-09-04T20:00:00.000Z');
const hoursAgo = (h) => (h === null ? null : new Date(NOW.getTime() - h * 3600000).toISOString());

const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (r, list) => list[Math.floor(r() * list.length)];

const facts = (r) => ({
    now: NOW,
    macro: {
        currenciesSources: { usd: pick(r, ['Yahoo', 'Coinbase', 'PTAX']), btc: pick(r, ['Yahoo', 'Coinbase']) },
        currenciesUpdatedAt: hoursAgo(pick(r, [0.2, 30, null])),
        ratesSources: { selic: 'BCB', ipca: pick(r, ['BCB', 'IBGE']) },
        ratesUpdatedAt: hoursAgo(pick(r, [0.2, 50])),
        updatedAt: hoursAgo(0.1),
    },
    fundamentals: { timestamp: hoursAgo(pick(r, [6, null])) },
    treasury: { latestDate: hoursAgo(pick(r, [20, 80])) },
});

const variarFonte = (r, s) => {
    const attempts = pick(r, [0, 0, 1, 2, 3, 5, 10]);
    const ok = attempts === 0 ? 0 : pick(r, [0, Math.floor(attempts / 2), attempts - 1, attempts].filter((n) => n >= 0));
    const failures = attempts - ok;
    const skipped = pick(r, [0, 0, 2]);
    return {
        ...s,
        attempts, ok, failures,
        failureRate: attempts ? failures / attempts : pick(r, [null, 0]),
        lastOkAt: ok ? hoursAgo(pick(r, [1, 5])) : pick(r, [null, hoursAgo(40)]),
        lastFailAt: failures ? hoursAgo(pick(r, [0.5, 3, 8])) : null,
        lastError: failures ? 'ETIMEDOUT' : null,
        skipped,
        lastSkipAt: skipped ? hoursAgo(2) : null,
        lastSkipReason: skipped ? pick(r, ['feriado', null]) : null,
    };
};

const escaladas = (r, fontes) => {
    const porCadeia = {};
    for (const s of fontes) if (s.chain) (porCadeia[s.chain] = porCadeia[s.chain] || []).push(s.id);
    const eventos = [];
    for (const [chain, ids] of Object.entries(porCadeia)) {
        const n = pick(r, [0, 1, 3]);
        for (let k = 0; k < n; k++) {
            const tried = ids.slice(0, 1 + Math.floor(r() * ids.length));
            eventos.push({
                chain, subject: `ATIVO${k}`, tried,
                skipped: r() < 0.2 ? [tried[tried.length - 1]] : [],
                resolvedBy: pick(r, [null, null, tried[tried.length - 1], tried[0]]),
                expected: pick(r, [null, 'SEM_NEGOCIO']),
                reason: 'falhou', count: 1, at: hoursAgo(k + 1),
            });
        }
    }
    return eventos;
};

describe('buildSourceStatuses — caracterização antes da decomposição', () => {
    let saidas;
    beforeAll(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        _resetSourceStats();
        const catalogo = getSourceStats();
        const r = rng(20260904);
        saidas = Array.from({ length: 400 }, () => {
            const fontes = catalogo.map((s) => variarFonte(r, s));
            return buildSourceStatuses(facts(r), fontes, escaladas(r, fontes));
        });
    });
    afterAll(() => { vi.useRealTimers(); });

    it('a grade inteira produz a mesma saída (digest)', () => {
        expect(createHash('sha256').update(JSON.stringify(saidas)).digest('hex')).toMatchSnapshot();
    });

    it('a grade passa por todos os vereditos (cobertura dos ramos)', () => {
        const vereditos = new Set(saidas.flat().map((s) => `${s.status}|${s.idleReason}|${String(s.detail).replace(/\d+%?/g, '#')}`));
        expect([...vereditos].sort()).toMatchSnapshot();
    });

    it('amostra legível (diff útil quando o digest muda)', () => {
        expect(saidas[0]).toMatchSnapshot();
    });
});
