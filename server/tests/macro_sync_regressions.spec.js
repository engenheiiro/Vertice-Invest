import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regressões do macro-sync: câmbio não numérico gravado como se fosse cotação e
// início da consulta da Selic diária calculado no fuso do processo. Nada toca
// banco nem rede: modelos, fontes e axios mockados.

const h = vi.hoisted(() => ({ saved: null, lastEntry: null }));

vi.mock('../config/logger.js', () => ({ default: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } }));
vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../models/SystemConfig.js', () => {
    function SystemConfig(init) { Object.assign(this, init); }
    SystemConfig.prototype.save = async function save() { h.saved = { ...this }; };
    SystemConfig.findOne = () => {
        const chain = {
            select: () => chain,
            lean: async () => null,
            then: (res, rej) => Promise.resolve(Object.assign(Object.create(SystemConfig.prototype), {
                key: 'MACRO_INDICATORS', dollar: 5.2, dollarChange: 0.1, currenciesStale: false,
            })).then(res, rej),
        };
        return chain;
    };
    return { default: SystemConfig };
});
vi.mock('../models/EconomicIndex.js', () => ({
    default: { findOne: () => ({ sort: async () => h.lastEntry }) },
}));

import axios from 'axios';
import { macroDataService } from '../services/macroDataService.js';
import { externalMarketService } from '../services/externalMarketService.js';

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T14:00:00-03:00'));
    h.saved = null;
    h.lastEntry = null;
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const syncWithUsd = async (usd) => {
    vi.spyOn(macroDataService, 'updateOfficialRates').mockResolvedValue(null);
    vi.spyOn(macroDataService, 'syncDailyEconomicIndexes').mockResolvedValue(undefined);
    vi.spyOn(macroDataService, 'computeCdiReturn12m').mockResolvedValue(null);
    vi.spyOn(macroDataService, 'updateTreasuryRates').mockResolvedValue(null);
    vi.spyOn(macroDataService, 'updateCurrencies').mockResolvedValue({
        usd, usdChange: 0.4, usdSource: 'Yahoo', btc: 95000, btcChange: 1, btcSource: 'Yahoo',
    });
    vi.spyOn(externalMarketService, 'getGlobalIndices').mockResolvedValue(null);
    vi.spyOn(externalMarketService, 'getSpx12mReturn').mockResolvedValue(null);
    vi.spyOn(externalMarketService, 'getIbov12mReturn').mockResolvedValue(null);
    await macroDataService.performMacroSync();
    return h.saved;
};

describe('performMacroSync — câmbio que não é número', () => {
    it.each([
        ['undefined', undefined],
        ['NaN', NaN],
        ['texto', '5.3'],
        ['Infinity', Infinity],
    ])('usd %s não grava dollar e marca o câmbio defasado (era gravado como cotação fresca)', async (_nome, usd) => {
        const saved = await syncWithUsd(usd);
        expect(saved.dollar).toBe(5.2);
        expect(saved.dollarChange).toBe(0.1);
        expect(saved.currenciesStale).toBe(true);
        expect(saved.currenciesUpdatedAt).toBeUndefined();
    });

    it('usd numérico continua gravado', async () => {
        const saved = await syncWithUsd(5.33);
        expect(saved.dollar).toBe(5.33);
        expect(saved.currenciesStale).toBe(false);
    });
});

// O defeito só aparece com o processo FORA de UTC (rodar também com
// `TZ=America/Sao_Paulo`): em Brasília a meia-noite UTC do último registro é
// 21h do dia anterior, e `setDate` + `toLocaleDateString` no fuso local pediam
// ao BCB a partir do próprio dia já gravado. Em UTC (Render) o teste passa nos
// dois códigos.
describe('syncDailyEconomicIndexes — início da consulta ao BCB', () => {
    it('começa no dia seguinte ao último gravado em UTC (em Brasília começava no próprio dia gravado)', async () => {
        h.lastEntry = { date: new Date('2026-11-16T00:00:00.000Z') };
        vi.spyOn(macroDataService, '_oldestLegacySyntheticSelicDate').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'processDailyData').mockResolvedValue(undefined);
        const urls = [];
        vi.spyOn(axios, 'get').mockImplementation(async (url) => { urls.push(url); return { data: [] }; });
        await macroDataService.syncDailyEconomicIndexes();
        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain('dataInicial=17/11/2026');
    });
});
