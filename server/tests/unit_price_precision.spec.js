/**
 * Preço unitário abaixo de 1 não pode passar pela régua de 4 casas do dinheiro.
 *
 * O defeito que este arquivo trava: SHIB (~US$ 0,00001234) arredondava para 0 em
 * safeFloat — a posição inteira valia zero, o preço médio também, e a compra era
 * gravada com preço 0.
 */
import { describe, expect, it } from 'vitest';
import { safeUnitPrice, safeValue, safePrice } from '../utils/mathUtils.js';

describe('safeUnitPrice', () => {
    it('preserva preço de cripto abaixo de um centavo (8 algarismos significativos)', () => {
        expect(safeUnitPrice(0.00001234)).toBe(0.00001234);
        expect(safeUnitPrice(0.000001234567891)).toBe(0.0000012345679);
    });

    it('mantém as 4 casas de sempre acima de 1', () => {
        expect(safeUnitPrice(32.456789)).toBe(32.4568);
        expect(safeUnitPrice(1.0005249)).toBe(1.0005);
    });

    it('não-finito vira 0', () => {
        expect(safeUnitPrice(NaN)).toBe(0);
        expect(safeUnitPrice(Infinity)).toBe(0);
    });
});

describe('valor e preço médio de posição com preço sub-centavo', () => {
    it('10 milhões de SHIB a 0,00001234 valem 123,40 (não 0)', () => {
        expect(safeValue(10_000_000, 0.00001234)).toBe(123.4);
    });

    it('preço médio de 123,40 em 10 milhões de unidades é 0,00001234 (não 0)', () => {
        expect(safePrice(123.4, 10_000_000)).toBe(0.00001234);
    });
});
