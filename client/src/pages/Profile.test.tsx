/**
 * Página de Perfil: as ações de conta que moram aqui (as seções de identidade,
 * dados, segurança e assinatura têm componente e teste próprios).
 *
 * O que fica travado:
 *  - exportar dados (LGPD Art. 18) avisa sucesso ou o erro real;
 *  - desativar só sai com senha, e o sucesso encerra a sessão e leva ao login;
 *  - excluir exige senha + "EXCLUIR" digitado e, com 2FA ligado, o código;
 *  - "Rever tutorial" liga o demo e leva ao Terminal;
 *  - o botão do tema ativo não alterna de novo.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { axe } from 'jest-axe';
import { Profile } from './Profile';
import { authService } from '../services/auth';
import { TERMINAL_ROUTE } from '../config/homeRoute';

const h = vi.hoisted(() => ({
  user: { mfaEnabled: false } as { mfaEnabled: boolean },
  logout: vi.fn(),
  addToast: vi.fn(),
  startDemo: vi.fn(),
  toggleTheme: vi.fn(),
  theme: 'dark' as 'dark' | 'light',
}));

vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../components/profile/ProfileIdentity', () => ({ ProfileIdentity: () => null }));
vi.mock('../components/profile/ProfileSettings', () => ({ ProfileSettings: () => null }));
vi.mock('../components/profile/SecuritySection', () => ({ SecuritySection: () => null }));
vi.mock('../components/profile/SubscriptionCard', () => ({ SubscriptionCard: () => null }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user, logout: h.logout }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: h.addToast }) }));
vi.mock('../contexts/DemoContext', () => ({ useDemo: () => ({ startDemo: h.startDemo }) }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: h.theme, toggleTheme: h.toggleTheme }) }));
vi.mock('../services/auth', () => ({
  authService: { exportData: vi.fn(), deactivateAccount: vi.fn(), deleteAccount: vi.fn() },
}));

const auth = vi.mocked(authService);

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<Profile />} />
        <Route path="/login" element={<div>tela de login</div>} />
        <Route path={TERMINAL_ROUTE} element={<div>terminal</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { mfaEnabled: false };
  h.theme = 'dark';
  h.logout.mockResolvedValue(undefined);
});

describe('exportar dados', () => {
  it('sucesso avisa o download', async () => {
    auth.exportData.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Baixar meus dados/ }));
    expect(screen.getByRole('button', { name: /Gerando arquivo/ })).toBeDisabled();
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith('Download iniciado. Verifique sua pasta de downloads.', 'success'));
    expect(screen.getByRole('button', { name: /Baixar meus dados/ })).toBeEnabled();
  });

  it('erro mostra a mensagem do servidor', async () => {
    auth.exportData.mockRejectedValue(new Error('Limite de exportações atingido'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Baixar meus dados/ }));
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith('Limite de exportações atingido', 'error'));
  });
});

describe('desativar conta', () => {
  it('sem senha o botão fica travado; com senha desativa, encerra a sessão e vai ao login', async () => {
    auth.deactivateAccount.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Desativar Conta' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar Desativação' });
    expect(confirmar).toBeDisabled();
    const senha = screen.getByPlaceholderText('Sua senha atual');
    expect(senha).toHaveAttribute('type', 'password');
    fireEvent.click(senha.nextElementSibling as HTMLElement);
    expect(senha).toHaveAttribute('type', 'text');
    fireEvent.change(senha, { target: { value: 'segredo' } });
    fireEvent.click(confirmar);
    expect(await screen.findByText('tela de login')).toBeInTheDocument();
    expect(auth.deactivateAccount).toHaveBeenCalledWith('segredo');
    expect(h.logout).toHaveBeenCalled();
    expect(h.addToast).toHaveBeenCalledWith('Conta desativada. Até logo!', 'success');
  });

  it('senha errada: avisa e continua na página', async () => {
    auth.deactivateAccount.mockRejectedValue(new Error('Senha incorreta'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Desativar Conta' }));
    fireEvent.change(screen.getByPlaceholderText('Sua senha atual'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Desativação' }));
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith('Senha incorreta', 'error'));
    expect(h.logout).not.toHaveBeenCalled();
    expect(screen.queryByText('tela de login')).not.toBeInTheDocument();
  });

  it('cancelar fecha o fluxo e devolve os dois gatilhos', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Desativar Conta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Desativar Conta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir Conta Permanentemente' })).toBeInTheDocument();
  });
});

describe('excluir conta', () => {
  it('exige a palavra EXCLUIR além da senha', async () => {
    auth.deleteAccount.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Conta Permanentemente' }));
    const excluir = screen.getByRole('button', { name: 'Excluir Definitivamente' });
    fireEvent.change(screen.getByPlaceholderText('Sua senha atual'), { target: { value: 'segredo' } });
    fireEvent.change(screen.getByLabelText(/para confirmar/), { target: { value: 'excluir' } });
    expect(excluir).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/para confirmar/), { target: { value: 'EXCLUIR' } });
    expect(excluir).toBeEnabled();
    fireEvent.click(excluir);
    expect(await screen.findByText('tela de login')).toBeInTheDocument();
    expect(auth.deleteAccount).toHaveBeenCalledWith('segredo', undefined);
    expect(h.addToast).toHaveBeenCalledWith('Conta e dados excluídos permanentemente.', 'success');
  });

  it('com 2FA ligado, sem código não chama a API; com código manda junto', async () => {
    h.user = { mfaEnabled: true };
    auth.deleteAccount.mockRejectedValue(new Error('Código inválido'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Conta Permanentemente' }));
    fireEvent.change(screen.getByPlaceholderText('Sua senha atual'), { target: { value: 'segredo' } });
    fireEvent.change(screen.getByLabelText(/para confirmar/), { target: { value: 'EXCLUIR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Definitivamente' }));
    expect(h.addToast).toHaveBeenCalledWith('Informe o código de autenticação (2FA).', 'error');
    expect(auth.deleteAccount).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Código de autenticação (2FA)'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Definitivamente' }));
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith('Código inválido', 'error'));
    expect(auth.deleteAccount).toHaveBeenCalledWith('segredo', '123456');
    expect(h.logout).not.toHaveBeenCalled();
  });

  it('cancelar limpa o que foi digitado', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Conta Permanentemente' }));
    fireEvent.change(screen.getByLabelText(/para confirmar/), { target: { value: 'EXCLUIR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Conta Permanentemente' }));
    expect(screen.getByLabelText(/para confirmar/)).toHaveValue('');
  });
});

describe('tour e tema', () => {
  it('"Rever tutorial" liga o demo e abre o Terminal', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Rever tutorial/ }));
    expect(await screen.findByText('terminal')).toBeInTheDocument();
    expect(h.startDemo).toHaveBeenCalledTimes(1);
  });

  it('no tema escuro só "Claro" alterna', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Escuro/ }));
    expect(h.toggleTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Claro/ }));
    expect(h.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it('no tema claro só "Escuro" alterna', () => {
    h.theme = 'light';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Claro/ }));
    expect(h.toggleTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Escuro/ }));
    expect(h.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it('sem violações de acessibilidade na página fechada', async () => {
    const { container } = renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
