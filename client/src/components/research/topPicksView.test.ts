import { describe, expect, it } from 'vitest';
import type { RankingItem } from '../../services/research';
import {
    cryptoAvgCapText, donutDash, filterPicks, hasBuyInScope, pickPosition, pickSectorSlices, pickStats, walletSectorSlices,
} from './topPicksView';

const mk = (ticker: string, over: Partial<RankingItem> = {}): RankingItem => ({
    position: 1, ticker, name: ticker, sector: 'Bancos', type: 'STOCK', action: 'BUY', currentPrice: 10, targetPrice: 12,
    score: 80, probability: 0.8, riskProfile: 'DEFENSIVE', thesis: '', reason: '',
    metrics: { dy: 6, marketCap: 2e9, structural: { quality: 50, valuation: 50, risk: 50 } },
    ...over,
} as RankingItem);

describe('topPicksView — regras do Top 10', () => {
    it('filtra pelo perfil, ordena por score sem mexer no array recebido e numera dentro do filtro', () => {
        const picks = [mk('A', { score: 60 }), mk('B', { score: 90 }), mk('C', { riskProfile: 'BOLD', score: 99 })];
        const antes = picks.map((p) => p.ticker);
        const out = filterPicks(picks, 'DEFENSIVE', false, 'US');
        expect(out.map((p) => [p.ticker, p.visualPosition])).toEqual([['B', 1], ['A', 2]]);
        expect(picks.map((p) => p.ticker)).toEqual(antes);
        expect(filterPicks(Array.from({ length: 15 }, (_, i) => mk(`X${i}`)), 'DEFENSIVE', false, 'US')).toHaveLength(10);
    });

    it('aba ETFs: Nacional é type ETF, Internacional é o resto; o Aporte segue a origem, não o perfil', () => {
        const picks = [mk('BOVA11', { type: 'ETF', action: 'WAIT' }), mk('VOO', { type: 'STOCK_US', riskProfile: 'BOLD' })];
        expect(filterPicks(picks, 'DEFENSIVE', true, 'BR').map((p) => p.ticker)).toEqual(['BOVA11']);
        expect(filterPicks(picks, 'DEFENSIVE', true, 'US')).toEqual([]);
        expect(hasBuyInScope(picks, true, 'BR')).toBe(false);
        expect(hasBuyInScope(picks, true, 'US')).toBe(true);
        expect(hasBuyInScope(picks, false, 'BR')).toBe(true);
    });

    it('meta da carteira ideal: 1/nº de COMPRAR; AGUARDAR tem meta 0; posição zerada conta como sem posição', () => {
        const assets = [{ ticker: 'A', quantity: 10, totalValue: 30000 }, { ticker: 'B', quantity: 0, totalValue: 999 }];
        const a = pickPosition(mk('A'), assets, 100000, 4);
        expect(a).toMatchObject({ isBuyPick: true, userAllocPercent: 30, idealPercent: 25, idealValue: 25000, rebalanceDelta: 5000 });
        expect(pickPosition(mk('B'), assets, 100000, 4).held).toBeNull();
        expect(pickPosition(mk('A', { action: 'WAIT' }), assets, 100000, 4)).toMatchObject({ idealPercent: 0, rebalanceDelta: 30000 });
        expect(pickPosition(mk('A'), assets, 0, 4).userAllocPercent).toBe(0);
    });

    it('resumo: médias de score e yield; market cap médio da cripto em bilhões', () => {
        expect(pickStats([])).toEqual({ avgScore: 0, avgDy: 0, count: 0 });
        expect(pickStats([mk('A', { score: 81 }), mk('B', { score: 70 })])).toEqual({ avgScore: 76, avgDy: '6.00', count: 2 });
        expect(cryptoAvgCapText([mk('A'), mk('B', { metrics: { dy: 0, marketCap: 0 } as RankingItem['metrics'] })])).toBe('$1.0B');
        expect(cryptoAvgCapText([])).toBe('-');
    });

    it('setores: carteira por valor (Brasil 10 junta ações e FIIs), ideal por contagem, rosquinha acumulada', () => {
        const assets = [
            { type: 'STOCK', sector: 'Bancos', totalValue: 300 },
            { type: 'FII', totalValue: 100 },
            { type: 'CRYPTO', sector: 'Moedas', totalValue: 999 },
        ];
        expect(walletSectorSlices(assets, 'BRASIL_10')?.map((s) => [s.name, s.percent])).toEqual([['Bancos', 75], ['Outros', 25]]);
        expect(walletSectorSlices(assets, 'STOCK_US')).toBeNull();
        const slices = pickSectorSlices([mk('A'), mk('B'), mk('C', { sector: undefined })]);
        expect(slices.map((s) => s.name)).toEqual(['Bancos', 'Outros']);
        expect(donutDash(slices, 0)).toEqual({ dash: `${slices[0].percent} ${100 - slices[0].percent}`, offset: 125 });
        expect(donutDash(slices, 1).offset).toBeCloseTo(100 - 200 / 3 + 25, 9);
    });
});
