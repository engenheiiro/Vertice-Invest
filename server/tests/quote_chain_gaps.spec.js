/**
 * TRÊS BURACOS DA CADEIA DE COTAÇÃO, medidos em 04/09/2026 com o painel de
 * trajeto por ativo. Os três se manifestavam do mesmo jeito na tela — "sem preço
 * em fonte nenhuma" — e tinham causas sem nenhuma relação entre si.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { B3_TICKER_RE, isB3Ticker } from '../utils/tickerShape.js';
import { B3_TICKER_RE as REEXPORTADA } from '../services/b3HistoryFallback.js';

describe('forma do ticker B3 — regra única', () => {
    it('aceita as formas que existem no pregão', () => {
        for (const t of ['PETR4', 'ITSA4', 'HGLG11', 'BOVA11', 'B3SA3', 'AXIA7']) {
            expect(isB3Ticker(t), t).toBe(true);
        }
    });

    // EQMA3B ficava fora: a regex parava no dígito, o ticker não era reconhecido
    // como B3, ia ao Yahoo sem `.SA` e ao Google como se fosse NASDAQ, e nunca
    // chegava à Brapi. Não era papel morto — `EQMA3B.SA` responde 29,24.
    it('aceita a letra de classe no fim (EQMA3B, MRSA3B)', () => {
        expect(isB3Ticker('EQMA3B')).toBe(true);
        expect(isB3Ticker('MRSA3B')).toBe(true);
    });

    it('não confunde com papel de fora da B3', () => {
        for (const t of ['AAPL', 'BRK.B', 'BTC-USD', 'VOO', 'MSFT']) {
            expect(isB3Ticker(t), t).toBe(false);
        }
    });

    // Havia três cópias desta regra e elas divergiram: a do serviço aceitava
    // B3SA3, a do fallback de candle não — e a bolsa ficava fora do próprio
    // reforço da B3, sem nada avisar.
    it('o fallback de candle usa a MESMA regra do serviço de cotação', () => {
        expect(REEXPORTADA).toBe(B3_TICKER_RE);
    });
});

describe('Google Finance — bolsa certa para papel americano', () => {
    beforeEach(() => vi.resetModules());

    const carregar = async (paginas) => {
        vi.doMock('axios', () => ({
            default: {
                get: vi.fn(async (url) => {
                    const html = paginas[url];
                    if (!html) return { data: '<html><body>sem cotação</body></html>' };
                    return { data: html };
                }),
            },
        }));
        vi.doMock('../config/logger.js', () => ({
            default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        }));
        const mod = await import('../services/externalMarketService.js');
        return mod.externalMarketService;
    };

    const pagina = (preco) => `<html><body><div class="N6SYTe">US$ ${preco}</div></body></html>`;

    // Mais da metade do S&P 500 é NYSE, e a URL fixava :NASDAQ — uma página que
    // existe e não traz preço. Medido: AVB devolveu US$ 184,06 em :NYSE e nada
    // em :NASDAQ. O fallback US falhava por endereço errado, não por falta de dado.
    it('cai para NYSE quando a página do NASDAQ vem sem cotação', async () => {
        const svc = await carregar({
            'https://www.google.com/finance/quote/AVB:NYSE': pagina('184,06'),
        });
        const r = await svc.fetchFromGoogleFinance('AVB');
        expect(r?.price).toBe(184.06);
    });

    it('papel da B3 continua indo direto para :BVMF', async () => {
        const svc = await carregar({
            'https://www.google.com/finance/quote/PETR4:BVMF': pagina('47,11'),
        });
        const r = await svc.fetchFromGoogleFinance('PETR4');
        expect(r?.price).toBe(47.11);
    });

    // Descobrir a bolsa custa até três requisições; repetir isso a cada ciclo de
    // 15 minutos para o universo inteiro, não. A bolsa de um papel não muda.
    it('lembra a bolsa que funcionou e não varre de novo', async () => {
        const svc = await carregar({
            'https://www.google.com/finance/quote/EQR:NYSE': pagina('63,66'),
        });
        const axios = (await import('axios')).default;
        await svc.fetchFromGoogleFinance('EQR');
        const apos1a = axios.get.mock.calls.length;
        await svc.fetchFromGoogleFinance('EQR');
        expect(axios.get.mock.calls.length - apos1a).toBe(1);
    });

    it('sem preço em bolsa nenhuma devolve null', async () => {
        const svc = await carregar({});
        expect(await svc.fetchFromGoogleFinance('ZZZZ')).toBeNull();
    });
});
