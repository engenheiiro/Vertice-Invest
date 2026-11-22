import { describe, it, expect } from 'vitest';
import type { ResearchReport, RankingItem } from '../../services/research';
import {
    selectAuditItems, formatAuditCurrency, formatAuditDy, formatAuditRatio, displayProfile, riskColorClass,
    scoreBadgeClass, actionBadgeClass, gradeRingClass, gradeLetter, verdictText, structuralDisplay, splitAuditLog, toggleClass,
} from './auditDetailView';

const item = (ticker: string, score: number, riskProfile?: RankingItem['riskProfile']) =>
    ({ ticker, score, riskProfile } as RankingItem);
const report = (ranking: RankingItem[], fullAuditLog?: RankingItem[]) =>
    ({ content: { ranking, fullAuditLog } } as unknown as ResearchReport);

describe('auditDetailView', () => {
    it('selectAuditItems: sem relatório é vazio; ordena por score sem mutar a origem', () => {
        expect(selectAuditItems(null, 'TOP10', 'ALL')).toEqual([]);
        const ranking = [item('A', 10), item('B', 90), item('C', undefined as unknown as number)];
        expect(selectAuditItems(report(ranking), 'TOP10', 'ALL').map(i => i.ticker)).toEqual(['B', 'A', 'C']);
        expect(ranking.map(i => i.ticker)).toEqual(['A', 'B', 'C']);
    });

    it('selectAuditItems: filtro de perfil só vale no ranking; FULL cai no ranking sem fullAuditLog', () => {
        const ranking = [item('D', 50, 'DEFENSIVE'), item('B', 60, 'BOLD')];
        const full = [...ranking, item('X', 99, 'DEFENSIVE')];
        expect(selectAuditItems(report(ranking, full), 'TOP10', 'DEFENSIVE').map(i => i.ticker)).toEqual(['D']);
        expect(selectAuditItems(report(ranking, full), 'FULL', 'DEFENSIVE').map(i => i.ticker)).toEqual(['X', 'B', 'D']);
        expect(selectAuditItems(report(ranking), 'FULL', 'ALL').map(i => i.ticker)).toEqual(['B', 'D']);
    });

    it('formatação de células', () => {
        expect(formatAuditCurrency(undefined)).toBe('-');
        expect(formatAuditCurrency(null)).toBe('-');
        expect(formatAuditCurrency(NaN)).toBe('-');
        expect(formatAuditCurrency(10).replace(/\s/g, ' ')).toBe('R$ 10,00');
        expect(formatAuditDy(undefined)).toBe('0%');
        expect(formatAuditDy(0)).toBe('0%');
        expect(formatAuditDy(2.345)).toBe('2.3%');
        expect(formatAuditRatio(undefined, 1)).toBe('-');
        expect(formatAuditRatio(0, 1)).toBe('0.0');
        expect(formatAuditRatio(7.123, 2)).toBe('7.12');
    });

    it('perfil, badge de score e ação', () => {
        expect(displayProfile(undefined)).toBe('MODERATE');
        expect(displayProfile('BOLD')).toBe('BOLD');
        expect(riskColorClass('DEFENSIVE')).toBe('text-emerald-400');
        expect(riskColorClass('MODERATE')).toBe('text-blue-400');
        expect(riskColorClass('BOLD')).toBe('text-purple-400');
        expect(scoreBadgeClass(70)).toContain('emerald');
        expect(scoreBadgeClass(69.9)).toBe('bg-slate-800 text-slate-400');
        expect(actionBadgeClass('BUY')).toBe('bg-emerald-500 text-black');
        expect(actionBadgeClass('SELL')).toBe('bg-red-500 text-white');
        expect(actionBadgeClass('WAIT')).toBe('bg-slate-700');
    });

    it('nota, anel e veredito nas fronteiras', () => {
        expect([95, 94, 90, 89, 80, 79, 70, 69, 60, 59].map(gradeLetter)).toEqual(['A+', 'A', 'A', 'B+', 'B+', 'B', 'B', 'C', 'C', 'F']);
        expect(gradeRingClass(90)).toContain('border-emerald-500');
        expect(gradeRingClass(80)).toContain('border-blue-500');
        expect(gradeRingClass(70)).toContain('border-slate-400');
        expect(gradeRingClass(69)).toContain('border-red-500');
        expect(verdictText(80)).toBe('Recomendação Forte para o perfil atual.');
        expect(verdictText(65)).toBe('Ativo com fundamentos sólidos, mas pontuação média.');
        expect(verdictText(64)).toBe('Ativo descartado pelo Motor de Decisão por falta de critérios.');
    });

    it('structuralDisplay: ausente vira 0 e o destaque é estritamente acima de 70', () => {
        expect(structuralDisplay(undefined, 'hi')).toEqual({ value: 0, className: 'text-white' });
        expect(structuralDisplay(70, 'hi')).toEqual({ value: 70, className: 'text-white' });
        expect(structuralDisplay(71, 'hi')).toEqual({ value: 71, className: 'hi' });
    });

    it('splitAuditLog separa + e − e só é vazio sem log', () => {
        expect(splitAuditLog(undefined)).toEqual({ positives: [], negatives: [], isEmpty: true });
        expect(splitAuditLog([]).isEmpty).toBe(true);
        const log = [{ category: 'A', factor: 'a', points: 2 }, { category: 'B', factor: 'b', points: 0 }, { category: 'C', factor: 'c', points: -1 }];
        const split = splitAuditLog(log);
        expect(split.positives.map(l => l.category)).toEqual(['A']);
        expect(split.negatives.map(l => l.category)).toEqual(['C']);
        expect(split.isEmpty).toBe(false);
    });

    it('toggleClass escolhe pela flag', () => {
        expect(toggleClass(true, 'on', 'off')).toBe('on');
        expect(toggleClass(false, 'on', 'off')).toBe('off');
    });
});
