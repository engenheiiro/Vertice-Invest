/**
 * Conversão de tickers de ações com classe (BRK.B) entre o formato canônico do DB
 * (ponto) e o formato exigido pelo Yahoo Finance (hífen). Sem isso o Yahoo responde
 * "No data found" e o ativo nunca recebe cotação/histórico/fundamentos.
 */
import { describe, it, expect } from 'vitest';
import { toYahooSymbol, fromYahooSymbol } from '../services/externalMarketService.js';

describe('toYahooSymbol', () => {
    it('converte ponto de classe US para hífen', () => {
        expect(toYahooSymbol('BRK.B')).toBe('BRK-B');
        expect(toYahooSymbol('BF.B')).toBe('BF-B');
    });

    it('não altera tickers comuns, B3 e cripto', () => {
        expect(toYahooSymbol('AAPL')).toBe('AAPL');
        expect(toYahooSymbol('MSFT')).toBe('MSFT');
        expect(toYahooSymbol('PETR4.SA')).toBe('PETR4.SA'); // sufixo de bolsa, não classe
        expect(toYahooSymbol('BTC-USD')).toBe('BTC-USD');
    });
});

describe('fromYahooSymbol', () => {
    it('reverte hífen de classe US para ponto', () => {
        expect(fromYahooSymbol('BRK-B')).toBe('BRK.B');
        expect(fromYahooSymbol('BF-B')).toBe('BF.B');
    });

    it('preserva cripto e tickers comuns', () => {
        expect(fromYahooSymbol('BTC-USD')).toBe('BTC-USD'); // sufixo -USD não é classe
        expect(fromYahooSymbol('AAPL')).toBe('AAPL');
    });
});

describe('round-trip', () => {
    it('BRK.B → Yahoo → BRK.B', () => {
        expect(fromYahooSymbol(toYahooSymbol('BRK.B'))).toBe('BRK.B');
    });
});
