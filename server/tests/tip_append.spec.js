/**
 * buildTipAppend — acrescentar a ponta sem reenviar a série.
 *
 * Tem de dar o MESMO resultado que mergeCandleSeries para dias depois do último
 * guardado: mesmo formato, mesma recusa de dia sem pregão, mesmo teto (série
 * profunda não encolhe).
 */
import { describe, expect, it } from 'vitest';
import { buildTipAppend, mergeCandleSeries } from '../utils/assetHistory.js';

const NOW = new Date('2026-10-30T22:00:00.000Z');
const serie = (n, last) => {
    const end = new Date(`${last}T12:00:00Z`).getTime();
    return Array.from({ length: n }, (_, i) => ({
        date: new Date(end - (n - 1 - i) * 86400000).toISOString().slice(0, 10),
        close: 10 + i, adjClose: 10 + i, volume: 100,
    }));
};

describe('buildTipAppend', () => {
    it('empurra só os dias novos, em ordem, no formato da série', () => {
        const r = buildTipAppend(
            [{ date: '2026-10-30', close: 12.84, volume: 5000 }, { date: '2026-10-29', close: 12.5, volume: 10 }],
            { existingLength: 400, lastDate: '2026-10-28', maxPoints: 400, type: 'STOCK', now: NOW },
        );
        expect(r.update.$push.history.$each).toEqual([
            { date: '2026-10-29', close: 12.5, adjClose: 12.5, volume: 10 },
            { date: '2026-10-30', close: 12.84, adjClose: 12.84, volume: 5000 },
        ]);
        expect(r.update.$push.history.$slice).toBe(-400);
        expect(r).toMatchObject({ appended: 2, newLength: 400, lastDate: '2026-10-30' });
    });

    it('série profunda não encolhe: o teto é o tamanho atual quando ele passa do cap', () => {
        const r = buildTipAppend([{ date: '2026-10-30', close: 1 }], {
            existingLength: 900, lastDate: '2026-10-29', maxPoints: 400, type: 'STOCK', now: NOW,
        });
        expect(r.update.$push.history.$slice).toBe(-900);
        expect(r.newLength).toBe(900);
    });

    it('sem teto (benchmark isento) não fatia', () => {
        const r = buildTipAppend([{ date: '2026-10-30', close: 1 }], {
            existingLength: 2000, lastDate: '2026-10-29', maxPoints: Infinity, type: 'INDEX', now: NOW,
        });
        expect(r.update.$push.history).not.toHaveProperty('$slice');
        expect(r.newLength).toBe(2001);
    });

    it('recusa dia sem pregão, dia já guardado e preço inválido', () => {
        const base = { existingLength: 10, maxPoints: 400, type: 'FII', now: NOW };
        expect(buildTipAppend([{ date: '2026-10-31', close: 5 }], { ...base, lastDate: '2026-10-30' })).toBeNull();
        expect(buildTipAppend([{ date: '2026-10-29', close: 5 }], { ...base, lastDate: '2026-10-30' })).toBeNull();
        expect(buildTipAppend([{ date: '2026-10-30', close: 0 }], { ...base, lastDate: '2026-10-29' })).toBeNull();
    });

    it('equivale à mescla completa para a ponta', () => {
        // Cripto: todo dia é dia de negócio, então a série de teste não perde
        // fim de semana na mescla e as duas contas comparam a mesma coisa.
        const guardada = serie(400, '2026-10-29');
        const novos = [{ date: '2026-10-30', close: 99, volume: 7 }];
        const mesclada = mergeCandleSeries(guardada, novos, { maxPoints: 400, type: 'CRYPTO', now: NOW });
        const { update } = buildTipAppend(novos, {
            existingLength: 400, lastDate: '2026-10-29', maxPoints: 400, type: 'CRYPTO', now: NOW,
        });
        const { $each, $slice } = update.$push.history;
        expect([...guardada, ...$each].slice($slice)).toEqual(mesclada);
    });
});
