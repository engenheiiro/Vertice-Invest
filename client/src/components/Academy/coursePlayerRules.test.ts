import { describe, it, expect } from 'vitest';
import {
    areAllCompleted,
    completedIdsFrom,
    emptyAnswers,
    isLessonLocked,
    passedAttemptResult,
    pickInitialLesson,
    withAnswer,
} from './coursePlayerRules';

const LESSONS = [
    { _id: 'l1', title: 'Um' },
    { _id: 'l2', title: 'Dois' },
    { _id: 'l3', title: 'Três' },
];

describe('coursePlayerRules', () => {
    it('aula inicial: a da query, ou a primeira quando ausente ou inexistente', () => {
        expect(pickInitialLesson(LESSONS, 'l2')._id).toBe('l2');
        expect(pickInitialLesson(LESSONS, null)._id).toBe('l1');
        expect(pickInitialLesson(LESSONS, '')._id).toBe('l1');
        expect(pickInitialLesson(LESSONS, 'nao-existe')._id).toBe('l1');
    });

    it('progresso: só entram as aulas concluídas', () => {
        expect(completedIdsFrom([{ lessonId: 'l1', completed: true }, { lessonId: 'l2', completed: false }, { lessonId: 'l3' }])).toEqual(['l1']);
    });

    it('trava sequencial: a primeira sempre abre; as outras dependem da anterior', () => {
        expect(isLessonLocked(LESSONS, 0, [])).toBe(false);
        expect(isLessonLocked(LESSONS, 1, [])).toBe(true);
        expect(isLessonLocked(LESSONS, 1, ['l1'])).toBe(false);
        expect(isLessonLocked(LESSONS, 2, ['l1'])).toBe(true);
    });

    it('tudo concluído exige ao menos uma aula e contagem suficiente', () => {
        expect(areAllCompleted([], [])).toBe(false);
        expect(areAllCompleted(LESSONS, ['l1', 'l2'])).toBe(false);
        expect(areAllCompleted(LESSONS, ['l1', 'l2', 'l3'])).toBe(true);
    });

    it('quem já passou recebe o resultado aprovado com o mínimo padrão de 70', () => {
        const attempt = { passed: true, score: 88 };
        expect(passedAttemptResult(attempt)).toEqual({ passed: true, score: 88, passingScore: 70, attempt });
    });

    it('respostas: começam em -1 e a escolha não muta a lista anterior', () => {
        const blank = emptyAnswers(3);
        expect(blank).toEqual([-1, -1, -1]);
        expect(withAnswer(blank, 1, 2)).toEqual([-1, 2, -1]);
        expect(blank).toEqual([-1, -1, -1]);
    });
});
