import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ api: vi.fn(), addToast: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../services/auth', () => ({ authService: { api: mocks.api } }));

import { useCoursePlayer } from './useCoursePlayer';

const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
const LESSONS = [{ _id: 'l1', title: 'Um', duration: 60 }, { _id: 'l2', title: 'Dois', duration: 90 }];

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={['/courses/c1?lesson=l2']}>
        <Routes>
            <Route path="/courses/:courseId" element={<>{children}</>} />
        </Routes>
    </MemoryRouter>
);

let progress: { progress: unknown[]; quizAttempts: unknown[] };

beforeEach(() => {
    vi.clearAllMocks();
    progress = { progress: [{ lessonId: 'l1', completed: true }, { lessonId: 'l2', completed: true }], quizAttempts: [] };
    mocks.api.mockImplementation((url: string) => {
        if (url === '/api/academy/courses/c1') return ok({ course: { title: 'Curso' }, lessons: LESSONS });
        if (url === '/api/academy/progress/c1') return ok(progress);
        return ok({ questions: [{ text: 'P', options: ['A'] }] });
    });
});

describe('useCoursePlayer', () => {
    it('carrega a aula da query e o progresso, com tudo concluído', async () => {
        const { result } = renderHook(() => useCoursePlayer(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.currentLesson?._id).toBe('l2');
        expect(result.current.allCompleted).toBe(true);
    });

    it('quem já passou abre o resultado aprovado sem buscar o quiz', async () => {
        progress.quizAttempts = [{ passed: true, score: 95 }];
        const { result } = renderHook(() => useCoursePlayer(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.handleTestButtonClick());
        expect(result.current.showQuiz).toBe(true);
        expect(result.current.quizResult).toEqual({ passed: true, score: 95, passingScore: 70, attempt: { passed: true, score: 95 } });
        expect(mocks.api).not.toHaveBeenCalledWith('/api/academy/quiz/c1');
    });

    it('fim da última aula com tudo concluído abre o teste e busca as perguntas', async () => {
        const { result } = renderHook(() => useCoursePlayer(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.handleVideoEnded());
        expect(result.current.showQuiz).toBe(true);
        await waitFor(() => expect(result.current.quizAnswers).toEqual([-1]));
    });
});
