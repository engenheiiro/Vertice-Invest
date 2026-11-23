/**
 * Regras puras do player de curso da Academy: aula inicial, progresso, trava
 * sequencial e resultado de quem já passou no teste final.
 */

export interface CourseLesson {
    _id: string;
    title: string;
    description?: string;
    duration?: number;
    youtubeId?: string;
}

export interface QuizQuestion {
    text: string;
    options: string[];
}

export interface CourseQuiz {
    questions: QuizQuestion[];
}

export interface QuizAttempt {
    passed?: boolean;
    score: number;
}

export interface QuizResult {
    passed: boolean;
    score: number;
    passingScore: number;
    attempt: QuizAttempt;
}

interface ProgressEntry {
    lessonId: string;
    completed?: boolean;
}

/** Nota mínima exibida a quem já passou (o servidor não devolve a do quiz). */
const DEFAULT_PASSING_SCORE = 70;

/** Aula pedida na query; ausente ou inexistente cai na primeira. */
export function pickInitialLesson(lessons: CourseLesson[], lessonId: string | null): CourseLesson {
    const initial = lessonId ? lessons.find((l) => l._id === lessonId) : lessons[0];
    return initial || lessons[0];
}

export function completedIdsFrom(progress: ProgressEntry[]): string[] {
    return progress.filter((p) => p.completed).map((p) => p.lessonId);
}

/** A primeira aula está sempre aberta; as outras, só com a anterior concluída. */
export function isLessonLocked(lessons: CourseLesson[], idx: number, completed: string[]): boolean {
    return idx > 0 && !completed.includes(lessons[idx - 1]._id);
}

export function areAllCompleted(lessons: CourseLesson[], completed: string[]): boolean {
    return lessons.length > 0 && completed.length >= lessons.length;
}

/** Quem já passou vê o resultado direto, sem refazer o teste. */
export function passedAttemptResult(attempt: QuizAttempt): QuizResult {
    return { passed: true, score: attempt.score, passingScore: DEFAULT_PASSING_SCORE, attempt };
}

export function emptyAnswers(count: number): number[] {
    return new Array(count).fill(-1);
}

export function withAnswer(answers: number[], questionIdx: number, optionIdx: number): number[] {
    const next = [...answers];
    next[questionIdx] = optionIdx;
    return next;
}
