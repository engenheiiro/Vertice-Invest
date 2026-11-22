/**
 * Testes do SecuritySection (Perfil → Segurança & Acesso).
 *
 * Cobre o fluxo real do MFA (status inicial, senha → QR → código → códigos de
 * backup; desativação pelo segundo fator), erros devolvidos pelo servidor e a
 * troca de senha com as validações locais (tamanho, confirmação).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { axe } from 'jest-axe';
import { SecuritySection } from './SecuritySection';
import { authService } from '../../services/auth';

vi.mock('../../services/auth', () => ({
  authService: {
    getMfaStatus: vi.fn(),
    setupMfa: vi.fn(),
    enableMfa: vi.fn(),
    disableMfa: vi.fn(),
    changePassword: vi.fn(),
  },
}));

const auth = vi.mocked(authService);
type Resolved<K extends keyof typeof authService> = Awaited<ReturnType<(typeof authService)[K]>>;

const toggle = (name: string) => screen.findByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
  auth.getMfaStatus.mockResolvedValue({ mfaEnabled: false } as Resolved<'getMfaStatus'>);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MFA — ativação', () => {
  it('pede a senha, mostra o QR e entrega os códigos de backup', async () => {
    auth.setupMfa.mockResolvedValue({ secret: 'ABCDSECRET', qr: 'data:image/png;base64,xx' } as Resolved<'setupMfa'>);
    auth.enableMfa.mockResolvedValue({ backupCodes: ['1111-2222', '3333-4444'] } as Resolved<'enableMfa'>);
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { container } = render(<SecuritySection />);
    const btn = await toggle('Ativar 2FA');
    await waitFor(() => expect(btn).toBeEnabled());
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(btn);
    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'minhaSenha' } });
    fireEvent.click(continuar);

    expect(await screen.findByAltText('QR Code do MFA')).toBeInTheDocument();
    expect(auth.setupMfa).toHaveBeenCalledWith('minhaSenha');
    expect(screen.getByText('ABCDSECRET')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: ' 123456 ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ativar 2FA' })[1]);

    expect(await screen.findByText('2FA ativado! Guarde seus códigos de backup')).toBeInTheDocument();
    expect(auth.enableMfa).toHaveBeenCalledWith('123456');
    expect(screen.getByText('1111-2222')).toBeInTheDocument();
    expect(screen.getByText('Ativo — exige um código do app a cada login.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Copiar todos/ }));
    expect(writeText).toHaveBeenCalledWith('1111-2222\n3333-4444');
    expect(screen.getByText('Copiado!')).toBeInTheDocument();
  });

  it('erro na senha mostra a mensagem do servidor e Cancelar volta ao início', async () => {
    auth.setupMfa.mockRejectedValue(new Error('Senha incorreta.'));
    render(<SecuritySection />);
    const btn = await toggle('Ativar 2FA');
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Senha incorreta.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
  });

  it('código inválido mantém o QR na tela com o erro padrão', async () => {
    auth.setupMfa.mockResolvedValue({ secret: 'S', qr: 'q' } as Resolved<'setupMfa'>);
    auth.enableMfa.mockRejectedValue({});
    render(<SecuritySection />);
    const btn = await toggle('Ativar 2FA');
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByAltText('QR Code do MFA');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ativar 2FA' })[1]);
    expect(await screen.findByText('Código inválido.')).toBeInTheDocument();
    expect(screen.getByAltText('QR Code do MFA')).toBeInTheDocument();
  });

  it('status que falha mantém o MFA como desativado', async () => {
    auth.getMfaStatus.mockRejectedValue(new Error('offline'));
    render(<SecuritySection />);
    const btn = await toggle('Ativar 2FA');
    await waitFor(() => expect(btn).toBeEnabled());
    expect(screen.getByText('Adiciona uma camada extra via App Autenticador.')).toBeInTheDocument();
  });
});

describe('MFA — desativação', () => {
  beforeEach(() => {
    auth.getMfaStatus.mockResolvedValue({ mfaEnabled: true } as Resolved<'getMfaStatus'>);
  });

  it('exige o código e desativa', async () => {
    auth.disableMfa.mockResolvedValue({} as Resolved<'disableMfa'>);
    render(<SecuritySection />);
    fireEvent.click(await toggle('Desativar 2FA'));
    const desativar = screen.getByRole('button', { name: 'Desativar' });
    expect(desativar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Código do app ou de recuperação'), { target: { value: '654321' } });
    fireEvent.click(desativar);

    expect(await screen.findByRole('button', { name: 'Ativar 2FA' })).toBeInTheDocument();
    expect(auth.disableMfa).toHaveBeenCalledWith({ token: '654321' });
  });

  it('recusa do servidor aparece como erro', async () => {
    auth.disableMfa.mockRejectedValue('Código expirado.');
    render(<SecuritySection />);
    fireEvent.click(await toggle('Desativar 2FA'));
    fireEvent.change(screen.getByLabelText('Código do app ou de recuperação'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }));
    expect(await screen.findByText('Código expirado.')).toBeInTheDocument();
  });
});

describe('troca de senha', () => {
  const openForm = async () => {
    render(<SecuritySection />);
    await toggle('Ativar 2FA');
    fireEvent.keyDown(screen.getByRole('button', { name: /Alterar Senha/ }), { key: 'Enter' });
    expect(screen.getByText('Preencha os campos abaixo')).toBeInTheDocument();
  };
  const fill = (oldP: string, newP: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText('Senha Atual'), { target: { value: oldP } });
    fireEvent.change(screen.getByLabelText('Nova Senha'), { target: { value: newP } });
    fireEvent.change(screen.getByLabelText('Confirmar Nova Senha'), { target: { value: confirm } });
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar Senha' }));
  };

  it('recusa senha curta e confirmação diferente sem chamar a API', async () => {
    await openForm();
    fill('antiga', '123', '123');
    expect(screen.getByText('A nova senha deve ter no mínimo 6 caracteres.')).toBeInTheDocument();
    fill('antiga', '1234567', '7654321');
    expect(screen.getByText('As novas senhas não conferem.')).toBeInTheDocument();
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('altera a senha e recolhe o formulário depois de 2 s', async () => {
    auth.changePassword.mockResolvedValue({} as Resolved<'changePassword'>);
    await openForm();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fill('antiga', 'novaSenha1', 'novaSenha1');
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Senha alterada com sucesso!')).toBeInTheDocument();
    expect(auth.changePassword).toHaveBeenCalledWith({ oldPassword: 'antiga', newPassword: 'novaSenha1' });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('Clique para redefinir sua senha de acesso')).toBeInTheDocument();
  });

  it('erro do servidor aparece e Cancelar fecha', async () => {
    auth.changePassword.mockRejectedValue(new Error('Senha atual incorreta.'));
    await openForm();
    fill('errada', 'novaSenha1', 'novaSenha1');
    expect(await screen.findByText('Senha atual incorreta.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Nova Senha')).not.toBeInTheDocument();
  });
});
