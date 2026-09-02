/**
 * Leitor de `allSettled` com rejeição registrada.
 *
 * Existe porque a degradação graciosa do payload da carteira era MUDA: sete
 * buscas com fallback e nenhum log. Em 02/09/2026 uma delas passou a rejeitar
 * (Query do Mongoose consumida duas vezes), `snapshots` chegou vazio, e a
 * carteira perdeu o TWRR e o dia-âncora sem uma linha de aviso em lugar nenhum.
 */
import { describe, it, expect } from 'vitest';
import { createSettledReader } from '../utils/settledReader.js';

const ok = (value) => ({ status: 'fulfilled', value });
const fail = (reason) => ({ status: 'rejected', reason });

describe('createSettledReader', () => {
    it('devolve o valor e não anota nada quando a busca deu certo', () => {
        const settled = createSettledReader();

        expect(settled.or(ok([1, 2]), [], 'snapshots')).toEqual([1, 2]);
        expect(settled.failures).toEqual([]);
        expect(settled.failed()).toBe('');
    });

    it('devolve o fallback e anota a falha sob o nome da busca', () => {
        const settled = createSettledReader();

        const out = settled.or(fail(new Error('Query was already executed')), [], 'snapshots');

        expect(out).toEqual([]);
        expect(settled.failures).toEqual([
            { source: 'snapshots', error: 'Query was already executed' },
        ]);
    });

    it('preserva o fallback exato — inclusive null, que é diferente de ausente', () => {
        const settled = createSettledReader();
        expect(settled.or(fail(new Error('x')), null, 'macro')).toBeNull();
        expect(settled.or(fail(new Error('x')), new Map(), 'quotes')).toBeInstanceOf(Map);
    });

    it('acumula várias falhas numa lista só — uma linha de log, não sete', () => {
        const settled = createSettledReader();

        settled.or(fail(new Error('mongo down')), [], 'snapshots');
        settled.or(ok({}), {}, 'macro');
        settled.or(fail(new Error('timeout')), null, 'treasuryPricing');

        expect(settled.failures).toHaveLength(2);
        // `failed()` é a chave que se lê de relance no terminal.
        expect(settled.failed()).toBe('snapshots,treasuryPricing');
    });

    it('rejeição que não é Error também vira mensagem legível', () => {
        const settled = createSettledReader();

        settled.or(fail('string crua'), null, 'a');
        settled.or(fail({ code: 500 }), null, 'b');
        settled.or(fail(undefined), null, 'c');
        settled.or(fail(null), null, 'd');

        expect(settled.failures.map((f) => f.error)).toEqual([
            'string crua', '{"code":500}', 'undefined', 'null',
        ]);
    });

    it('resultado ausente conta como falha, não estoura', () => {
        const settled = createSettledReader();
        expect(settled.or(undefined, 'padrão', 'sumiu')).toBe('padrão');
        expect(settled.failures[0].source).toBe('sumiu');
    });
});
