import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Partes extraídas do macroDataService: cada módulo com o seu contrato curto.

const h = vi.hoisted(() => ({ escalations: [] }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/sourceHealth.js', () => ({ recordEscalation: (ev) => { h.escalations.push(ev); } }));

import { applyMacroReadings } from '../services/macro/macroConfigWriter.js';
import {
    collectOfficialRates, applyMissingRatesFallback, buildOfficialRatesResult, reportRatesEscalations,
} from '../services/macro/officialRates.js';
import { parseNtnbFromCsv, isPlausibleNtnbRate } from '../services/macro/ntnbRate.js';
import { normalizeUsdEntries, mergeUsdHistory } from '../services/macro/usdHistory.js';
import { reportCurrencyEscalations } from '../services/macro/currencyLedger.js';
import { classifyBond, isReferenceNtnbTitle, looksLikeBondTitle } from '../services/macro/treasuryCatalog.js';

const AGORA = new Date('2026-11-18T17:00:00Z');
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    h.escalations = [];
});
afterEach(() => vi.useRealTimers());

describe('macroConfigWriter.applyMacroReadings', () => {
    const failed = {
        official: { selic: 13.75, cdi: 13.65, ipca: null, isFallback: true, selicIsFallback: true, ipcaIsFallback: true, selicFrozen: false },
        currencies: { usd: null, btc: null, usdSource: null, btcSource: null },
        globalIndices: null,
        cdiReturn12m: null, spxReturn12m: NaN, ibovReturn12m: undefined,
        treasury: { ntnbLong: null, ntnbSource: null },
    };

    it('fonte que falhou deixa o valor gravado e marca defasado', () => {
        const config = { selic: 11, ipca: 4.1, dollar: 5, btc: 90000, ibov: 1, ntnbLong: 6.6, cdiReturn12m: 10, ratesSources: { ntnb: 'X' } };
        applyMacroReadings(config, failed);
        expect(config).toMatchObject({ selic: 11, ipca: 4.1, dollar: 5, btc: 90000, ibov: 1, ntnbLong: 6.6, cdiReturn12m: 10 });
        expect(config).toMatchObject({ ratesStale: true, currenciesStale: true, indicesStale: true });
        expect(config.ratesSources).toEqual({ selic: null, ipca: null, ntnb: 'X' });
        expect(config.ratesUpdatedAt).toBeUndefined();
        expect(config.lastUpdated).toEqual(AGORA);
    });

    it('tudo fresco grava e carimba cada bloco', () => {
        const config = {};
        applyMacroReadings(config, {
            official: { selic: 15, cdi: 14.9, ipca: 4.6, isFallback: false, selicIsFallback: false, ipcaIsFallback: false, selicFrozen: false,
                sources: { selic: 'BCB', ipca: 'BCB' },
            },
            currencies: { usd: 5.3, usdChange: 0.1, usdSource: 'Yahoo', btc: 95000, btcChange: 1, btcSource: 'Yahoo' },
            globalIndices: { ibov: { value: 130000, change: 0.4, source: 'Yahoo' }, spx: { value: 6000, change: 0.2, source: 'Yahoo' } },
            cdiReturn12m: 14.1, spxReturn12m: 18, ibovReturn12m: 9,
            treasury: { ntnbLong: 7.1, ntnbSource: 'TesouroTransparente' },
        });
        expect(config).toMatchObject({ selic: 15, cdi: 14.9, riskFree: 15, ipca: 4.6, dollar: 5.3, btc: 95000, ntnbLong: 7.1, ratesStale: false });
        expect(config.ratesSources).toEqual({ selic: 'BCB', ipca: 'BCB', ntnb: 'TesouroTransparente' });
        expect([config.ratesUpdatedAt, config.currenciesUpdatedAt, config.indicesUpdatedAt]).toEqual([AGORA, AGORA, AGORA]);
    });
});

describe('officialRates', () => {
    it('BCB completo não chama reserva; IPCA faltante desce até o IBGE', async () => {
        const service = { fetchRatesFromBrasilApi: vi.fn(async () => ({ selic: null, ipca: null })), fetchIpcaFromIbge: vi.fn(async () => 4.9) };
        const full = await collectOfficialRates(service, { selic: 15, ipca: 4.6 });
        expect(service.fetchRatesFromBrasilApi).not.toHaveBeenCalled();
        expect(full.trilha).toEqual({ selic: ['bcb.series'], ipca: ['bcb.series'] });
        const partial = await collectOfficialRates(service, { selic: 15, ipca: null });
        expect(partial).toMatchObject({ ipca: 4.9, ipcaSource: 'IBGE', trilha: { ipca: ['bcb.series', 'brasilapi', 'ibge'] } });
    });

    it('sem fonte: Selic fica na última boa, IPCA null, nada inventado', () => {
        const reading = { selic: null, ipca: null, selicSource: null, ipcaSource: null, trilha: { selic: [], ipca: [] } };
        const flags = applyMissingRatesFallback(reading, 0);
        const out = buildOfficialRatesResult(reading, flags, false);
        expect(out).toMatchObject({ selic: null, ipca: null, cdi: null, isFallback: true, sources: { selic: 'fallback', ipca: 'fallback' } });
    });

    it('trilha: resolvido de primeira não vira escalada; congelado vira', () => {
        const reading = { selicSource: 'BrasilAPI', ipcaSource: 'BCB', trilha: { selic: ['bcb.series', 'brasilapi'], ipca: ['bcb.series'] } };
        reportRatesEscalations(reading, true, 13.75);
        expect(h.escalations).toHaveLength(1);
        expect(h.escalations[0]).toMatchObject({ chain: 'rates', subject: 'SELIC', resolvedBy: null });
    });
});

describe('ntnbRate.parseNtnbFromCsv', () => {
    const head = 'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha';
    it('escada 2035→2060 na Data Base mais recente, taxa de venda', () => {
        const csv = [head, 'Tesouro IPCA+;15/05/2035;17/11/2026;6,9;7,0', 'Tesouro IPCA+;15/05/2045;18/11/2026;6,8;6,95'].join('\r\n');
        expect(parseNtnbFromCsv(csv)).toBe(6.95);
    });
    it('implausível, Educa+ ou cabeçalho sem taxa → null', () => {
        expect(parseNtnbFromCsv([head, 'Tesouro IPCA+;15/05/2035;18/11/2026;12;12,4'].join('\n'))).toBeNull();
        expect(parseNtnbFromCsv([head, 'Tesouro Educa+ IPCA+;15/05/2040;18/11/2026;6;6,5'].join('\n'))).toBeNull();
        expect(parseNtnbFromCsv('Tipo Titulo;Data Vencimento;Data Base\nTesouro IPCA+;15/05/2040;18/11/2026')).toBeNull();
        expect(isPlausibleNtnbRate(9.5)).toBe(true);
    });
});

describe('usdHistory', () => {
    it('descarta entrada inválida e une ao gravado com o novo vencendo', () => {
        const incoming = normalizeUsdEntries([
            { date: '2026-11-12', close: '5.4', adjClose: 0 }, { date: '2026-1-1', close: 5 }, null, { date: '2026-11-13', close: -1 },
        ]);
        expect([...incoming.values()]).toEqual([{ date: '2026-11-12', close: 5.4, adjClose: 5.4 }]);
        const history = mergeUsdHistory([{ date: '2026-11-12', close: 9 }, { date: '2026-11-11', close: 5.3 }, { close: 1 }], incoming);
        expect(history.map((e) => [e.date, e.close])).toEqual([['2026-11-11', 5.3], ['2026-11-12', 5.4]]);
    });
});

describe('currencyLedger.reportCurrencyEscalations', () => {
    it('só registra a moeda que precisou de reserva ou ficou sem fonte', () => {
        reportCurrencyEscalations({
            trilha: { usd: ['yahoo.currencies'], btc: ['yahoo.currencies', 'coinbase'] },
            reading: { usdSource: 'Yahoo', btcSource: null },
            skipped: new Set(['ptax']),
            idByName: new Map([['Yahoo', 'yahoo.currencies']]),
        });
        expect(h.escalations).toEqual([expect.objectContaining({ chain: 'fx', subject: 'BTC', resolvedBy: null, skipped: ['ptax'] })]);
    });
});

describe('treasuryCatalog', () => {
    it('nome manda; índice declarado só quando o nome não diz', () => {
        expect(classifyBond('Tesouro Prefixado 2029', 'SELIC')).toEqual({ type: 'PREFIXADO', index: 'PRE' });
        expect(classifyBond('Tesouro Reserva 2036', 'SELIC')).toEqual({ type: 'SELIC', index: 'SELIC' });
        expect(classifyBond('Tesouro Renda+ 2065', 'PRE')).toEqual({ type: 'RENDAMAIS', index: 'IPCA' });
        expect(classifyBond('Tesouro IPCA+ 2035', null)).toEqual({ type: 'IPCA', index: 'IPCA' });
    });
    it('NTN-B de referência e célula de título', () => {
        expect(isReferenceNtnbTitle('IPCA', 'Tesouro IPCA+ 2035')).toBe(true);
        expect(isReferenceNtnbTitle('IPCA', 'Tesouro IPCA+ 2029')).toBe(false);
        expect(looksLikeBondTitle('Tesouro Selic 2031')).toBe(true);
        expect(looksLikeBondTitle('IPCA+')).toBe(false);
    });
});
