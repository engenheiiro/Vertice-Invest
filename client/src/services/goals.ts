
import { authService } from './auth';

// Anexa ?walletId= à URL quando informado; omitido, o backend resolve a
// carteira ativa do usuário via middleware resolveWallet.
const withWallet = (path: string, walletId?: string) => {
    if (!walletId) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}walletId=${encodeURIComponent(walletId)}`;
};

export interface Goal {
    _id: string;
    name: string;
    icon: string;
    color: string;
    targetAmount: number;
    monthlyTarget: number;
    expectedAnnualRate: number;
    startDate: string;
    targetDate?: string | null;
    startValue: number;
    achievedAt?: string | null;
    lastCelebratedMilestone: number;
    previousGoalId?: string | null;
    /** Jornada (nome da cadeia). Null enquanto a cadeia não foi nomeada. */
    journey?: { _id: string; name: string } | null;
    mirrorWallet: boolean;
    manualBalance: number;
    status: 'ACTIVE' | 'ACHIEVED' | 'ARCHIVED';
    // Campos projetados (computados no backend).
    currentValue: number;
    walletEquity: number;
    remainingAmount: number;
    progressPct: number;
    monthsRemaining: number | null;
    projectedDate: string | null;
    plannedDate: string | null;
    planExpectedNow: number;
    valueVsPlan: number;
    dateDeltaMonths: number | null;
    requiredMonthlyForDeadline: number | null;
    onTrack: boolean;
    achieved: boolean;
    /** Divergência (pp) entre a taxa salva na meta e a sugerida pela carteira. */
    rateDeltaPp: number;
    /** true quando a divergência passa da tolerância — premissa envelhecida. */
    rateStale: boolean;
}

/** Rentabilidade da carteira já anualizada (null enquanto a janela for curta). */
export interface WalletReturn {
    value: number | null;
    days: number;
    totalReturnPct: number;
    enough: boolean;
    capped: boolean;
}

/**
 * Contexto da taxa esperada da carteira ativa. `suggested` é premissa para o
 * FUTURO (ponderada pela composição da carteira); `walletReturn` é medição do
 * PASSADO. As duas nunca devem ser apresentadas como a mesma coisa.
 */
export interface RateContext {
    suggested: number;
    breakdown: Array<{ type: string; value: number; weight: number; rate: number }>;
    cdi: number;
    ipca: number;
    ntnbLong: number;
    walletReturn: WalletReturn;
}

export interface TrajectoryPoint {
    t: string;
    real?: number;
    planned?: number;
    projected?: number;
}

export interface MonthlyHistoryPoint {
    month: string;
    amount: number;
}

export interface GoalContribution {
    _id: string;
    amount: number;
    date: string;
    note?: string;
}

export interface GoalDetail {
    goal: Goal;
    contributions: GoalContribution[];
    currentMonth: {
        contributions: number;
        manual: number;
        wallet: number;
        totalChange: number;
        fromContribution: number;
        fromMarket: number;
    };
    trajectory: TrajectoryPoint[];
    monthlyHistory: MonthlyHistoryPoint[];
    streak: number;
    avgContribution3m: number;
    walletEquity: number;
    snapshotDate: string | null;
    rateContext: RateContext;
}

export interface CreateGoalPayload {
    name: string;
    icon?: string;
    color?: string;
    targetAmount: number;
    monthlyTarget?: number;
    expectedAnnualRate?: number;
    targetDate?: string | null;
    mirrorWallet?: boolean;
    manualBalance?: number;
    previousGoalId?: string | null;
}

export const goalsService = {
    async getGoals(walletId?: string): Promise<{ goals: Goal[]; walletEquity: number; snapshotDate: string | null; rateContext: RateContext }> {
        const response = await authService.api(withWallet('/api/goals', walletId));
        if (!response.ok) throw new Error('Falha ao carregar metas');
        return await response.json();
    },

    /**
     * Taxa sugerida para a carteira ativa — o formulário precisa dela ANTES de a
     * meta existir, então não dá para tirá-la de /goals/:id.
     */
    async getRateSuggestion(walletId?: string): Promise<RateContext> {
        const response = await authService.api(withWallet('/api/goals/rate-suggestion', walletId));
        if (!response.ok) throw new Error('Falha ao carregar taxa sugerida');
        return await response.json();
    },

    async getGoal(id: string, walletId?: string): Promise<GoalDetail> {
        const response = await authService.api(withWallet(`/api/goals/${id}`, walletId));
        if (!response.ok) throw new Error('Falha ao carregar meta');
        return await response.json();
    },

    /**
     * Nomeia a jornada a partir de qualquer marco dela — o servidor percorre a
     * cadeia e aplica o vínculo a todos, inclusive em cadeias criadas antes de a
     * jornada existir.
     */
    async renameJourney(goalId: string, name: string, walletId?: string): Promise<{ journey: { _id: string; name: string } }> {
        const response = await authService.api(withWallet(`/api/goals/${goalId}/journey`, walletId), {
            method: 'PUT',
            body: JSON.stringify({ name }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao renomear jornada');
        }
        return await response.json();
    },

    async createGoal(data: CreateGoalPayload, walletId?: string): Promise<{ goal: Goal }> {
        const response = await authService.api(withWallet('/api/goals', walletId), {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao criar meta');
        }
        return await response.json();
    },

    async updateGoal(id: string, data: Partial<CreateGoalPayload> & { status?: string }, walletId?: string): Promise<{ goal: Goal }> {
        const response = await authService.api(withWallet(`/api/goals/${id}`, walletId), {
            method: 'PUT',
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao atualizar meta');
        }
        return await response.json();
    },

    async deleteGoal(id: string, walletId?: string): Promise<void> {
        const response = await authService.api(withWallet(`/api/goals/${id}`, walletId), { method: 'DELETE' });
        if (!response.ok) throw new Error('Falha ao remover meta');
    },

    async clearAllGoals(walletId?: string): Promise<{ deletedCount: number }> {
        const response = await authService.api(withWallet('/api/goals', walletId), { method: 'DELETE' });
        if (!response.ok) throw new Error('Falha ao limpar metas');
        return await response.json();
    },

    async addContribution(
        id: string,
        data: { amount: number; date?: string; note?: string },
        walletId?: string,
    ): Promise<{ goal: Goal; monthsAccelerated: number | null }> {
        const response = await authService.api(withWallet(`/api/goals/${id}/contributions`, walletId), {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao registrar aporte');
        }
        return await response.json();
    },

    async deleteContribution(id: string, cid: string, walletId?: string): Promise<{ goal: Goal }> {
        const response = await authService.api(withWallet(`/api/goals/${id}/contributions/${cid}`, walletId), { method: 'DELETE' });
        if (!response.ok) throw new Error('Falha ao remover aporte');
        return await response.json();
    },
};
