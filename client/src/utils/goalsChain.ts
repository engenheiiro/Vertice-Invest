import type { Goal } from '../services/goals';

/** Quebra um array em blocos de até `size` itens (preserva a ordem). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const isAchieved = (goal: Goal): boolean => goal.achieved || goal.status === 'ACHIEVED';

/** Constrói cadeias de metas sequenciais a partir do campo previousGoalId. */
export function buildChains(goals: Goal[]): Goal[][] {
  const idSet = new Set(goals.map((g) => g._id));
  const processed = new Set<string>();
  const result: Goal[][] = [];

  const getNext = (id: string) => goals.find((g) => g.previousGoalId === id);

  for (const goal of goals) {
    if (processed.has(goal._id)) continue;
    // Raiz = sem previousGoalId válido no conjunto atual
    if (goal.previousGoalId && idSet.has(goal.previousGoalId)) continue;

    const chain: Goal[] = [goal];
    let current = goal;
    let next: Goal | undefined;
    while ((next = getNext(current._id)) !== undefined) {
      if (processed.has(next._id) || chain.includes(next)) break; // ciclo: não trava o render
      chain.push(next);
      current = next;
    }
    chain.forEach((g) => processed.add(g._id));
    result.push(chain);
  }

  // Órfãos (previousGoalId aponta para meta arquivada/excluída)
  for (const goal of goals) {
    if (!processed.has(goal._id)) result.push([goal]);
  }

  return result;
}

/**
 * Quantos marcos do INÍCIO da jornada valem ser recolhidos. Só a corrida inicial
 * de conquistadas: uma conquistada no meio da cadeia continua como card, senão a
 * sequência das setas mentiria sobre a ordem. Jornada 100% concluída mantém o
 * último marco à vista (é o retrato de onde você está), e recolher um card só
 * não paga o clique que custa.
 */
export function collapsibleAchievedCount(chain: Goal[]): number {
  let run = 0;
  while (run < chain.length && isAchieved(chain[run])) run += 1;
  if (run === chain.length) run -= 1;
  return run >= 2 ? run : 0;
}

/** Meta que a jornada persegue agora: a 1ª não conquistada (ou a última, se acabou). */
export const activeGoalOf = (chain: Goal[]): Goal => chain.find((g) => !isAchieved(g)) || chain[chain.length - 1];

export const isChainComplete = (chain: Goal[]): boolean => chain.every(isAchieved);

/**
 * Título da jornada. Vale o nome que o usuário deu à cadeia; sem ele, cai no
 * nome da meta final — rótulo derivado, que muda se aquela meta for renomeada.
 * Basta UM marco vinculado: cadeia legada pode ter só parte dela ligada à
 * jornada até o próximo rename reaplicar o vínculo a todos.
 */
export const journeyTitle = (chain: Goal[]): string =>
  chain.find((g) => g.journey)?.journey?.name || chain[chain.length - 1].name;

/** Horizonte da jornada em meses; sem ritmo definido vai para o fim da fila. */
const horizonOf = (chain: Goal[]): number => {
  const months = activeGoalOf(chain).monthsRemaining;
  return months === null || !Number.isFinite(months) ? Number.POSITIVE_INFINITY : months;
};

const lastAchievedAt = (chain: Goal[]): number => {
  const times = chain
    .map((g) => (g.achievedAt ? Date.parse(g.achievedAt) : NaN))
    .filter((t) => Number.isFinite(t));
  return times.length ? Math.max(...times) : 0;
};

/**
 * Separa as jornadas vivas das já vencidas e ordena cada grupo.
 *
 * O backend devolve as metas por `createdAt` — com o tempo isso empurra a jornada
 * ATIVA para o fim da página e mantém no topo, para sempre, a que já acabou.
 * Aqui as vivas vêm primeiro, ordenadas por quem chega antes ao alvo; as vencidas
 * saem por ordem de conquista, da mais recente para a mais antiga.
 */
export function partitionChains(chains: Goal[][]): { ongoing: Goal[][]; completed: Goal[][] } {
  const ongoing: Goal[][] = [];
  const completed: Goal[][] = [];
  for (const chain of chains) (isChainComplete(chain) ? completed : ongoing).push(chain);

  ongoing.sort((a, b) => {
    const diff = horizonOf(a) - horizonOf(b);
    if (diff !== 0) return diff;
    // Empate (ex.: duas jornadas sem ritmo definido): quem está mais perto vence.
    return activeGoalOf(b).progressPct - activeGoalOf(a).progressPct;
  });
  completed.sort((a, b) => lastAchievedAt(b) - lastAchievedAt(a));

  return { ongoing, completed };
}

export type GoalRenderItem = { type: 'chain'; goals: Goal[] } | { type: 'singles'; goals: Goal[] };

/**
 * Agrupa cadeias em blocos de render: jornadas (≥2 metas) ficam em linha própria;
 * metas avulsas são agrupadas em lotes de até 3 para manter o grid cheio.
 */
export function toRenderItems(chains: Goal[][]): GoalRenderItem[] {
  const items: GoalRenderItem[] = [];
  let buffer: Goal[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    for (let i = 0; i < buffer.length; i += 3) {
      items.push({ type: 'singles', goals: buffer.slice(i, i + 3) });
    }
    buffer = [];
  };

  for (const chain of chains) {
    if (chain.length === 1) {
      buffer.push(chain[0]);
    } else {
      flushBuffer();
      items.push({ type: 'chain', goals: chain });
    }
  }
  flushBuffer();

  return items;
}

export interface GoalsSummary {
  totalTarget: number;
  totalCurrent: number;
  active: number;
  achieved: number;
}

/**
 * Resumo do topo da página.
 *
 * `currentValue` de uma meta espelhada = patrimônio da carteira + saldo manual
 * dela. Como TODA meta espelhada carrega o patrimônio inteiro, ele entra uma
 * única vez no acumulado — somar o valor de cada jornada multiplicava a carteira
 * pelo número de jornadas (com 3 cadeias espelhadas, o card mostrava 3× o que o
 * usuário realmente tem). Só a parcela manual é dinheiro exclusivo da jornada e
 * soma por cadeia.
 */
export function summarizeGoals(goals: Goal[], chains: Goal[][]): GoalsSummary {
  const active = goals.filter((g) => g.status === 'ACTIVE').length;
  // Conquistadas: status persistido ACHIEVED (com histerese de 2% no back).
  const achieved = goals.filter((g) => g.status === 'ACHIEVED').length;

  const mirrored = goals.find((g) => g.mirrorWallet);
  const walletPart = mirrored ? mirrored.walletEquity : 0;

  let manualPart = 0;
  let totalTarget = 0;
  for (const chain of chains) {
    // Última meta = alvo atual da jornada; os marcos intermediários não somam.
    const last = chain[chain.length - 1];
    manualPart += Math.max(0, last.currentValue - last.walletEquity);
    totalTarget += last.targetAmount;
  }

  return { totalTarget, totalCurrent: walletPart + manualPart, active, achieved };
}
