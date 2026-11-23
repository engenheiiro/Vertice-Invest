import { describe, expect, it } from 'vitest';
import type { DayMoverRow, DayMovers } from './dayMovers';
import {
    dayTone, emptyMoversMessage, formatShortDay, groupMoverRows, moneyFormatters, moverRowView, moverScale,
    positiveEquity, sinceAnchorText,
} from './dayMoversView';

const row = (over: Partial<DayMoverRow>): DayMoverRow => ({
    id: 'x', ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL', sector: null,
    isReserve: false, value: 0, percent: 0, reason: null, dividends: 0, ...over,
});

const movers = (over: Partial<DayMovers>): DayMovers => ({
    rows: [], upCount: 0, downCount: 0, flatCount: 0, total: 0, totalPercent: 0, dividends: 0,
    dividendTickers: [], anchorDate: null, pendingTreasury: { count: 0, latestPriceDate: null }, sharedReason: null,
    ...over,
});

describe('dayMoversView', () => {
    it('sinal só no positivo e nunca sobre a máscara de privacidade', () => {
        const signed = (v: number) => moneyFormatters(false).signedMoney(v).replace(/\s/g, ' ');
        expect(signed(10)).toBe('+R$ 10,00');
        expect(signed(-10)).toBe('-R$ 10,00');
        expect(signed(0)).toBe('R$ 0,00');
        expect(moneyFormatters(true).signedMoney(10)).toBe('••••••');
    });

    it('tom do dia: zero neutro, alta verde, queda (e NaN) vermelho', () => {
        expect(dayTone(0).text).toBe('text-slate-300');
        expect(dayTone(5).chip).toBe('bg-emerald-500/10 text-emerald-400');
        expect(dayTone(-5).text).toBe('text-red-400');
        expect(dayTone(Number.NaN).text).toBe('text-red-400');
    });

    it('patrimônio só dá escala quando é positivo', () => {
        expect(positiveEquity({ totalEquity: 100 })).toBe(100);
        expect(positiveEquity({ totalEquity: 0 })).toBeNull();
        expect(positiveEquity(null)).toBeNull();
    });

    it('agrupa alta/queda/sem variação com subtotal só nos dois primeiros', () => {
        const rows = [row({ id: 'a', value: 10 }), row({ id: 'b', value: -4 }), row({ id: 'c', value: 0 }), row({ id: 'd', value: 5 })];
        const g = groupMoverRows(rows);
        expect(g.list.map((x) => [x.key, x.rows.length, x.total])).toEqual([['up', 2, 15], ['down', 1, -4], ['unmeasured', 1, null]]);
        expect(g.unmeasuredCount).toBe(1);
        expect(groupMoverRows([]).list).toEqual([]);
        expect(moverScale(rows)).toBe(10);
    });

    it('linha: piso de 2% na barra, reserva pelo nome e etiqueta escondida pela faixa', () => {
        const v = moverRowView(row({ value: 0.01, reason: 'STALE_QUOTE' }), 1000, false);
        expect(v.width).toBe(2);
        expect(v.label).toBe('sem negócio hoje');
        expect(v.assetLabel).toBe('PETR4 · Ação');
        expect(moverRowView(row({ value: 1, reason: 'STALE_QUOTE' }), 0, true)).toMatchObject({ width: 0, label: null });
        expect(moverRowView(row({ type: 'CASH', name: 'Viagem' }), 1, false).assetLabel).toBe('Viagem');
    });

    it('textos: dia curto, âncora e lista vazia', () => {
        expect(formatShortDay('2026-09-01')).toBe('01/09');
        expect(formatShortDay('lixo')).toBe('lixo');
        expect(sinceAnchorText(null)).toBe('desde o fechamento anterior');
        expect(emptyMoversMessage(movers({ flatCount: 2 }), null)).toBe('Nenhuma posição se moveu hoje.');
        expect(emptyMoversMessage(movers({ pendingTreasury: { count: 1, latestPriceDate: null } }), null))
            .toBe('Nenhuma posição com movimento publicado para detalhar.');
        expect(emptyMoversMessage(movers({}), null)).toBe('Nenhuma posição na carteira para detalhar.');
    });
});
