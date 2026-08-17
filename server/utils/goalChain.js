/**
 * Travessia da cadeia de metas (jornada).
 *
 * A ordem de uma jornada é definida por `previousGoalId`: cada marco aponta para
 * o anterior. Nomear a jornada exige alcançar TODOS os marcos a partir de um só
 * — inclusive os que vêm antes do escolhido —, e é isso que esta função entrega.
 *
 * Puro de propósito: o controller carrega as metas da carteira e delega aqui, o
 * que mantém a regra (inclusive a proteção contra ciclo) coberta por teste sem
 * precisar de banco.
 */

const idOf = (value) => (value === null || value === undefined ? null : String(value._id ?? value));

/**
 * Devolve a cadeia inteira à qual `goal` pertence, do primeiro marco ao último.
 * Um `previousGoalId` circular (dado corrompido) trava um laço ingênuo — o Set
 * de visitados corta o ciclo e devolve o que deu para ordenar.
 */
export const orderChainFrom = (goal, allGoals) => {
  if (!goal) return [];

  const byId = new Map(allGoals.map((g) => [idOf(g), g]));
  const seen = new Set([idOf(goal)]);
  const chain = [goal];

  let cursor = goal;
  while (cursor.previousGoalId) {
    const previous = byId.get(idOf(cursor.previousGoalId));
    if (!previous || seen.has(idOf(previous))) break;
    seen.add(idOf(previous));
    chain.unshift(previous);
    cursor = previous;
  }

  cursor = goal;
  for (;;) {
    const next = allGoals.find((g) => g.previousGoalId && idOf(g.previousGoalId) === idOf(cursor));
    if (!next || seen.has(idOf(next))) break;
    seen.add(idOf(next));
    chain.push(next);
    cursor = next;
  }

  return chain;
};
