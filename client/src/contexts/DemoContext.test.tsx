import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// Estado mockado de auth/serviço, manipulável por teste (vi.hoisted p/ hoisting do vi.mock).
const h = vi.hoisted(() => ({
    user: { id: 'u1', name: 'Teste', hasSeenTutorial: false } as any,
    updateUserTutorialStatus: vi.fn(),
    markTutorialSeen: vi.fn().mockResolvedValue({}),
}));

vi.mock('./AuthContext', () => ({
    useAuth: () => ({ user: h.user, updateUserTutorialStatus: h.updateUserTutorialStatus }),
}));
vi.mock('../services/auth', () => ({
    authService: { markTutorialSeen: h.markTutorialSeen },
}));

import { DemoProvider, useDemo } from './DemoContext';

const makeWrapper = (path = '/dashboard') => ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>
        <DemoProvider>{children}</DemoProvider>
    </MemoryRouter>
);

beforeEach(() => {
    h.user = { id: 'u1', name: 'Teste', hasSeenTutorial: false };
    h.updateUserTutorialStatus.mockClear();
    h.markTutorialSeen.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('DemoContext — auto-início', () => {
    it('inicia sozinho no /dashboard quando hasSeenTutorial é false (após delay)', () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useDemo(), { wrapper: makeWrapper('/dashboard') });
        expect(result.current.isDemoMode).toBe(false);
        act(() => { vi.advanceTimersByTime(1300); });
        expect(result.current.isDemoMode).toBe(true);
    });

    it('NÃO inicia quando o usuário já viu o tutorial', () => {
        h.user = { id: 'u1', name: 'Teste', hasSeenTutorial: true };
        vi.useFakeTimers();
        const { result } = renderHook(() => useDemo(), { wrapper: makeWrapper('/dashboard') });
        act(() => { vi.advanceTimersByTime(1300); });
        expect(result.current.isDemoMode).toBe(false);
    });

    it('NÃO inicia fora da rota /dashboard', () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useDemo(), { wrapper: makeWrapper('/wallet') });
        act(() => { vi.advanceTimersByTime(1300); });
        expect(result.current.isDemoMode).toBe(false);
    });
});

describe('DemoContext — controles', () => {
    it('startDemo liga o modo demo; stopDemo desliga e persiste a flag', () => {
        // rota /wallet evita o auto-início interferir
        const { result } = renderHook(() => useDemo(), { wrapper: makeWrapper('/wallet') });

        act(() => { result.current.startDemo(); });
        expect(result.current.isDemoMode).toBe(true);

        act(() => { result.current.stopDemo(); });
        expect(result.current.isDemoMode).toBe(false);
        expect(h.markTutorialSeen).toHaveBeenCalledTimes(1);
        expect(h.updateUserTutorialStatus).toHaveBeenCalledTimes(1);
    });

    it('navega entre passos com clamp inferior em 0 e resetStep', () => {
        const { result } = renderHook(() => useDemo(), { wrapper: makeWrapper('/wallet') });
        act(() => { result.current.startDemo(); });

        act(() => { result.current.nextStep(); });
        act(() => { result.current.nextStep(); });
        expect(result.current.currentStep).toBe(2);

        act(() => { result.current.prevStep(); });
        expect(result.current.currentStep).toBe(1);

        act(() => { result.current.prevStep(); });
        act(() => { result.current.prevStep(); });
        expect(result.current.currentStep).toBe(0); // não fica negativo

        act(() => { result.current.nextStep(); });
        act(() => { result.current.resetStep(); });
        expect(result.current.currentStep).toBe(0);
    });

    it('skipTutorial encerra o modo demo', () => {
        const { result } = renderHook(() => useDemo(), { wrapper: makeWrapper('/wallet') });
        act(() => { result.current.startDemo(); });
        act(() => { result.current.skipTutorial(); });
        expect(result.current.isDemoMode).toBe(false);
    });
});
