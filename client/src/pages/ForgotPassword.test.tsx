/**
 * Recuperação de senha: pedir o link e redefinir com o token.
 *
 * O que fica travado:
 *  - e-mail inválido não chama a API;
 *  - o pedido aceito mostra "Verifique seu email" (mesma tela exista ou não a
 *    conta — o servidor não revela cadastro);
 *  - sem token na URL, a redefinição nem mostra o formulário;
 *  - senhas diferentes não chamam a API; erro do servidor aparece na tela;
 *  - redefinida a senha, a pessoa volta ao login.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { axe } from 'jest-axe';
import { ForgotPassword } from './ForgotPassword';
import { ResetPassword } from './ResetPassword';
import { authService } from '../services/auth';

vi.mock('../services/auth', () => ({ authService: { forgotPassword: vi.fn(), resetPassword: vi.fn() } }));

const auth = vi.mocked(authService);
const SENHA_FORTE = 'Vertice#2026forte';

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/forgot" element={<ForgotPassword />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="/login" element={<div>tela de login</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe('ForgotPassword', () => {
  it('e-mail inválido mostra o erro e não chama a API', () => {
    renderAt('/forgot');
    fireEvent.change(screen.getByLabelText('Email Cadastrado'), { target: { value: 'nao-e-email' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar Link/ }));
    expect(auth.forgotPassword).not.toHaveBeenCalled();
  });

  it('pedido aceito leva à tela "Verifique seu email" com o endereço digitado', async () => {
    auth.forgotPassword.mockResolvedValue(undefined);
    renderAt('/forgot');
    fireEvent.change(screen.getByLabelText('Email Cadastrado'), { target: { value: 'ana@exemplo.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar Link/ }));
    await waitFor(() => expect(auth.forgotPassword).toHaveBeenCalledWith('ana@exemplo.com'));
    expect(await screen.findByText('Verifique seu email', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('ana@exemplo.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para o Login' }));
    expect(screen.getByText('tela de login')).toBeInTheDocument();
  });

  it('falha do servidor não sai da tela do formulário', async () => {
    auth.forgotPassword.mockRejectedValue(new Error('fora do ar'));
    renderAt('/forgot');
    fireEvent.change(screen.getByLabelText('Email Cadastrado'), { target: { value: 'ana@exemplo.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar Link/ }));
    await waitFor(() => expect(auth.forgotPassword).toHaveBeenCalled());
    expect(screen.getByText('Recuperar Acesso')).toBeInTheDocument();
    expect(screen.queryByText('Verifique seu email')).not.toBeInTheDocument();
  });

  it('sem violações de acessibilidade', async () => {
    const { container } = renderAt('/forgot');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ResetPassword', () => {
  it('sem token na URL mostra "Link Inválido" e nenhum formulário', () => {
    renderAt('/reset');
    expect(screen.getByText('Link Inválido')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nova Senha')).not.toBeInTheDocument();
  });

  it('senhas diferentes não chamam a API', () => {
    renderAt('/reset?token=abc');
    fireEvent.change(screen.getByLabelText('Nova Senha'), { target: { value: SENHA_FORTE } });
    fireEvent.change(screen.getByLabelText('Confirmar Nova Senha'), { target: { value: `${SENHA_FORTE}x` } });
    fireEvent.click(screen.getByRole('button', { name: /Alterar Senha/ }));
    expect(auth.resetPassword).not.toHaveBeenCalled();
  });

  it('erro do servidor aparece na tela', async () => {
    auth.resetPassword.mockRejectedValue(new Error('Link expirado'));
    renderAt('/reset?token=abc');
    fireEvent.change(screen.getByLabelText('Nova Senha'), { target: { value: SENHA_FORTE } });
    fireEvent.change(screen.getByLabelText('Confirmar Nova Senha'), { target: { value: SENHA_FORTE } });
    fireEvent.click(screen.getByRole('button', { name: /Alterar Senha/ }));
    expect(await screen.findByText('Link expirado')).toBeInTheDocument();
  });

  it('erro sem mensagem cai no texto padrão', async () => {
    auth.resetPassword.mockRejectedValue('x');
    renderAt('/reset?token=abc');
    fireEvent.change(screen.getByLabelText('Nova Senha'), { target: { value: SENHA_FORTE } });
    fireEvent.change(screen.getByLabelText('Confirmar Nova Senha'), { target: { value: SENHA_FORTE } });
    fireEvent.click(screen.getByRole('button', { name: /Alterar Senha/ }));
    expect(await screen.findByText('Erro ao redefinir senha. O link pode ter expirado.')).toBeInTheDocument();
  });

  it('senha redefinida volta ao login', async () => {
    auth.resetPassword.mockResolvedValue(undefined);
    renderAt('/reset?token=tok-123');
    fireEvent.change(screen.getByLabelText('Nova Senha'), { target: { value: SENHA_FORTE } });
    fireEvent.change(screen.getByLabelText('Confirmar Nova Senha'), { target: { value: SENHA_FORTE } });
    fireEvent.click(screen.getByRole('button', { name: /Alterar Senha/ }));
    await waitFor(() => expect(auth.resetPassword).toHaveBeenCalledWith('tok-123', SENHA_FORTE));
    expect(await screen.findByText('tela de login', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('sem violações de acessibilidade', async () => {
    const { container } = renderAt('/reset?token=abc');
    expect(await axe(container)).toHaveNoViolations();
  });
});
