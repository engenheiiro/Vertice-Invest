/**
 * O PROBE PRECISA DATAR O PREÇO, NÃO SÓ ENCONTRÁ-LO.
 *
 * Até 05/09/2026 o veredito era `probeHasPrice`: qualquer fonte devolvendo um
 * número virava "✅ RECUPERA — falha transitória; reativa sozinho". Isso deu o
 * resultado exatamente invertido em AVB e EQR (fundidos em VMRK) e EA (fechou
 * capital): o `meta` do Yahoo serve a última cotação de símbolo extinto por tempo
 * indeterminado, e a página do Google faz o mesmo. Os três estavam mortos desde
 * agosto e o script os preservava.
 *
 * A régua nova tem dois lados que este arquivo trava:
 *  - condena com evidência POSITIVA (uma data velha), nunca com ausência de dado;
 *  - preserva quando nenhuma fonte datou — o Google sozinho não condena ninguém,
 *    e é o que mantém papel vivo-mas-mal-servido (B3SA3) fora da baixa.
 */
import { describe, it, expect } from 'vitest';
import {
    classifyProbe,
    probeDaysSinceTrade,
    probeLastTradeAt,
    probeProvesTrading,
    PROBE_FRESH_DAYS,
} from '../scripts/lib/quoteProbe.js';

const diasAtras = (n) => new Date(Date.now() - n * 86400000);
const asset = { ticker: 'AVB', type: 'STOCK_US', name: 'AvalonBay Communities Inc' };

const probe = (over = {}) => ({
    ticker: 'AVB', type: 'STOCK_US', ySym: 'AVB',
    yQuote: null, yQuoteAt: null, yChart: null, chartMetaAt: null,
    google: null, googleEx: null, search: [],
    ...over,
});

describe('datação do último negócio', () => {
    it('vale a mais recente das três fontes que datam', () => {
        const p = probe({
            yQuoteAt: diasAtras(30),
            chartMetaAt: diasAtras(3),
            yChart: { close: 10, date: diasAtras(12) },
        });
        expect(probeDaysSinceTrade(p)).toBe(3);
    });

    it('null quando nenhuma fonte datou (só Google)', () => {
        const p = probe({ google: 184.06, googleEx: ':NYSE' });
        expect(probeLastTradeAt(p)).toBeNull();
        expect(probeDaysSinceTrade(p)).toBeNull();
    });

    it('lê o meta do chart mesmo sem candle nenhum', () => {
        // O caso AVB: `quotes` vazio, `meta.regularMarketTime` de 22 dias atrás.
        expect(probeDaysSinceTrade(probe({ chartMetaAt: diasAtras(22) }))).toBe(22);
    });
});

describe('prova de negociação', () => {
    it('preço datado dentro da janela prova vida', () => {
        expect(probeProvesTrading(probe({ yQuote: 17.4, yQuoteAt: diasAtras(1) }))).toBe(true);
    });

    it('preço datado fora da janela NÃO prova vida', () => {
        expect(probeProvesTrading(probe({ yQuote: 184.06, yQuoteAt: diasAtras(PROBE_FRESH_DAYS + 1) }))).toBe(false);
    });

    it('preço sem datação preserva o papel (fail-safe)', () => {
        expect(probeProvesTrading(probe({ google: 17.37, googleEx: ':BVMF' }))).toBe(true);
    });

    it('sem preço em fonte nenhuma não prova nada', () => {
        expect(probeProvesTrading(probe())).toBe(false);
    });
});

describe('veredito', () => {
    it('o caso AVB sai como ECO, não como RECUPERA', () => {
        const p = probe({
            chartMetaAt: diasAtras(22),
            yChart: { close: 68.14, date: diasAtras(12) },
            search: [{ symbol: 'VMRK', name: 'Vivmark Residential', exch: 'NYSE' }],
        });
        const v = classifyProbe(asset, p);
        expect(v.code).toBe('STALE_ECHO');
        expect(v.label).toContain('VMRK');
    });

    it('papel vivo continua RECUPERA', () => {
        const v = classifyProbe(asset, probe({ yQuote: 320, yQuoteAt: diasAtras(0) }));
        expect(v.code).toBe('RECOVERS');
    });

    it('sem preço e sem busca segue MORTO', () => {
        expect(classifyProbe(asset, probe()).code).toBe('DEAD');
    });

    it('sem preço mas com o próprio símbolo na busca segue SEARCH_ONLY', () => {
        const p = probe({ search: [{ symbol: 'AVB', name: 'AvalonBay', exch: 'NYSE' }] });
        expect(classifyProbe(asset, p).code).toBe('SEARCH_ONLY');
    });
});
