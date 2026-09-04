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
// A ordem da cadeia (Yahoo → AwesomeAPI → Coinbase → PTAX) é deliberada e está
// coberta: as duas últimas são especialistas de uma moeda só, e existem porque
// as duas primeiras já falharam JUNTAS a partir do host de produção.

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
    it('cadeia inteira fora → null nas duas moedas, sem número inventado', async () => {
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

describe('_fetchBtcCoinbase — rede final do bitcoin', () => {
    afterEach(() => vi.restoreAllMocks());

    it('deriva a variação de 24h da abertura da própria janela', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { last: '79762.41', open: '81771.62' } });

        const out = await macroDataService._fetchBtcCoinbase();

        expect(out.btc).toBeCloseTo(79762.41, 2);
        expect(out.btcChange).toBeCloseTo(-2.457, 2);
    });

    it('sem abertura utilizável, entrega o preço e variação zero em vez de NaN', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { last: '79762.41', open: '0' } });
        const out = await macroDataService._fetchBtcCoinbase();
        expect(out.btc).toBeCloseTo(79762.41, 2);
        expect(out.btcChange).toBe(0);
    });

    it('corpo inesperado vira null, não exceção', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { message: 'NotFound' } });
        await expect(macroDataService._fetchBtcCoinbase()).resolves.toBeNull();
    });

    // O buraco que ela fecha: em 04/09/2026 as duas primeiras fontes falharam
    // juntas a partir do host e o BTC ficou sem ninguém — a PTAX cobre só dólar.
    it('na cadeia, cobre o BTC quando as duas primeiras caem juntas', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(macroDataService, '_fetchCurrenciesAwesome').mockResolvedValue(null);
        vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue({ btc: 79762.41, btcChange: -2.45 });
        vi.spyOn(macroDataService, '_fetchPtaxUsd').mockResolvedValue({ usd: 5.1253, usdChange: 0.57 });

        const out = await macroDataService.updateCurrencies();

        expect(out.btcSource).toBe('Coinbase');
        expect(out.usdSource).toBe('PTAX/BCB');
        expect(out.btc).toBeCloseTo(79762.41, 2);
        expect(out.usd).toBe(5.1253);
    });
});

describe('_fetchPtaxUsd — rede final, só dólar e só do dia', () => {
    afterEach(() => vi.restoreAllMocks());

    const ptax = (dia, venda) => ({ dataHoraCotacao: `${dia} 13:03:59.556874`, cotacaoVenda: venda });
    const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

    it('fixação de hoje é aceita, com a variação medida sobre a anterior', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({
            data: { value: [ptax('2026-09-03', 5.0962), ptax(hojeBr(), 5.1253)] },
        });

        const out = await macroDataService._fetchPtaxUsd();

        expect(out.usd).toBe(5.1253);
        expect(out.usdChange).toBeCloseTo(0.571, 2); // 5,1253 / 5,0962 − 1
    });

    // A PTAX é FIXAÇÃO, não cotação viva: o boletim sai ~13h BRT e antes disso o
    // dia corrente não existe na série. Servir a última linha disponível seria
    // exatamente o defeito de 04/09/2026 — câmbio de ontem com cara de hoje.
    it('fixação de ontem é RECUSADA em vez de virar cotação de hoje', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({
            data: { value: [ptax('2026-09-02', 5.1273), ptax('2026-09-03', 5.0962)] },
        });

        await expect(macroDataService._fetchPtaxUsd()).resolves.toBeNull();
    });

    it('série vazia vira null, não exceção', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { value: [] } });
        await expect(macroDataService._fetchPtaxUsd()).resolves.toBeNull();
    });

    it('na cadeia, cobre o dólar e deixa o BTC declaradamente ausente', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(macroDataService, '_fetchCurrenciesAwesome').mockResolvedValue(null);
        vi.spyOn(axios, 'get').mockResolvedValue({
            data: { value: [ptax('2026-09-03', 5.0962), ptax(hojeBr(), 5.1253)] },
        });

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBe(5.1253);
        expect(out.usdSource).toBe('PTAX/BCB');
        expect(out.btc).toBeNull();      // o BCB não cota cripto
        expect(out.btcSource).toBeNull();
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
