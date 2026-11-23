import { describe, expect, it } from 'vitest';
import {
    cdiFactorForDay,
    dayDividendCash,
    describeCoverageGaps,
    missingRebuildRates,
    nextQuota,
    rebuildWindow,
    requiredFromByTicker,
    resolveRebuildRates,
} from '../utils/rebuildHistoryRules.js';

const d = (s) => new Date(`${s}T12:00:00.000Z`);

describe('rebuildHistoryRules — regras puras do rebuild', () => {
    // Regra 13: sem macro, a taxa é AUSENTE — antes viravam IPCA 4,5 e dólar 5,75 gravados nos snapshots.
    it('taxas: sem macro, IPCA e câmbio ficam nulos (nada de default inventado); Selic só quando positiva', () => {
        const semMacro = resolveRebuildRates(null);
        expect(semMacro.currentIpcaRate).toBeNull();
        expect(semMacro.currentUsdRate).toBeNull();
        expect(semMacro.currentSelicRate).toBeUndefined();
        expect(resolveRebuildRates({ ipca: 0, selic: 15, dollar: 5.1 })).toMatchObject({ currentIpcaRate: null, currentSelicRate: 15, currentUsdRate: 5.1 });
    });

    it('taxa que falta só barra quando a carteira precisa dela', () => {
        const ipcaAsset = { ticker: 'NTNB', type: 'FIXED_INCOME', fixedIncomeIndex: 'ipca' };
        const usdAsset = { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD' };
        const semTaxa = { currentIpcaRate: null, currentUsdRate: null };
        expect(missingRebuildRates(semTaxa, { txs: [], userAssets: [{ ticker: 'PETR4', type: 'STOCK' }], usdSeries: false })).toEqual([]);
        expect(missingRebuildRates(semTaxa, { txs: [], userAssets: [ipcaAsset], usdSeries: true })).toEqual(['IPCA']);
        expect(missingRebuildRates(semTaxa, { txs: [], userAssets: [usdAsset], usdSeries: false })).toEqual(['câmbio USD/BRL']);
        // Com série de câmbio, o resolvedor usa candle real: a falta do spot não barra.
        expect(missingRebuildRates(semTaxa, { txs: [], userAssets: [usdAsset], usdSeries: true })).toEqual([]);
        // Ativo já vendido em dólar só aparece nas transações.
        expect(missingRebuildRates(semTaxa, { txs: [{ ticker: 'X', currency: 'USD' }], userAssets: [], usdSeries: false })).toEqual(['câmbio USD/BRL']);
        const comTaxa = { currentIpcaRate: 4.4, currentUsdRate: 5.1 };
        expect(missingRebuildRates(comTaxa, { txs: [], userAssets: [ipcaAsset, usdAsset], usdSeries: false })).toEqual([]);
    });

    it('profundidade exigida: primeira compra por ticker, sem renda fixa, caixa nem RESERVA', () => {
        const meta = new Map([['CDB', { type: 'FIXED_INCOME' }], ['CX', { type: 'CASH' }]]);
        const txs = [
            { ticker: 'PETR4', date: d('2026-03-10') }, { ticker: 'PETR4', date: d('2026-02-01') },
            { ticker: 'CDB', date: d('2026-01-01') }, { ticker: 'CX', date: d('2026-01-01') }, { ticker: 'RESERVA', date: d('2026-01-01') },
        ];
        expect([...requiredFromByTicker(txs, meta)]).toEqual([['PETR4', '2026-02-01']]);
    });

    it('frase de cobertura diz "nenhuma" quando não há série', () => {
        expect(describeCoverageGaps([{ ticker: 'X', requiredFrom: '2026-01-02', availableFrom: null }]))
            .toBe('X (posição desde 2026-01-02, série desde nenhuma)');
    });

    it('janela: sem throughDayKey vai até a véspera do dia corrente', () => {
        const { startDate, today } = rebuildWindow(d('2026-06-01'), null, '2026-07-01');
        expect([startDate.toISOString(), today.toISOString()]).toEqual(['2026-06-01T12:00:00.000Z', '2026-06-30T12:00:00.000Z']);
        expect(rebuildWindow(d('2026-06-01'), '2026-06-10', '2026-07-01').today.toISOString()).toBe('2026-06-10T12:00:00.000Z');
    });

    it('fator do CDI: do dia, senão do ano, senão 1.0003', () => {
        const mapa = new Map([['2026-06-05', 1.0006]]);
        expect(cdiFactorForDay(mapa, { 2026: 1.0005 }, d('2026-06-05'), '2026-06-05')).toBe(1.0006);
        expect(cdiFactorForDay(mapa, { 2026: 1.0005 }, d('2026-06-06'), '2026-06-06')).toBe(1.0005);
        expect(cdiFactorForDay(mapa, {}, d('2026-06-06'), '2026-06-06')).toBe(1.0003);
    });

    it('provento do dia só para quem tem posição, no câmbio do ticker', () => {
        const portfolio = { A: { qty: 10 }, B: { qty: 0 } };
        const fx = (t) => (t === 'A' ? 5 : 1);
        expect(dayDividendCash([{ ticker: 'A', amount: 0.2 }, { ticker: 'B', amount: 9 }, { ticker: 'C', amount: 9 }], portfolio, fx, '2026-06-01')).toBe(10);
    });

    it('cota: parada sem patrimônio, fluxo nem provento; retorno anômalo não move', () => {
        expect(nextQuota(100, { previousEquity: 0, equity: 0, flow: 0, dividendCash: 0 })).toBe(100);
        expect(nextQuota(100, { previousEquity: 1000, equity: 1010, flow: 0, dividendCash: 0 })).toBeCloseTo(101);
        expect(nextQuota(100, { previousEquity: 1000, equity: 5000, flow: 0, dividendCash: 0 })).toBe(100);
    });
});
