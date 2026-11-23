/**
 * Testes do usePasswordChange: validação local antes da API, sucesso que
 * recolhe o formulário em 2 s e erro do servidor.
 */
import type React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePasswordChange } from './usePasswordChange';
import { authService } from '../../services/auth';

vi.mock('../../services/auth', () => ({ authService: { changePassword: vi.fn() } }));

const auth = vi.mocked(authService);
const change = (name: string, value: string) => ({ target: { name, value } }) as React.ChangeEvent<HTMLInputElement>;
const submitEvent = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent;

const fill = (result: { current: ReturnType<typeof usePasswordChange> }, oldP: string, newP: string, confirm: string) => {
  act(() => { result.current.handleChangePwd(change('oldPassword', oldP)); });
  act(() => { result.current.handleChangePwd(change('newPassword', newP)); });
  act(() => { result.current.handleChangePwd(change('confirmPassword', confirm)); });
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('usePasswordChange', () => {
  it('abre, fecha e limpa a mensagem', async () => {
    const { result } = renderHook(() => usePasswordChange());
    act(() => { result.current.openForm(); });
    expect(result.current.isChangingPassword).toBe(true);
    fill(result, 'a', '1', '1');
    await act(async () => { await result.current.submitChangePassword(submitEvent()); });
    expect(result.current.pwdMsg).not.toBeNull();
    act(() => { result.current.closeForm(); });
    expect(result.current).toMatchObject({ isChangingPassword: false, pwdMsg: null });
  });

  it('recusa senha curta e confirmação diferente sem chamar a API', async () => {
    const { result } = renderHook(() => usePasswordChange());
    fill(result, 'senhaTeste1', '12345', '12345');
    await act(async () => { await result.current.submitChangePassword(submitEvent()); });
    expect(result.current.pwdMsg?.text).toBe('A nova senha deve ter no mínimo 6 caracteres.');
    fill(result, 'senhaTeste1', '123456', '654321');
    await act(async () => { await result.current.submitChangePassword(submitEvent()); });
    expect(result.current.pwdMsg?.text).toBe('As novas senhas não conferem.');
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('sucesso manda só senha atual e nova, limpa e recolhe em 2 s', async () => {
    auth.changePassword.mockResolvedValue({});
    const { result } = renderHook(() => usePasswordChange());
    act(() => { result.current.openForm(); });
    fill(result, 'senhaTeste1', 'senhaTeste2', 'senhaTeste2');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await act(async () => { await result.current.submitChangePassword(submitEvent()); });
    expect(auth.changePassword).toHaveBeenCalledWith({ oldPassword: 'senhaTeste1', newPassword: 'senhaTeste2' });
    expect(result.current.pwdMsg).toEqual({ type: 'success', text: 'Senha alterada com sucesso!' });
    expect(result.current.pwdData).toEqual({ oldPassword: '', newPassword: '', confirmPassword: '' });
    act(() => { vi.advanceTimersByTime(1999); });
    expect(result.current.isChangingPassword).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toMatchObject({ isChangingPassword: false, pwdMsg: null });
  });

  it('erro do servidor (ou sem mensagem) aparece e libera o botão', async () => {
    auth.changePassword.mockRejectedValueOnce(new Error('Senha atual incorreta (teste).')).mockRejectedValueOnce({});
    const { result } = renderHook(() => usePasswordChange());
    fill(result, 'x', 'senhaTeste2', 'senhaTeste2');
    await act(async () => { await result.current.submitChangePassword(submitEvent()); });
    expect(result.current.pwdMsg?.text).toBe('Senha atual incorreta (teste).');
    await act(async () => { await result.current.submitChangePassword(submitEvent()); });
    expect(result.current).toMatchObject({ pwdMsg: { type: 'error', text: 'Erro ao alterar senha.' }, loadingPwd: false });
  });
});
