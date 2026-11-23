/**
 * Taxas macro: nenhuma constante nossa é gravada como dado real.
 *
 *  1. Selic/IPCA sem fonte → o valor gravado fica (antes: 14,25 / 4,50 por cima).
 *  2. CDI 12m é o ACUMULADO da série diária real, não `Selic de hoje − 0,10`.
 *  3. BCB fora → nenhuma linha sintética é gravada na série diária.
 *  4. NTN-B sem fonte e sem histórico → null, e o `ntnbLong` real fica.
 *  5. Câmbio: elo que não cobre a moeda faltante não é chamado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ configDoc: null, saved: null }));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/EconomicIndex.js', () => ({
    default: { findOne: vi.fn(), find: vi.fn(), bulkWrite: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('../models/SystemConfig.js', () => {
    function SystemConfig(init) { Object.assign(this, init); }
    SystemConfig.findOne = vi.fn((q) => {
        const chain = {
            select: () => chain,
            lean: async () => (h.configDoc ? { ...h.configDoc } : null),
            then: (res, rej) => Promise.resolve(h.configDoc
                ? Object.assign(Object.create({ save: async function () { h.saved = { ...this }; } }), h.configDoc)
                : null).then(res, rej),
        };
        return chain;
    });
    SystemConfig.prototype.save = async function () { h.saved = { ...this }; };
    return { default: SystemConfig };
});

import EconomicIndex from '../models/EconomicIndex.js';
import axios from 'axios';
import { macroDataService } from '../services/macroDataService.js';
import { externalMarketService } from '../services/externalMarketService.js';

// Relógio fixo: quarta-feira 18/11/2026, 14h de Brasília (dia útil, pregão aberto).
const AGORA = new Date('2026-11-18T14:00:00-03:00');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AGORA); });
afterEach(() => { vi.useRealTimers(); });

const DAY = 24 * 60 * 60 * 1000;

// 252 linhas diárias (dias corridos, simplificação) terminando em `newest`.
const dailyRows = (newest, annual, n = 252, stepDays = 1.45) => {
    const f = Math.pow(1 + annual / 100, 1 / 252);
    return Array.from({ length: n }, (_, i) => ({
        date: new Date(newest.getTime() - Math.round(i * stepDays) * DAY),
        value: (f - 1) * 100,
        accumulatedFactor: f,
    }));
};

afterEach(() => vi.restoreAllMocks());

describe('updateOfficialRates — sem fonte não inventa', () => {
    beforeEach(() => {
        vi.spyOn(macroDataService, '_fetchBcbSeries').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'fetchRatesFromBrasilApi').mockResolvedValue({ selic: null, ipca: null });
        vi.spyOn(macroDataService, 'fetchIpcaFromIbge').mockResolvedValue(null);
    });

    it('Selic sem fonte devolve a ÚLTIMA BOA, não a constante de fábrica', async () => {
        const out = await macroDataService.updateOfficialRates(11.75);
        expect(out.selic).toBe(11.75);
        expect(out.selicIsFallback).toBe(true);
        expect(out.ipca).toBeNull();
        expect(out.ipcaIsFallback).toBe(true);
        expect(out.isFallback).toBe(true);
    });

    it('sem âncora nenhuma → null (bootstrap não grava 14,25)', async () => {
        const out = await macroDataService.updateOfficialRates(null);
        expect(out.selic).toBeNull();
        expect(out.cdi).toBeNull();
    });

    it('não devolve mais cdi12m derivado da taxa de hoje', async () => {
        macroDataService._fetchBcbSeries.mockImplementation(async (_s, l) => (l === 'SELIC' ? 15 : 4.7));
        const out = await macroDataService.updateOfficialRates(15);
        expect(out).not.toHaveProperty('cdi12m');
        expect(out.cdi).toBeCloseTo(14.9, 6);
    });
});

describe('cdiReturn12mFromDailyRows — acumulado real ou nada', () => {
    const now = new Date('2026-11-20T00:00:00Z');

    it('compõe os 252 fatores diários', () => {
        const out = macroDataService.cdiReturn12mFromDailyRows(dailyRows(now, 14), now);
        expect(out).toBeCloseTo(14, 2);
    });

    it('menos de 252 dias úteis → null', () => {
        expect(macroDataService.cdiReturn12mFromDailyRows(dailyRows(now, 14, 200), now)).toBeNull();
    });

    it('série parada há mais de 10 dias → null', () => {
        const stale = new Date(now.getTime() - 15 * DAY);
        expect(macroDataService.cdiReturn12mFromDailyRows(dailyRows(stale, 14), now)).toBeNull();
    });

    it('buraco na janela (252 linhas espalhadas por mais de 13 meses) → null', () => {
        expect(macroDataService.cdiReturn12mFromDailyRows(dailyRows(now, 14, 252, 1.7), now)).toBeNull();
    });

    it('fator absurdo numa linha → null', () => {
        const rows = dailyRows(now, 14);
        rows[10].accumulatedFactor = 1.5;
        expect(macroDataService.cdiReturn12mFromDailyRows(rows, now)).toBeNull();
    });
});

describe('syncDailyEconomicIndexes — BCB fora não grava série sintética', () => {
    it('as duas chamadas ao BCB falham → nenhum bulkWrite', async () => {
        EconomicIndex.findOne.mockImplementation(() => ({
            sort: async () => ({ date: new Date(Date.now() - 5 * DAY) }),
        }));
        vi.spyOn(macroDataService, '_oldestLegacySyntheticSelicDate').mockResolvedValue(null);
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('BCB fora'));
        EconomicIndex.bulkWrite.mockClear();

        await macroDataService.syncDailyEconomicIndexes();

        expect(EconomicIndex.bulkWrite).not.toHaveBeenCalled();
        expect(macroDataService.generateSyntheticData).toBeUndefined();
    });

    it('linha sintética legada recua o ponto de retomada e é limpa depois', async () => {
        const legacy = new Date('2026-10-01T00:00:00Z');
        EconomicIndex.findOne.mockImplementation(() => ({ sort: async () => ({ date: new Date('2026-11-18T00:00:00Z') }) }));
        vi.spyOn(macroDataService, '_oldestLegacySyntheticSelicDate').mockResolvedValue(legacy);
        const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: [{ data: '01/10/2026', valor: '0.055131' }] });
        EconomicIndex.bulkWrite.mockResolvedValue({});
        EconomicIndex.deleteMany.mockResolvedValue({ deletedCount: 2 });

        await macroDataService.syncDailyEconomicIndexes();

        // Data UTC do registro, não a do fuso do processo (em Brasília saía 30/09).
        expect(get.mock.calls[0][0]).toContain('dataInicial=01/10/2026');
        expect(EconomicIndex.deleteMany).toHaveBeenCalledOnce();
        const filtro = EconomicIndex.deleteMany.mock.calls[0][0];
        expect(filtro.date.$gte).toEqual(legacy);
        expect(filtro.date.$nin).toEqual([new Date('2026-10-01')]);
    });
});

describe('updateTreasuryRates — sem fonte e sem histórico', () => {
    it('devolve null em vez do 6,3 de fábrica', async () => {
        vi.spyOn(macroDataService, 'fetchNtnbFromTesouroDireto').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'scrapeInvestidor10').mockResolvedValue([]);
        vi.spyOn(macroDataService, 'getLastKnownNtnbRate').mockResolvedValue(null);
        const out = await macroDataService.updateTreasuryRates();
        expect(out.ntnbLong).toBeNull();
    });
});

describe('performMacroSync — preserva o que não veio de fonte', () => {
    const prior = {
        key: 'MACRO_INDICATORS', selic: 11.75, ipca: 4.1, cdi: 11.65, riskFree: 11.75,
        cdiReturn12m: 12.3, ntnbLong: 7.1, ratesSources: { selic: 'BCB', ipca: 'BCB', ntnb: 'TesouroTransparente' },
    };

    beforeEach(() => {
        h.configDoc = { ...prior };
        h.saved = null;
        vi.spyOn(macroDataService, '_fetchBcbSeries').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'fetchRatesFromBrasilApi').mockResolvedValue({ selic: null, ipca: null });
        vi.spyOn(macroDataService, 'fetchIpcaFromIbge').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'syncDailyEconomicIndexes').mockResolvedValue();
        vi.spyOn(macroDataService, 'computeCdiReturn12m').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'updateCurrencies').mockResolvedValue({ usd: null, btc: null });
        vi.spyOn(macroDataService, 'updateTreasuryRates').mockResolvedValue({ ntnbLong: null, ntnbSource: null });
        vi.spyOn(externalMarketService, 'getGlobalIndices').mockResolvedValue({});
        vi.spyOn(externalMarketService, 'getSpx12mReturn').mockResolvedValue(null);
        vi.spyOn(externalMarketService, 'getIbov12mReturn').mockResolvedValue(null);
    });

    it('todas as fontes fora → Selic, IPCA, CDI, CDI 12m e NTN-B ficam como estavam; stale acende', async () => {
        await macroDataService.performMacroSync();
        expect(h.saved).toMatchObject({
            selic: 11.75, ipca: 4.1, cdi: 11.65, riskFree: 11.75, cdiReturn12m: 12.3, ntnbLong: 7.1, ratesStale: true,
        });
        expect(h.saved.ratesSources.ntnb).toBe('TesouroTransparente');
    });

    it('com a série diária completa, o CDI 12m gravado é o acumulado medido', async () => {
        macroDataService.computeCdiReturn12m.mockResolvedValue(13.42);
        await macroDataService.performMacroSync();
        expect(h.saved.cdiReturn12m).toBe(13.42);
    });
});

describe('updateCurrencies — elo que não cobre o que falta não é chamado', () => {
    it('só o dólar faltando: a Coinbase (só BTC) é pulada', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({ btc: { value: 80000, change: 1 } });
        const coinbase = vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue(null);
        vi.spyOn(macroDataService, '_fetchPtaxUsd').mockResolvedValue({ usd: 5.4, usdChange: 0.1 });
        vi.spyOn(macroDataService, '_fetchCurrenciesCoinbaseRates').mockResolvedValue(null);

        const out = await macroDataService.updateCurrencies();

        expect(coinbase).not.toHaveBeenCalled();
        expect(out.btc).toBe(80000);
        expect(out.usdSource).toBe('PTAX/BCB');
    });
});
