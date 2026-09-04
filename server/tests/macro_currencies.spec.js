import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import { macroDataService, isPlausibleUsd, isPlausibleBtc } from '../services/macroDataService.js';
import { externalMarketService } from '../services/externalMarketService.js';

// Incidente de 04/09/2026: a AwesomeAPI parou de responder, o `catch` vazio
// devolvia null, o gravador preservava o valor anterior e `lastUpdated` era
// carimbado assim mesmo. Dólar e BTC ficaram um dia inteiro no fechamento da
// véspera — na barra de indicadores E no multiplicador de posição dolarizada —
// sem log, sem flag e sem alarme. O contrato abaixo é o que impede a repetição.

const awesomeBody = (over = {}) => ({
    data: {
        USDBRL: { bid: '5.1263', pctChange: '0.519626' },
        BTCUSD: { bid: '79533.56', pctChange: '-2.137073' },
        ...over,
    },
});

describe('updateCurrencies — fontes e frescor', () => {
    afterEach(() => vi.restoreAllMocks());

    it('AwesomeAPI no ar → usa a primária e nem consulta o Yahoo', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue(awesomeBody());
        const yahoo = vi.spyOn(externalMarketService, 'getCurrencyQuotes');

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBeCloseTo(5.1263, 4);
        expect(out.btc).toBeCloseTo(79533.56, 2);
        expect(out.usdSource).toBe('AwesomeAPI');
        expect(out.btcSource).toBe('AwesomeAPI');
        expect(yahoo).not.toHaveBeenCalled();
    });

    it('AwesomeAPI fora → o Yahoo cobre as duas moedas e a fonte fica declarada', async () => {
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('ETIMEDOUT'));
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({
            usd: { value: 5.13, change: 0.5 },
            btc: { value: 79000, change: -2.1 },
        });

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBe(5.13);
        expect(out.btc).toBe(79000);
        expect(out.usdSource).toBe('Yahoo');
        expect(out.btcSource).toBe('Yahoo');
    });

    it('cobertura parcial: cada moeda guarda a sua própria fonte', async () => {
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('ECONNRESET'));
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({
            usd: { value: 5.13, change: 0.5 },
        });

        const out = await macroDataService.updateCurrencies();

        expect(out.usdSource).toBe('Yahoo');
        expect(out.btc).toBeNull();     // não temos BTC de hoje
        expect(out.btcSource).toBeNull();
    });

    // O ponto do incidente: sem valor de hoje, o retorno é `null` — nunca o
    // valor da véspera disfarçado de cotação. Quem grava é que decide preservar
    // o último conhecido, e marca isso como defasado.
    it('as duas fontes fora → null nas duas moedas, sem número inventado', async () => {
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('ETIMEDOUT'));
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBeNull();
        expect(out.btc).toBeNull();
        expect(out.usdSource).toBeNull();
        expect(out.btcSource).toBeNull();
    });

    it('valor implausível da primária é rejeitado e o Yahoo assume', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue(awesomeBody({
            USDBRL: { bid: '0', pctChange: '0' },
        }));
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({
            usd: { value: 5.13, change: 0.5 },
        });

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBe(5.13);
        expect(out.usdSource).toBe('Yahoo');
        expect(out.btcSource).toBe('AwesomeAPI'); // o BTC da primária estava bom
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
