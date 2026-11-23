import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePerformanceHistory } from './usePerformanceHistory';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
vi.mock('../../data/DEMO_DATA', () => ({ DEMO_PERFORMANCE: [{ date: '2026-01-01', wallet: 1 }] }));

const getPerformance = vi.fn();

function setup(demo: boolean, ready = true) {
    vi.mocked(useDemo).mockReturnValue({ isDemoMode: demo } as unknown as ReturnType<typeof useDemo>);
    vi.mocked(useWallet).mockReturnValue({
        activeWalletId: 'w1', isWalletScopeReady: ready, dataSource: { getPerformance },
    } as unknown as ReturnType<typeof useWallet>);
    return renderHook(() => usePerformanceHistory());
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('usePerformanceHistory', () => {
    it('busca, ordena e encerra o carregamento', async () => {
        getPerformance.mockResolvedValue({ history: [{ date: '2026-02-01' }, { date: '2026-01-01' }] });
        const { result } = setup(false);
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.data.map((p) => p.date)).toEqual(['2026-01-01', '2026-02-01']);
    });

    it('erro da API vira série vazia', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        getPerformance.mockRejectedValue(new Error('offline'));
        const { result } = setup(false);
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.data).toEqual([]);
        spy.mockRestore();
    });

    it('demo usa os dados de demonstração sem chamar a API', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const { result } = setup(true);
        await act(async () => { vi.advanceTimersByTime(600); });
        expect(result.current.data).toHaveLength(1);
        expect(result.current.isDemoMode).toBe(true);
        expect(getPerformance).not.toHaveBeenCalled();
    });

    it('não busca antes de o escopo da carteira ficar pronto', () => {
        const { result } = setup(false, false);
        expect(result.current.isLoading).toBe(true);
        expect(getPerformance).not.toHaveBeenCalled();
    });
});
