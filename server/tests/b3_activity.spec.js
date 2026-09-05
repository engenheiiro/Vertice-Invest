import { describe, it, expect } from 'vitest';
import { b3Activity, b3Label, isB3Type } from '../scripts/lib/b3Activity.js';

/**
 * A regra que este arquivo protege nasceu de um falso positivo caro.
 *
 * Em 04/09/2026 o probe ao vivo jurava que NGRD3, TRAD3 e HSRE11 estavam vivos —
 * "recupera via Yahoo chart". O arquivo oficial da B3 mostrou ZERO negócios nos
 * 10 pregões anteriores para os três: o `chart` devolve o último candle dentro
 * da janela pedida, então papel que saiu da bolsa continua "recuperando" por
 * semanas. Preço em cache não é papel negociando.
 */

const janela = (linhas) => linhas.map(([dia, mapa]) => ({ dia, closes: new Map(mapa) }));

describe('atividade real na B3', () => {
    it('zero negócios em toda a janela é veredito conclusivo de morto', () => {
        const j = janela([
            ['2026-09-04', [['PETR4', { close: 38, trades: 5000 }]]],
            ['2026-09-03', [['PETR4', { close: 37, trades: 4800 }]]],
        ]);
        const a = b3Activity('GUAR3', j);
        expect(a.conclusive).toBe(true);
        expect(a.traded).toBe(0);
        expect(b3Label(a)).toMatch(/ZERO negócios em 2 pregões/);
    });

    // Papel ilíquido de verdade aparece em ALGUNS dias com pouquíssimos negócios
    // — foi o caso do EQMA3B (6 de 10 pregões, ~3 negócios/dia). Confundir isso
    // com morte aposentaria papel que negocia.
    it('presença em parte dos pregões é iliquidez, não morte', () => {
        const j = janela([
            ['2026-09-04', [['EQMA3B', { close: 29.24, trades: 3 }]]],
            ['2026-09-03', []],
            ['2026-09-02', [['EQMA3B', { close: 29.1, trades: 5 }]]],
        ]);
        const a = b3Activity('EQMA3B', j);
        expect(a.traded).toBe(2);
        expect(a.avgTrades).toBe(4);
        expect(a.lastPrice).toBe(29.24);
        expect(b3Label(a)).toMatch(/negociou em 2\/3/);
    });

    // Sem arquivo não há evidência, e silêncio não pode virar veredito: a decisão
    // volta para o probe em vez de aposentar o universo inteiro.
    it('janela vazia é inconclusiva, nunca "morto"', () => {
        const a = b3Activity('PETR4', []);
        expect(a.conclusive).toBe(false);
        expect(b3Label(a)).toMatch(/evidência indisponível/);
    });

    it('só papel da B3 tem essa evidência', () => {
        expect(isB3Type('STOCK')).toBe(true);
        expect(isB3Type('FII')).toBe(true);
        expect(isB3Type('ETF')).toBe(true);
        expect(isB3Type('STOCK_US')).toBe(false);
        expect(isB3Type('CRYPTO')).toBe(false);
    });
});
