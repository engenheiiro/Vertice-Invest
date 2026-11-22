import { describe, it, expect } from 'vitest';
import {
    changeTrend, deriveFreshness, filterAndSortBonds, fmtBondPrice, fmtBondRate, fmtCardValue, fmtCurrency,
    fmtLastUpdated, getBondTypeStyle, nextSort, TREASURY_FILTERS, type TreasuryBond,
} from './indicatorsView';

const bond = (over: Partial<TreasuryBond>): TreasuryBond => ({
    _id: 'x', title: 'T', type: 'IPCA', index: 'IPCA', rate: 1, unitPrice: 1, minInvestment: 1, maturityDate: '2030-01-01', ...over,
});

const BONDS = [
    bond({ _id: 'a', title: 'A', type: 'SELIC', rate: 3 }),
    bond({ _id: 'b', title: 'B', type: 'IPCA', rate: 1 }),
    bond({ _id: 'c', title: 'C', type: 'EDUCA', rate: 2 }),
    bond({ _id: 'd', title: 'D', type: 'PREFIXADO', rate: 2 }),
];

const NOW = Date.parse('2026-11-22T12:00:00Z');

describe('nextSort', () => {
    it('mesma coluna ascendente inverte para descendente', () => {
        expect(nextSort({ key: 'rate', direction: 'asc' }, 'rate')).toEqual({ key: 'rate', direction: 'desc' });
    });
    it('mesma coluna descendente volta para ascendente', () => {
        expect(nextSort({ key: 'rate', direction: 'desc' }, 'rate')).toEqual({ key: 'rate', direction: 'asc' });
    });
    it('outra coluna sempre começa ascendente', () => {
        expect(nextSort({ key: 'rate', direction: 'asc' }, 'title')).toEqual({ key: 'title', direction: 'asc' });
    });
});

describe('filterAndSortBonds', () => {
    const ids = (list: TreasuryBond[]) => list.map((b) => b._id);

    it('sem lista devolve vazio', () => {
        expect(filterAndSortBonds(undefined, 'ALL', { key: 'type', direction: 'asc' })).toEqual([]);
    });
    it('ALL ordena sem filtrar e não altera a lista de entrada', () => {
        const input = [...BONDS];
        expect(ids(filterAndSortBonds(input, 'ALL', { key: 'type', direction: 'asc' }))).toEqual(['c', 'b', 'd', 'a']);
        expect(ids(input)).toEqual(['a', 'b', 'c', 'd']);
    });
    it('descendente inverte e empate mantém a ordem original', () => {
        expect(ids(filterAndSortBonds(BONDS, 'ALL', { key: 'rate', direction: 'desc' }))).toEqual(['a', 'c', 'd', 'b']);
        expect(ids(filterAndSortBonds(BONDS, 'ALL', { key: 'rate', direction: 'asc' }))).toEqual(['b', 'c', 'd', 'a']);
    });
    it('família filtra pelo tipo exato', () => {
        expect(ids(filterAndSortBonds(BONDS, 'SELIC', { key: 'type', direction: 'asc' }))).toEqual(['a']);
    });
    it('OUTROS fica com o que não é IPCA, PREFIXADO nem SELIC', () => {
        expect(ids(filterAndSortBonds(BONDS, 'OUTROS', { key: 'type', direction: 'asc' }))).toEqual(['c']);
    });
});

describe('formatação', () => {
    it('fmtCurrency: reais com 2 casas; zero vira "-"', () => {
        expect(fmtCurrency(1234.5)).toBe('R$ 1.234,50');
        expect(fmtCurrency(0)).toBe('-');
    });
    it('fmtBondPrice: só positivo é preço, o resto vira "—" (nunca R$ 0)', () => {
        expect(fmtBondPrice(30.03)).toBe('R$ 30,03');
        expect(fmtBondPrice(0)).toBe('—');
        expect(fmtBondPrice(-1)).toBe('—');
    });
    it('fmtBondRate: prefixado sem índice, demais com "ÍNDICE + "', () => {
        expect(fmtBondRate({ index: 'PRE', rate: 13.9 })).toBe('13.90%');
        expect(fmtBondRate({ index: 'IPCA', rate: 7.4 })).toBe('IPCA + 7.40%');
    });
    it('fmtLastUpdated: data e hora em pt-BR', () => {
        expect(fmtLastUpdated('2026-11-22T11:50:00Z')).toBe(new Date('2026-11-22T11:50:00Z').toLocaleString('pt-BR'));
    });
    it('fmtCardValue: moeda com prefixo e até 3 casas; ausente vira placeholder', () => {
        expect(fmtCardValue(5.4321, true, 'R$')).toBe('R$ 5,432');
        expect(fmtCardValue(undefined, true, '$')).toBe('$ 0,00');
        expect(fmtCardValue(128000, false, 'R$')).toBe('128.000');
        expect(fmtCardValue(undefined, false, 'R$')).toBe('0.00');
        expect(fmtCardValue(0, false, 'R$')).toBe('0');
    });
});

describe('changeTrend', () => {
    it('alta verde, queda vermelha', () => {
        expect(changeTrend(1.2)).toEqual({ direction: 'up', color: 'text-emerald-500' });
        expect(changeTrend(-0.5)).toEqual({ direction: 'down', color: 'text-red-500' });
    });
    it('zero ou ausente: sem seta', () => {
        expect(changeTrend(0)).toBeNull();
        expect(changeTrend(undefined)).toBeNull();
    });
});

describe('deriveFreshness', () => {
    it('sem dado: nada suspeito', () => {
        expect(deriveFreshness(null, NOW)).toEqual({ selicStale: false, ipcaStale: false, staleMetrics: [], isPanelStale: false });
    });
    it('SELIC em fallback arrasta o CDI; IPCA entra por último', () => {
        const r = deriveFreshness({ ratesSources: { selic: 'fallback', ipca: 'fallback' } }, NOW);
        expect(r.staleMetrics).toEqual(['SELIC', 'CDI', 'IPCA']);
        expect(r.selicStale && r.ipcaStale).toBe(true);
    });
    it('painel parado só acima de 1h', () => {
        expect(deriveFreshness({ lastUpdated: '2026-11-22T11:00:00Z' }, NOW).isPanelStale).toBe(false);
        expect(deriveFreshness({ lastUpdated: '2026-11-22T10:59:59Z' }, NOW).isPanelStale).toBe(true);
    });
    it('data inválida não acusa painel parado', () => {
        expect(deriveFreshness({ lastUpdated: 'lixo' }, NOW).isPanelStale).toBe(false);
    });
});

describe('getBondTypeStyle e filtros', () => {
    it('cada família tem sua cor; desconhecida cai no neutro', () => {
        expect(getBondTypeStyle('IPCA')).toContain('text-purple-400');
        expect(getBondTypeStyle('SELIC')).toContain('text-blue-400');
        expect(getBondTypeStyle('PREFIXADO')).toContain('text-emerald-400');
        expect(getBondTypeStyle('RENDAMAIS')).toContain('text-amber-400');
        expect(getBondTypeStyle('EDUCA')).toContain('text-pink-400');
        expect(getBondTypeStyle('OUTRO')).toBe('bg-slate-800 text-slate-400');
    });
    it('botões de filtro: Todos e as três famílias, sem OUTROS', () => {
        expect(TREASURY_FILTERS).toEqual(['ALL', 'IPCA', 'PREFIXADO', 'SELIC']);
    });
});
