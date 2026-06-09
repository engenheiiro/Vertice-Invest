
import { authService } from './auth';

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
}

export const goalsService = {
    async getGoals(): Promise<{ goals: Goal[]; walletEquity: number; snapshotDate: string | null }> {
        const response = await authService.api('/api/goals');
        if (!response.ok) throw new Error('Falha ao carregar metas');
        return await response.json();
    },

    async getGoal(id: string): Promise<GoalDetail> {
        const response = await authService.api(`/api/goals/${id}`);
        if (!response.ok) throw new Error('Falha ao carregar meta');
        return await response.json();
    },

    async createGoal(data: CreateGoalPayload): Promise<{ goal: Goal }> {
        const response = await authService.api('/api/goals', {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao criar meta');
        }
        return await response.json();
    },

    async updateGoal(id: string, data: Partial<CreateGoalPayload> & { status?: string }): Promise<{ goal: Goal }> {
        const response = await authService.api(`/api/goals/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao atualizar meta');
        }
        return await response.json();
    },

    async deleteGoal(id: string): Promise<void> {
        const response = await authService.api(`/api/goals/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Falha ao remover meta');
    },

    async addContribution(
        id: string,
        data: { amount: number; date?: string; note?: string },
    ): Promise<{ goal: Goal; monthsAccelerated: number | null }> {
        const response = await authService.api(`/api/goals/${id}/contributions`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao registrar aporte');
        }
        return await response.json();
    },

    async deleteContribution(id: string, cid: string): Promise<{ goal: Goal }> {
        const response = await authService.api(`/api/goals/${id}/contributions/${cid}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Falha ao remover aporte');
        return await response.json();
    },
};
