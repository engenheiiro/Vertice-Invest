/**
 * Regressão do índice único de `wallets.publicToken`.
 *
 * O índice nasceu `{ unique: true, sparse: true }` acreditando que sparse tiraria
 * do índice as carteiras sem link público. Não tira: sparse só ignora o documento
 * em que o campo está AUSENTE, e `publicToken` tem `default: null` — toda carteira
 * grava o campo valendo null. Da segunda carteira em diante o cadastro morria com
 *   E11000 duplicate key ... index: publicToken_1 dup key: { publicToken: null }
 *
 * O teste trava a definição no schema (sem rede/DB): índice PARCIAL por `$type:
 * 'string'`, nunca sparse, e com nome próprio — voltar para `publicToken_1` faria
 * o autoIndex conflitar com o índice defeituoso ainda presente nos bancos antigos.
 */
import { describe, it, expect } from 'vitest';
import Wallet from '../models/Wallet.js';

const publicTokenIndex = () =>
  Wallet.schema.indexes().find(([fields]) => Object.keys(fields).join(',') === 'publicToken');

describe('índice wallets.publicToken', () => {
  it('existe e é único', () => {
    const index = publicTokenIndex();
    expect(index).toBeDefined();
    expect(index[1].unique).toBe(true);
  });

  it('é parcial por $type string — nunca sparse', () => {
    const [, options] = publicTokenIndex();
    expect(options.sparse).toBeUndefined();
    expect(options.partialFilterExpression).toEqual({ publicToken: { $type: 'string' } });
  });

  it('tem nome próprio, distinto do índice legado publicToken_1', () => {
    const [, options] = publicTokenIndex();
    expect(options.name).toBe('publicToken_partial_unique');
    expect(options.name).not.toBe('publicToken_1');
  });

  it('deixa o campo com default null (o filtro parcial é quem tira o null do índice)', () => {
    expect(Wallet.schema.path('publicToken').defaultValue).toBeNull();
  });
});
