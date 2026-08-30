/**
 * Busca de ativos no cadastro da carteira (ago/2026): o termo digitado ia cru para
 * o `$regex`. Como todo título de Tesouro IPCA+ tem um "+" no nome, digitar o nome
 * exato que a tela mostra não devolvia nenhum resultado.
 */
import { describe, it, expect } from 'vitest';
import { escapeRegex } from '../utils/regexEscape.js';

const matches = (term, title) => new RegExp(escapeRegex(term), 'i').test(title);

describe('escapeRegex — termo digitado é texto, não padrão', () => {
    it('"IPCA+" casa o título do catálogo', () => {
        expect(matches('IPCA+ 2037', 'Tesouro IPCA+ 2037 Juros Semestrais')).toBe(true);
        expect(matches('Tesouro IPCA+ 2040', 'Tesouro IPCA+ 2040')).toBe(true);
    });

    it('sem escapar, o mesmo termo não casaria nada (regressão)', () => {
        expect(new RegExp('IPCA+ 2037', 'i').test('Tesouro IPCA+ 2037 Juros Semestrais')).toBe(false);
    });

    it('Renda+ e Educa+ também dependem do escape', () => {
        expect(matches('Renda+', 'Tesouro Renda+ Aposentadoria Extra 2065')).toBe(true);
        expect(matches('Educa+ 2036', 'Tesouro Educa+ 2036')).toBe(true);
    });

    it('não casa título diferente por acidente', () => {
        expect(matches('IPCA+ 2037', 'Tesouro IPCA+ 2040')).toBe(false);
    });

    it('padrão patológico vira busca literal (sem trabalho exponencial)', () => {
        expect(escapeRegex('(a+)+$')).toBe('\\(a\\+\\)\\+\\$');
        expect(matches('(a+)+$', 'Tesouro Selic 2031')).toBe(false);
    });

    it('entrada vazia/nula não quebra', () => {
        expect(escapeRegex(null)).toBe('');
        expect(escapeRegex(undefined)).toBe('');
    });
});
