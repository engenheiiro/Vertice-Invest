/**
 * Testes do useMfaFlow: status inicial, ativação (senha → QR → código),
 * desativação pelo segundo fator, mensagens de erro e códigos de backup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMfaFlow } from './useMfaFlow';
import { authService } from '../../services/auth';

vi.mock('../../services/auth', () => ({
  authService: { getMfaStatus: vi.fn(), setupMfa: vi.fn(), enableMfa: vi.fn(), disableMfa: vi.fn() },
}));

const auth = vi.mocked(authService);
type Resolved<K extends keyof typeof authService> = Awaited<ReturnType<(typeof authService)[K]>>;

const mount = async (enabled = false) => {
  auth.getMfaStatus.mockResolvedValue({ mfaEnabled: enabled });
  const view = renderHook(() => useMfaFlow());
  await waitFor(() => expect(view.result.current.mfaStatusLoading).toBe(false));
  return view;
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('useMfaFlow', () => {
  it('ativa: senha → QR → código (aparado) → códigos de backup', async () => {
    auth.setupMfa.mockResolvedValue({ secret: 'SEGREDO-DE-TESTE', qr: 'q', otpauth: 'o' });
    auth.enableMfa.mockResolvedValue({ backupCodes: ['aaaa-1111'] });
    const { result } = await mount();
    act(() => { result.current.toggleMfa(); });
    expect(result.current.mode).toBe('setup');
    act(() => { result.current.changeSetupPassword('senhaTeste1'); });
    await act(async () => { await result.current.confirmSetupPassword(); });
    expect(auth.setupMfa).toHaveBeenCalledWith('senhaTeste1');
    expect(result.current.setupData).toEqual({ secret: 'SEGREDO-DE-TESTE', qr: 'q' });
    expect(result.current.setupPassword).toBe('');
    act(() => { result.current.changeMfaCode(' 123456 '); });
    await act(async () => { await result.current.confirmEnable(); });
    expect(auth.enableMfa).toHaveBeenCalledWith('123456');
    expect(result.current).toMatchObject({ mfaEnabled: true, mode: 'idle', setupData: null, mfaCode: '', backupCodes: ['aaaa-1111'] });
  });

  it('enable sem backupCodes vira lista vazia; erro sem mensagem usa o padrão', async () => {
    auth.enableMfa.mockResolvedValueOnce({} as Resolved<'enableMfa'>).mockRejectedValueOnce({});
    const { result } = await mount();
    await act(async () => { await result.current.confirmEnable(); });
    expect(result.current.backupCodes).toEqual([]);
    await act(async () => { await result.current.confirmEnable(); });
    expect(result.current.mfaMsg).toEqual({ type: 'error', text: 'Código inválido.' });
    expect(result.current.mfaBusy).toBe(false);
  });

  it('desativa com o código aparado e volta ao estado inicial; recusa mostra o erro', async () => {
    auth.disableMfa.mockRejectedValueOnce(new Error('Código expirado (teste).')).mockResolvedValueOnce(undefined);
    const { result } = await mount(true);
    act(() => { result.current.toggleMfa(); });
    expect(result.current.mode).toBe('disable');
    act(() => { result.current.changeMfaCode(' 654321 '); });
    await act(async () => { await result.current.confirmDisable(); });
    expect(result.current.mfaMsg?.text).toBe('Código expirado (teste).');
    await act(async () => { await result.current.confirmDisable(); });
    expect(auth.disableMfa).toHaveBeenLastCalledWith({ token: '654321' });
    expect(result.current).toMatchObject({ mfaEnabled: false, mode: 'idle', mfaCode: '', mfaMsg: null });
  });

  it('status que falha mantém desativado; erro de setup sem mensagem usa o padrão', async () => {
    auth.getMfaStatus.mockRejectedValue(new Error('offline'));
    auth.setupMfa.mockRejectedValue('');
    const { result } = renderHook(() => useMfaFlow());
    await waitFor(() => expect(result.current.mfaStatusLoading).toBe(false));
    expect(result.current.mfaEnabled).toBe(false);
    await act(async () => { await result.current.confirmSetupPassword(); });
    expect(result.current.mfaMsg?.text).toBe('Erro ao iniciar o MFA.');
  });

  it('copia os códigos e desfaz o "copiado" depois de 1,5 s; fechar some com eles', async () => {
    auth.enableMfa.mockResolvedValue({ backupCodes: ['aaaa-1111', 'bbbb-2222'] });
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { result } = await mount();
    await act(async () => { await result.current.confirmEnable(); });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    act(() => { result.current.copyBackup(); });
    expect(writeText).toHaveBeenCalledWith('aaaa-1111\nbbbb-2222');
    expect(result.current.copied).toBe(true);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.copied).toBe(false);
    act(() => { result.current.closeBackup(); });
    expect(result.current.backupCodes).toBeNull();
  });
});
