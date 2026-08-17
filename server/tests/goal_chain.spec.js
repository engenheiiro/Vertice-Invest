import { describe, it, expect } from 'vitest';
import { orderChainFrom } from '../utils/goalChain.js';

/** Marco de uma jornada: `prev` é o id do marco anterior (previousGoalId). */
const goal = (id, prev = null) => ({ _id: id, previousGoalId: prev, name: id });

describe('orderChainFrom', () => {
  it('alcança a cadeia inteira a partir do ÚLTIMO marco', () => {
    // É o caso do rename: o cabeçalho envia a meta final e o servidor precisa
    // achar os marcos anteriores para vincular todos à mesma jornada.
    const all = [goal('a'), goal('b', 'a'), goal('c', 'b')];
    expect(orderChainFrom(all[2], all).map((g) => g._id)).toEqual(['a', 'b', 'c']);
  });

  it('alcança a cadeia inteira a partir de um marco do MEIO', () => {
    const all = [goal('a'), goal('b', 'a'), goal('c', 'b')];
    expect(orderChainFrom(all[1], all).map((g) => g._id)).toEqual(['a', 'b', 'c']);
  });

  it('não invade a cadeia vizinha', () => {
    const all = [goal('a'), goal('b', 'a'), goal('x'), goal('y', 'x')];
    expect(orderChainFrom(all[0], all).map((g) => g._id)).toEqual(['a', 'b']);
  });

  it('meta avulsa devolve só ela', () => {
    const all = [goal('solo'), goal('a'), goal('b', 'a')];
    expect(orderChainFrom(all[0], all).map((g) => g._id)).toEqual(['solo']);
  });

  it('ignora previousGoalId apontando para meta inexistente', () => {
    // Marco anterior excluído: a cadeia começa no órfão, sem quebrar.
    const all = [goal('orfa', 'sumiu'), goal('depois', 'orfa')];
    expect(orderChainFrom(all[0], all).map((g) => g._id)).toEqual(['orfa', 'depois']);
  });

  it('não trava com previousGoalId circular', () => {
    // Dado corrompido: a↔b. Um laço ingênuo rodaria para sempre.
    const all = [goal('a', 'b'), goal('b', 'a')];
    const chain = orderChainFrom(all[0], all);
    expect(chain.map((g) => g._id).sort()).toEqual(['a', 'b']);
  });

  it('aceita id como objeto populado, não só string', () => {
    // previousGoalId chega como ObjectId/documento dependendo do populate.
    const a = goal('a');
    const b = { _id: 'b', previousGoalId: { _id: 'a' } };
    expect(orderChainFrom(b, [a, b]).map((g) => g._id)).toEqual(['a', 'b']);
  });

  it('devolve vazio sem meta', () => {
    expect(orderChainFrom(null, [goal('a')])).toEqual([]);
  });
});
