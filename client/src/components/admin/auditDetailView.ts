/**
 * Regras de exibição do AuditDetailModal (Admin → auditoria de ranking),
 * puras e sem JSX: que lista mostrar, como formatar cada célula e que cor/nota
 * cada score recebe. O componente só monta a marcação.
 */
import type { ResearchReport, RankingItem } from '../../services/research';
import { formatCurrency } from '../../utils/format';

export type AuditViewMode = 'TOP10' | 'FULL';
export type RiskProfileFilter = 'ALL' | 'DEFENSIVE' | 'MODERATE' | 'BOLD';
type AuditLogEntry = NonNullable<RankingItem['auditLog']>[number];

/** Lista da tabela: ranking (filtrável por perfil) ou auditoria completa, sempre por score desc. */
export const selectAuditItems = (
    report: ResearchReport | null, viewMode: AuditViewMode, riskFilter: RiskProfileFilter,
): RankingItem[] => {
    if (!report) return [];
    const baseList = viewMode === 'FULL'
        ? (report.content.fullAuditLog || report.content.ranking)
        : report.content.ranking;
    let filtered = [...baseList];
    if (viewMode === 'TOP10' && riskFilter !== 'ALL') {
        filtered = filtered.filter(item => item.riskProfile === riskFilter);
    }
    return filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
};

export const formatAuditCurrency = (val: number | undefined | null): string => {
    if (val === undefined || val === null || isNaN(val)) return '-';
    return formatCurrency(val);
};

export const formatAuditDy = (dy: number | undefined): string => (dy ? `${dy.toFixed(1)}%` : '0%');

export const formatAuditRatio = (value: number | undefined, digits: number): string => value?.toFixed(digits) || '-';

/** Perfil usado para cor/ícone: ausente conta como MODERATE (o texto mostra '-'). */
export const displayProfile = (profile: RankingItem['riskProfile']): string => profile || 'MODERATE';

export const riskColorClass = (profile: string): string => {
    if (profile === 'DEFENSIVE') return 'text-emerald-400';
    if (profile === 'MODERATE') return 'text-blue-400';
    return 'text-purple-400';
};

export const scoreBadgeClass = (score: number): string =>
    (score >= 70 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400');

export const actionBadgeClass = (action: RankingItem['action']): string => {
    if (action === 'BUY') return 'bg-emerald-500 text-black';
    if (action === 'SELL') return 'bg-red-500 text-white';
    return 'bg-slate-700';
};

export const gradeRingClass = (score: number): string => {
    if (score >= 90) return 'border-emerald-500 text-emerald-500 bg-emerald-500/10';
    if (score >= 80) return 'border-blue-500 text-blue-500 bg-blue-500/10';
    if (score >= 70) return 'border-slate-400 text-slate-400 bg-slate-400/10';
    return 'border-red-500 text-red-500 bg-red-500/10';
};

const GRADE_STEPS: ReadonlyArray<[number, string]> = [[95, 'A+'], [90, 'A'], [80, 'B+'], [70, 'B'], [60, 'C']];

export const gradeLetter = (score: number): string => GRADE_STEPS.find(([min]) => score >= min)?.[1] ?? 'F';

export const verdictText = (score: number): string => {
    if (score >= 80) return 'Recomendação Forte para o perfil atual.';
    if (score >= 65) return 'Ativo com fundamentos sólidos, mas pontuação média.';
    return 'Ativo descartado pelo Motor de Decisão por falta de critérios.';
};

/** Valor estrutural (0 quando ausente) e a cor: destaque só acima de 70. */
export const structuralDisplay = (value: number | undefined, highClass: string): { value: number; className: string } => {
    const v = value || 0;
    return { value: v, className: v > 70 ? highClass : 'text-white' };
};

/** Critérios + e − do diário; `isEmpty` só quando não há log algum (zeros não contam como vazio). */
export const splitAuditLog = (log: RankingItem['auditLog']): { positives: AuditLogEntry[]; negatives: AuditLogEntry[]; isEmpty: boolean } => ({
    positives: (log || []).filter(l => l.points > 0),
    negatives: (log || []).filter(l => l.points < 0),
    isEmpty: !log || log.length === 0,
});

export const toggleClass = (active: boolean, activeClass: string, idleClass: string): string => (active ? activeClass : idleClass);
