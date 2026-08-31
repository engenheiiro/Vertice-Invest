import { authService } from './auth';

/**
 * Funil comercial (Admin).
 *
 * Vem inteiro do nosso banco — cadastro, ativação, conversão, receita, retenção
 * e origem. É a metade do funil que o Google Analytics não pode dar: lá só
 * aparece quem aceitou o cookie de medição.
 */

export interface FunnelCohort {
    monthKey: string;
    signups: number;
    activated: number;
    paid30d: number;
    paidEver: number;
    activationRate: number | null;
    conversionRate: number | null;
    /** false = o mês ainda não teve 30 dias para converter; não comparar. */
    matureFor30d: boolean;
}

export interface FunnelAcquisitionRow {
    source: string;
    signups: number;
    activated: number;
    paid: number;
    activationRate: number | null;
    conversionRate: number | null;
}

export interface FunnelReport {
    generatedAt: string;
    windowMonths: number;
    conversionWindowDays: number;
    cohorts: FunnelCohort[];
    averages: {
        cohorts: number;
        signups: number;
        activationRate: number | null;
        conversionRate: number | null;
    };
    acquisition: FunnelAcquisitionRow[];
    revenue: {
        subscribers: number;
        mrr: number;
        arpu: number | null;
        byPlan: Record<string, { subscribers: number; mrr: number }>;
    };
    retention: {
        activeNow: number;
        dueInWindow: number;
        renewed: number;
        lost: number;
        churnRate: number | null;
        significant: boolean;
    };
    totals: {
        signupsInWindow: number;
        adminsInWindow: number;
        allTimeSignups: number;
    };
}

export const funnelService = {
    async getFunnel(months = 12): Promise<FunnelReport> {
        const response = await authService.api(`/api/admin/funnel?months=${months}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Falha ao carregar o funil.');
        return data as FunnelReport;
    },
};
