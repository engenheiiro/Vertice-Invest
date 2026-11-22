import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
    api: vi.fn(),
    refreshToken: vi.fn(),
    clearSession: vi.fn(),
    setAccessToken: vi.fn(),
    logout: vi.fn(),
    clearCheckoutIntent: vi.fn(),
}));

vi.mock('../services/auth', () => ({
    authService: {
        api: h.api,
        refreshToken: h.refreshToken,
        clearSession: h.clearSession,
        setAccessToken: h.setAccessToken,
        logout: h.logout,
    },
}));
vi.mock('../utils/checkoutIntent', () => ({ clearCheckoutIntent: h.clearCheckoutIntent }));

import { AuthProvider, useAuth, type User } from './AuthContext';

const USER: User = {
    id: 'u1', name: 'Ana', email: 'ana@example.test', plan: 'GUEST', subscriptionStatus: 'ACTIVE', role: 'USER',
};

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
);

const jsonResponse = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
    localStorage.clear();
    queryClient = new QueryClient();
    Object.values(h).forEach(fn => fn.mockReset());
    h.logout.mockResolvedValue(undefined);
    setVisibility('visible');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('AuthContext — bootstrap da sessão', () => {
    it('sem usuário salvo termina deslogado e não tenta refresh', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.user).toBeNull();
        expect(result.current.isAuthenticated).toBe(false);
        expect(h.refreshToken).not.toHaveBeenCalled();
    });

    it('com usuário salvo e refresh válido, restaura a sessão', async () => {
        localStorage.setItem('user', JSON.stringify(USER));
        h.refreshToken.mockResolvedValue('novo-token');
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.user).toEqual(USER);
        expect(result.current.isAuthenticated).toBe(true);
    });

    it('refresh recusado limpa a sessão local e não restaura o usuário', async () => {
        localStorage.setItem('user', JSON.stringify(USER));
        h.refreshToken.mockResolvedValue(null);
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(h.clearSession).toHaveBeenCalledTimes(1);
        expect(result.current.user).toBeNull();
    });

    it('usuário salvo corrompido força logout completo', async () => {
        localStorage.setItem('user', '{corrompido');
        h.refreshToken.mockResolvedValue('tok');
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        await waitFor(() => expect(h.logout).toHaveBeenCalled());
        expect(result.current.user).toBeNull();
        expect(localStorage.getItem('user')).toBeNull();
    });

    it('erro de rede no refresh não quebra: fica deslogado e para de carregar', async () => {
        localStorage.setItem('user', JSON.stringify(USER));
        h.refreshToken.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.user).toBeNull();
    });
});

describe('AuthContext — login, logout e tutorial', () => {
    it('login guarda o usuário, mas o token só em memória', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        act(() => result.current.login(USER, 'access-123'));
        expect(result.current.user).toEqual(USER);
        expect(JSON.parse(localStorage.getItem('user') ?? 'null')).toEqual(USER);
        expect(h.setAccessToken).toHaveBeenCalledWith('access-123');
        expect(JSON.stringify(localStorage)).not.toContain('access-123');
    });

    it('logout limpa usuário, intenção de compra e cache, mesmo com falha de rede', async () => {
        h.logout.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        act(() => result.current.login(USER, 'tok'));
        queryClient.setQueryData(['wallet'], { segredo: 1 });

        await act(async () => { await result.current.logout(); });

        expect(result.current.user).toBeNull();
        expect(localStorage.getItem('user')).toBeNull();
        expect(h.clearCheckoutIntent).toHaveBeenCalledTimes(1);
        expect(queryClient.getQueryData(['wallet'])).toBeUndefined();
    });

    it('updateUserTutorialStatus marca o tutorial como visto e persiste; sem usuário não faz nada', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        act(() => result.current.updateUserTutorialStatus());
        expect(localStorage.getItem('user')).toBeNull();

        act(() => result.current.login({ ...USER, hasSeenTutorial: false }, 'tok'));
        act(() => result.current.updateUserTutorialStatus());
        expect(result.current.user?.hasSeenTutorial).toBe(true);
        expect(JSON.parse(localStorage.getItem('user') ?? 'null').hasSeenTutorial).toBe(true);
    });
});

describe('AuthContext — refreshProfile', () => {
    const logado = async () => {
        const hook = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
        act(() => hook.result.current.login(USER, 'tok'));
        return hook;
    };

    it('mescla o plano novo ao usuário salvo e invalida as queries', async () => {
        const { result } = await logado();
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        h.api.mockResolvedValue(jsonResponse({ current: { plan: 'PRO', subscriptionStatus: 'ACTIVE' } }));

        await act(async () => { await result.current.refreshProfile(); });

        expect(h.api).toHaveBeenCalledWith('/api/subscription/status');
        expect(result.current.user).toMatchObject({ id: 'u1', name: 'Ana', plan: 'PRO' });
        expect(JSON.parse(localStorage.getItem('user') ?? 'null').plan).toBe('PRO');
        expect(invalidate).toHaveBeenCalled();
    });

    it('resposta não-ok mantém o usuário como estava', async () => {
        const { result } = await logado();
        h.api.mockResolvedValue(jsonResponse({}, false, 500));
        await act(async () => { await result.current.refreshProfile(); });
        expect(result.current.user?.plan).toBe('GUEST');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('500'));
    });

    it('resposta sem `current` não altera nada', async () => {
        const { result } = await logado();
        h.api.mockResolvedValue(jsonResponse({}));
        await act(async () => { await result.current.refreshProfile(); });
        expect(result.current.user).toEqual(USER);
    });

    it('exceção vira console.error e não derruba a sessão', async () => {
        const { result } = await logado();
        h.api.mockRejectedValue(new Error('boom'));
        await act(async () => { await result.current.refreshProfile(); });
        expect(result.current.user).toEqual(USER);
        expect(console.error).toHaveBeenCalled();
    });
});

describe('AuthContext — re-sincroniza ao voltar o foco', () => {
    it('foco com aba visível atualiza; dentro de 20s não repete; depois de 20s repete', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        h.api.mockResolvedValue(jsonResponse({}));
        act(() => result.current.login(USER, 'tok'));

        await act(async () => { window.dispatchEvent(new Event('focus')); });
        expect(h.api).toHaveBeenCalledTimes(1);

        vi.setSystemTime(new Date('2026-11-22T12:00:10Z'));
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(h.api).toHaveBeenCalledTimes(1);

        vi.setSystemTime(new Date('2026-11-22T12:00:25Z'));
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        expect(h.api).toHaveBeenCalledTimes(2);
    });

    it('aba escondida não dispara a atualização', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        act(() => result.current.login(USER, 'tok'));
        setVisibility('hidden');
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(h.api).not.toHaveBeenCalled();
    });

    it('deslogado não escuta o foco', async () => {
        const { result } = renderHook(() => useAuth(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        expect(h.api).not.toHaveBeenCalled();
    });
});

describe('useAuth fora do provider', () => {
    it('lança erro explicando o uso correto', () => {
        expect(() => renderHook(() => useAuth())).toThrow('useAuth deve ser usado dentro de um AuthProvider');
    });
});
