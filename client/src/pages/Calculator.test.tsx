/**
 * Prefixado de referência da calculadora (ago/2026).
 *
 * O filtro original olhava `type` para excluir o título com juros semestrais — mas
 * "Juros Semestrais" está no NOME; `type` é o enum do catálogo (`PREFIXADO`), onde
 * a palavra nunca aparece. Na prática nada era excluído, e bastava o título com
 * cupom vir primeiro na lista para a simulação adotar a taxa dele.
 */
import { describe, it, expect } from 'vitest';
import { pickPrefixadoRate } from './Calculator';

describe('pickPrefixadoRate', () => {
    it('pula o título com juros semestrais mesmo quando ele vem primeiro', () => {
        expect(pickPrefixadoRate([
            { title: 'Tesouro Prefixado 2037 Juros Semestrais', type: 'PREFIXADO', rate: 14.62 },
            { title: 'Tesouro Prefixado 2029', type: 'PREFIXADO', rate: 14.13 },
        ])).toBe(14.13);
    });

    it('ignora títulos de outras famílias', () => {
        expect(pickPrefixadoRate([
            { title: 'Tesouro IPCA+ 2040', type: 'IPCA', rate: 7.46 },
            { title: 'Tesouro Selic 2031', type: 'SELIC', rate: 0.073 },
            { title: 'Tesouro Prefixado 2032', type: 'PREFIXADO', rate: 14.6 },
        ])).toBe(14.6);
    });

    it('sem prefixado elegível devolve undefined (o chamador aplica o fallback)', () => {
        expect(pickPrefixadoRate([
            { title: 'Tesouro Prefixado 2037 Juros Semestrais', type: 'PREFIXADO', rate: 14.62 },
        ])).toBeUndefined();
        expect(pickPrefixadoRate([])).toBeUndefined();
    });

    it('aceita a taxa em annualRate quando rate não vem', () => {
        expect(pickPrefixadoRate([
            { title: 'Tesouro Prefixado 2029', type: 'PREFIXADO', annualRate: 14.13 },
        ])).toBe(14.13);
    });
});
