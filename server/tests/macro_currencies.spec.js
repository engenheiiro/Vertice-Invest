import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import { macroDataService, isPlausibleUsd, isPlausibleBtc } from '../services/macroDataService.js';
import { externalMarketService } from '../services/externalMarketService.js';

// Incidente de 04/09/2026: a AwesomeAPI parou de responder, o `catch` vazio
// devolvia null, o gravador preservava o valor anterior e `lastUpdated` era
// carimbado assim mesmo. Dólar e BTC ficaram um dia inteiro no fechamento da
// véspera — na barra de indicadores E no multiplicador de posição dolarizada —
// sem log, sem flag e sem alarme. O contrato abaixo é o que impede a repetição.
//
// A ordem da cadeia (Yahoo → AwesomeAPI desde 05/09/2026) é deliberada e está
// coberta: a AwesomeAPI só era consultada para gastar uma chamada condenada.

const awesomeBody = (over = {}) => ({
    data: {
        USDBRL: { bid: '5.1263', pctChange: '0.519626' },
        BTCUSD: { bid: '79533.56', pctChange: '-2.137073' },
        ...over,
    },
});

const yahooBody = {
    usd: { value: 5.13, change: 0.5 },
    btc: { value: 79000, change: -2.1 },
};

describe('updateCurrencies — cadeia de fontes', () => {
    afterEach(() => vi.restoreAllMocks());

    it('Yahoo no ar → resolve tudo e nem chega na AwesomeAPI', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue(yahooBody);
        const awesome = vi.spyOn(macroDataService, '_fetchCurrenciesAwesome');

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBe(5.13);
        expect(out.btc).toBe(79000);
        expect(out.usdSource).toBe('Yahoo');
        expect(out.btcSource).toBe('Yahoo');
        expect(awesome).not.toHaveBeenCalled();
    });

    it('Yahoo fora → a AwesomeAPI cobre as duas moedas e a fonte fica declarada', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(axios, 'get').mockResolvedValue(awesomeBody());

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBeCloseTo(5.1263, 4);
        expect(out.btc).toBeCloseTo(79533.56, 2);
        expect(out.usdSource).toBe('AwesomeAPI');
        expect(out.btcSource).toBe('AwesomeAPI');
    });

    it('cobertura parcial: cada moeda guarda a sua própria fonte', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({ usd: yahooBody.usd });
        vi.spyOn(axios, 'get').mockResolvedValue(awesomeBody());

        const out = await macroDataService.updateCurrencies();

        expect(out.usdSource).toBe('Yahoo');       // primária resolveu o dólar
        expect(out.btcSource).toBe('AwesomeAPI');  // e a segunda completou o BTC
    });

    // O ponto do incidente: sem valor de hoje, o retorno é `null` — nunca o
    // valor da véspera disfarçado de cotação. Quem grava é que decide preservar
    // o último conhecido, e marca isso como defasado.
    it('as duas fontes fora → null nas duas moedas, sem número inventado', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('ETIMEDOUT'));

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBeNull();
        expect(out.btc).toBeNull();
        expect(out.usdSource).toBeNull();
        expect(out.btcSource).toBeNull();
    });

    it('valor implausível da primária é rejeitado e a segunda assume', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({
            usd: { value: 0, change: 0 },   // fonte devolveu lixo
            btc: yahooBody.btc,
        });
        vi.spyOn(axios, 'get').mockResolvedValue(awesomeBody());

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBeCloseTo(5.1263, 4);
        expect(out.usdSource).toBe('AwesomeAPI');
        expect(out.btcSource).toBe('Yahoo'); // o BTC da primária estava bom
    });
});

describe('_fetchCurrenciesAwesome — corpo inesperado', () => {
    afterEach(() => vi.restoreAllMocks());

    // Rate-limit da AwesomeAPI responde HTTP 200 com outro corpo. Antes, o acesso
    // a `.bid` lançava TypeError e caía no mesmo catch da queda de rede: silêncio
    // idêntico para duas causas que pedem conserto diferente.
    it('resposta de rate-limit (200 sem os pares) vira null, não exceção', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { status: 429, code: 'RateLimit' } });
        await expect(macroDataService._fetchCurrenciesAwesome()).resolves.toBeNull();
    });

    it('payload sem BTC não devolve meia leitura silenciosa', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { USDBRL: { bid: '5.12', pctChange: '0.5' } } });
        await expect(macroDataService._fetchCurrenciesAwesome()).resolves.toBeNull();
    });
});

describe('faixas de plausibilidade das moedas', () => {
    it('barra o que não pode virar multiplicador de patrimônio', () => {
        expect(isPlausibleUsd(5.1263)).toBe(true);
        expect(isPlausibleUsd(0)).toBe(false);
        expect(isPlausibleUsd(NaN)).toBe(false);
        expect(isPlausibleUsd(120)).toBe(false);

        expect(isPlausibleBtc(79533.56)).toBe(true);
        expect(isPlausibleBtc(0)).toBe(false);
        expect(isPlausibleBtc(12)).toBe(false);
    });
});
