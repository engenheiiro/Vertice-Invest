/**
 * Landing pública: o retorno exibido é MEDIDO (preço da publicação × cotação
 * atual), nunca sorteado. Sem os dois preços, o campo sai nulo.
 */
import { describe, it, expect } from 'vitest';
import { formatMeasuredReturn } from '../controllers/marketController.js';

describe('formatMeasuredReturn', () => {
    it('formata alta e queda com sinal', () => {
        expect(formatMeasuredReturn(100, 103.2)).toBe('+3.2%');
        expect(formatMeasuredReturn(100, 98.6)).toBe('-1.4%');
    });

    it('é determinístico (não há sorteio)', () => {
        expect(formatMeasuredReturn(50, 55)).toBe(formatMeasuredReturn(50, 55));
    });

    it('devolve null quando falta preço', () => {
        expect(formatMeasuredReturn(0, 10)).toBeNull();
        expect(formatMeasuredReturn(10, undefined)).toBeNull();
        expect(formatMeasuredReturn(null, null)).toBeNull();
    });
});
