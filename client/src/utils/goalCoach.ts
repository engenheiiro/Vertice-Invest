/**
 * "Coach" determinístico de metas — gera mensagens motivacionais em PT-BR a
 * partir do estado da meta. Pure function, sem IA e sem custo. As mensagens
 * voltam em ordem de prioridade: a 1ª é o insight-herói (renderizado em
 * destaque no topo); as demais entram condensadas abaixo.
 */

export type CoachTone = 'success' | 'info' | 'warning';

export interface CoachMessage {
  tone: CoachTone;
  title: string;
  text: string;
}

export interface CoachState {
  progressPct: number;
  onTrack: boolean;
  achieved: boolean;
  monthsRemaining: number | null;
  monthlyTarget: number;
  requiredMonthlyForDeadline: number | null;
  hasDeadline: boolean;
  /** Decomposição do mês corrente. */
  fromContribution: number;
  fromMarket: number;
  /** Plano vs. real. */
  dateDeltaMonths?: number | null;
  valueVsPlan?: number;
  /** Engajamento. */
  streak?: number;
  avgContribution3m?: number;
  /** Meses adiantados pelo último aporte (quando aplicável). */
  monthsAccelerated?: number | null;
}

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const MILESTONES = [10, 25, 50, 75, 90];

const lastMilestone = (pct: number): number | null => {
  let hit: number | null = null;
  for (const m of MILESTONES) if (pct >= m) hit = m;
  return hit;
};

const monthsLabel = (m: number): string => {
  const a = Math.abs(Math.round(m));
  if (a < 12) return `${a} ${a === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(a / 12);
  const rest = a % 12;
  return rest === 0 ? `${years} ${years === 1 ? 'ano' : 'anos'}` : `${years}a ${rest}m`;
};

export const getCoachMessages = (s: CoachState): CoachMessage[] => {
  const msgs: CoachMessage[] = [];

  // 1. Meta concluída (herói absoluto).
  if (s.achieved || s.progressPct >= 100) {
    return [{
      tone: 'success',
      title: 'Meta conquistada! 🎉',
      text: 'Você chegou lá. Hora de definir o próximo objetivo e manter o ritmo dos aportes.',
    }];
  }

  // 2. Aceleração do último aporte (quando acabou de aportar).
  if (s.monthsAccelerated && s.monthsAccelerated >= 1) {
    msgs.push({
      tone: 'success',
      title: `Você adiantou ${monthsLabel(s.monthsAccelerated)}`,
      text: 'Esse aporte aproximou a data da sua meta. Consistência é o que constrói patrimônio.',
    });
  }

  // 3. Adiantado / atrasado vs. PLANO (insight-herói principal).
  if (typeof s.dateDeltaMonths === 'number' && Math.abs(s.dateDeltaMonths) >= 1) {
    const aheadBy = s.dateDeltaMonths;
    const valTxt = typeof s.valueVsPlan === 'number' && Math.abs(s.valueVsPlan) >= 1
      ? ` Você está ${brl(Math.abs(s.valueVsPlan))} ${s.valueVsPlan >= 0 ? 'à frente' : 'atrás'} do plano.`
      : '';
    if (aheadBy > 0) {
      msgs.push({ tone: 'success', title: `Adiantado em ${monthsLabel(aheadBy)}`, text: `Seu ritmo está superando o planejado.${valTxt}` });
    } else {
      msgs.push({ tone: 'warning', title: `Atrasado em ${monthsLabel(aheadBy)}`, text: `Você está abaixo do plano original.${valTxt} Aumentar o aporte recoloca a meta no prazo.` });
    }
  } else if (s.hasDeadline && !s.onTrack && s.requiredMonthlyForDeadline !== null) {
    const gap = s.requiredMonthlyForDeadline - s.monthlyTarget;
    msgs.push({
      tone: 'warning',
      title: 'Ritmo abaixo do necessário',
      text: `Para bater o prazo seriam ~${brl(s.requiredMonthlyForDeadline)}/mês (${brl(Math.max(0, gap))} a mais).`,
    });
  } else if (s.monthsRemaining !== null) {
    msgs.push({
      tone: 'info',
      title: `Faltam ~${monthsLabel(s.monthsRemaining)}`,
      text: `No ritmo de ${brl(s.monthlyTarget)}/mês você alcança o objetivo. Aumentar o aporte encurta o caminho.`,
    });
  } else {
    msgs.push({
      tone: 'warning',
      title: 'Sem caminho de chegada',
      text: 'Com o aporte e a taxa atuais a meta não avança. Defina um aporte mensal ou revise a taxa esperada.',
    });
  }

  // 4. Ritmo real (média 3m) vs. planejado.
  if (typeof s.avgContribution3m === 'number' && s.monthlyTarget > 0 && s.avgContribution3m > 0) {
    if (s.avgContribution3m < s.monthlyTarget * 0.95) {
      msgs.push({
        tone: 'warning',
        title: 'Ritmo real abaixo do plano',
        text: `Seus últimos 3 meses somam ~${brl(s.avgContribution3m)}/mês, abaixo dos ${brl(s.monthlyTarget)} planejados.`,
      });
    } else if (s.avgContribution3m >= s.monthlyTarget) {
      msgs.push({
        tone: 'success',
        title: 'Ritmo real em dia',
        text: `Você vem aportando ~${brl(s.avgContribution3m)}/mês — no plano ou acima dele. Excelente disciplina.`,
      });
    }
  }

  // 5. De onde veio a evolução do mês.
  if (s.fromMarket > 0 && s.fromMarket >= s.fromContribution && s.fromContribution > 0) {
    msgs.push({
      tone: 'success',
      title: 'O mercado trabalhou por você',
      text: `Neste mês ${brl(s.fromMarket)} vieram da valorização — além dos ${brl(s.fromContribution)} aportados. Juros compostos em ação.`,
    });
  } else if (s.fromMarket < 0) {
    msgs.push({
      tone: 'info',
      title: 'Mês de mercado em baixa',
      text: 'A oscilação faz parte. Aporte na baixa: você compra mais barato e acelera a meta no longo prazo.',
    });
  }

  // 6. Streak de consistência.
  if (s.streak && s.streak >= 2) {
    msgs.push({
      tone: 'success',
      title: `🔥 ${s.streak} meses seguidos aportando`,
      text: 'Constância é o maior motor de patrimônio. Não quebre a sequência!',
    });
  }

  // 7. Marco cruzado.
  const milestone = lastMilestone(s.progressPct);
  if (milestone) {
    msgs.push({
      tone: 'success',
      title: `${milestone}% do caminho`,
      text: milestone >= 75 ? 'A reta final é a mais empolgante. Você está quase lá.' : 'Cada marco é prova de que o plano funciona. Continue.',
    });
  }

  return msgs;
};
