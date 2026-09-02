import { describe, expect, it } from 'vitest';
import type { Asset, DayChangeReason, WalletKPIs } from '../contexts/WalletContext';
import {
    buildDayMovers, isDefaultReason, isZeroedByData,
    reasonLabel, reasonTone, reasonDescription,
} from './dayMovers';

const asset = (over: Partial<Asset> & { ticker: string }): Asset => ({
    id: `id-${over.ticker}`,
    type: 'STOCK',
    quantity: 100,
    averagePrice: 30,
    currentPrice: 32,
    totalValue: 3200,
    totalCost: 3000,
    profit: 200,
    profitPercent: 6.67,
    currency: 'BRL',
    dayChangeReason: 'ANCHOR_CLOSE',
    ...over,
});

const kpis = (over: Partial<WalletKPIs> = {}): Partial<WalletKPIs> => ({
    dayVariation: 386.42,
    dayVariationPercent: 0.26,
    dayAnchorDate: '2026-09-01',
    dayDividends: 0,
    ...over,
});

describe('buildDayMovers — a conta é do servidor', () => {
    it('o total vem do KPI, não da soma das linhas', () => {
        // Soma das linhas = 30. O KPI diz 386,42. O card é a autoridade: se as
        // duas divergirem, o painel mostra o número que o resto do sistema usa.
        const out = buildDayMovers(
            [asset({ ticker: 'PETR4', dayChangeValue: 20 }), asset({ ticker: 'VALE3', dayChangeValue: 10 })],
            kpis(),
        );

        expect(out.total).toBe(386.42);
        expect(out.totalPercent).toBe(0.26);
    });

    it('ordena da maior alta para a maior queda', () => {
        const out = buildDayMovers([
            asset({ ticker: 'VALE3', dayChangeValue: -96.7 }),
            asset({ ticker: 'PETR4', dayChangeValue: 214.8 }),
            asset({ ticker: 'KNCR11', dayChangeValue: -158.2 }),
            asset({ ticker: 'ITSA4', dayChangeValue: 148.3 }),
        ], kpis());

        expect(out.rows.map((r) => r.ticker)).toEqual(['PETR4', 'ITSA4', 'VALE3', 'KNCR11']);
        expect(out.upCount).toBe(2);
        expect(out.downCount).toBe(2);
    });

    it('empate de contribuição resolve pelo ticker — a ordem não oscila', () => {
        const out = buildDayMovers([
            asset({ ticker: 'WEGE3', dayChangeValue: 50 }),
            asset({ ticker: 'BBAS3', dayChangeValue: 50 }),
        ], kpis());

        expect(out.rows.map((r) => r.ticker)).toEqual(['BBAS3', 'WEGE3']);
    });

    it('carteira vazia devolve o KPI e nenhuma linha', () => {
        const out = buildDayMovers([], kpis({ dayVariation: 0, dayVariationPercent: 0 }));

        expect(out.rows).toEqual([]);
        expect(out.total).toBe(0);
        expect(out.pendingTreasury).toEqual({ count: 0, latestPriceDate: null });
        expect(out.sharedReason).toBeNull();
    });

    it('sem KPIs não explode — devolve zeros', () => {
        const out = buildDayMovers([asset({ ticker: 'PETR4', dayChangeValue: 10 })], null);

        expect(out.total).toBe(0);
        expect(out.anchorDate).toBeNull();
        expect(out.rows).toHaveLength(1);
    });
});

describe('buildDayMovers — os dois tipos de zero', () => {
    it('zero DE MERCADO é agrupado: o ativo negociou e fechou estável', () => {
        const out = buildDayMovers([
            asset({ ticker: 'PETR4', dayChangeValue: 214.8 }),
            asset({ ticker: 'WEGE3', dayChangeValue: 0, dayChangeReason: 'ANCHOR_CLOSE' }),
            asset({ ticker: 'BBAS3', dayChangeValue: 0.004, dayChangeReason: 'PREVIOUS_CLOSE' }),
        ], kpis());

        expect(out.rows.map((r) => r.ticker)).toEqual(['PETR4']);
        expect(out.flatCount).toBe(2);
    });

    it('zero NOSSO permanece visível: é limite do dado, não fato do mercado', () => {
        const out = buildDayMovers([
            asset({ ticker: 'PETR4', dayChangeValue: 214.8 }),
            asset({ ticker: 'RECR11', dayChangeValue: 0, dayChangeReason: 'STALE_QUOTE' }),
            asset({ ticker: 'XPTO11', dayChangeValue: 0, dayChangeReason: 'NO_QUOTE' }),
            asset({ ticker: 'LTN2027', dayChangeValue: 0, dayChangeReason: 'MATURED', type: 'FIXED_INCOME' }),
        ], kpis());

        expect(out.rows.map((r) => r.ticker)).toEqual(['PETR4', 'LTN2027', 'RECR11', 'XPTO11']);
        expect(out.flatCount).toBe(0);
    });

    it('ativo parado mas com provento do dia-ex fica visível — há o que explicar', () => {
        const out = buildDayMovers([
            asset({ ticker: 'KNCR11', dayChangeValue: 0, dayChangeReason: 'ANCHOR_CLOSE', dayDividends: 142.5 }),
        ], kpis({ dayDividends: 142.5 }));

        expect(out.rows.map((r) => r.ticker)).toEqual(['KNCR11']);
        expect(out.flatCount).toBe(0);
        expect(out.dividendTickers).toEqual(['KNCR11']);
        expect(out.dividends).toBe(142.5);
    });

    it('Tesouro sem PU do dia vira nota única, fora da lista de movimentos', () => {
        const out = buildDayMovers([
            asset({
                ticker: 'TESOURO IPCA+ 2035', type: 'FIXED_INCOME',
                dayChangeValue: 0, dayChangeReason: 'FIXED_INCOME_MTM_PENDING',
                priceDate: '2026-09-01',
            }),
            asset({
                ticker: 'TESOURO PREFIXADO 2029', type: 'FIXED_INCOME',
                dayChangeValue: 0, dayChangeReason: 'FIXED_INCOME_MTM_PENDING',
                priceDate: '2026-09-01',
            }),
        ], kpis());

        expect(out.rows).toEqual([]);
        expect(out.pendingTreasury).toEqual({ count: 2, latestPriceDate: '2026-09-01' });
    });

    it('Tesouro pendente com contribuição inesperada continua visível', () => {
        const out = buildDayMovers([
            asset({
                ticker: 'TESOURO IPCA+ 2035', type: 'FIXED_INCOME',
                dayChangeValue: -5.54, dayChangeReason: 'FIXED_INCOME_MTM_PENDING',
                priceDate: '2026-09-01',
            }),
        ], kpis());

        expect(out.rows.map((r) => r.ticker)).toEqual(['TESOURO IPCA+ 2035']);
        expect(out.pendingTreasury.count).toBe(0);
    });

    it('o provento do dia NÃO entra no total — a identidade com o patrimônio é só preço', () => {
        const out = buildDayMovers([
            asset({ ticker: 'KNCR11', dayChangeValue: -158.2, dayDividends: 142.5 }),
        ], kpis({ dayVariation: -158.2, dayDividends: 142.5 }));

        expect(out.total).toBe(-158.2);
        expect(out.dividends).toBe(142.5);
    });
});

describe('buildDayMovers — motivo compartilhado vira faixa', () => {
    const stale = (ticker: string) => asset({ ticker, dayChangeValue: 0, dayChangeReason: 'STALE_QUOTE' });

    it('mercado inteiro parado: faixa única, sem repetir a etiqueta em cada linha', () => {
        const out = buildDayMovers([stale('PETR4'), stale('VALE3'), stale('ITSA4')], kpis({ dayVariation: 0 }));

        expect(out.sharedReason).toBe('STALE_QUOTE');
    });

    it('a renda fixa não conta para a faixa: ela rende por regra própria', () => {
        const out = buildDayMovers([
            stale('PETR4'), stale('VALE3'),
            asset({ ticker: 'RESERVA', type: 'CASH', dayChangeValue: 4.12, dayChangeReason: 'FIXED_INCOME_CURVE' }),
        ], kpis());

        expect(out.sharedReason).toBe('STALE_QUOTE');
    });

    it('uma linha defasada no meio de linhas normais é etiqueta, não faixa', () => {
        const out = buildDayMovers([
            asset({ ticker: 'PETR4', dayChangeValue: 214.8 }),
            stale('RECR11'),
        ], kpis());

        expect(out.sharedReason).toBeNull();
    });

    it('carteira normal não produz faixa nenhuma', () => {
        const out = buildDayMovers([
            asset({ ticker: 'PETR4', dayChangeValue: 214.8 }),
            asset({ ticker: 'VALE3', dayChangeValue: -96.7 }),
        ], kpis());

        expect(out.sharedReason).toBeNull();
    });

    it('uma única posição não vira faixa — não há "todo mundo" com uma linha só', () => {
        const out = buildDayMovers([stale('PETR4')], kpis({ dayVariation: 0 }));

        expect(out.sharedReason).toBeNull();
    });
});

describe('rótulos de motivo', () => {
    it('o caso normal não recebe etiqueta — senão a exceção deixa de saltar', () => {
        expect(reasonLabel('ANCHOR_CLOSE')).toBeNull();
        expect(reasonLabel('PREVIOUS_CLOSE')).toBeNull();
        expect(reasonLabel(null)).toBeNull();
        expect(isDefaultReason('ANCHOR_CLOSE')).toBe(true);
        expect(isDefaultReason('STALE_QUOTE')).toBe(false);
    });

    it('todo motivo fora do caso normal tem rótulo e explicação', () => {
        const rotulados: DayChangeReason[] = [
            'BOUGHT_TODAY', 'FIXED_INCOME_MTM', 'FIXED_INCOME_MTM_PENDING',
            'FIXED_INCOME_CURVE', 'MATURED', 'STALE_QUOTE', 'NO_QUOTE',
            'PROVIDER_WINDOW', 'PROVIDER_SESSION',
        ];

        for (const reason of rotulados) {
            expect(reasonLabel(reason), reason).toBeTruthy();
            expect(reasonDescription(reason), reason).toBeTruthy();
        }
    });

    it('cálculo diferente é neutro; número degradado é aviso', () => {
        expect(reasonTone('BOUGHT_TODAY')).toBe('neutral');
        expect(reasonTone('FIXED_INCOME_CURVE')).toBe('neutral');
        expect(reasonTone('FIXED_INCOME_MTM')).toBe('neutral');

        expect(reasonTone('STALE_QUOTE')).toBe('warning');
        expect(reasonTone('NO_QUOTE')).toBe('warning');
        expect(reasonTone('MATURED')).toBe('warning');
        expect(reasonTone('PROVIDER_WINDOW')).toBe('warning');
    });

    it('só os motivos de dado ausente contam como zero nosso', () => {
        expect(isZeroedByData('STALE_QUOTE')).toBe(true);
        expect(isZeroedByData('FIXED_INCOME_MTM_PENDING')).toBe(true);
        expect(isZeroedByData('BOUGHT_TODAY')).toBe(false);
        expect(isZeroedByData('FIXED_INCOME_CURVE')).toBe(false);
    });
});
