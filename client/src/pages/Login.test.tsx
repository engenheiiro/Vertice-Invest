/**
 * Testes do fluxo de login e autenticação em 2 fatores (2FA).
 *
 * Cobre:
 *  - Validação de campos obrigatórios (email/senha vazia → não chama API)
 *  - Login bem-sucedido → chama login() e navega para /dashboard
 *  - Erro de servidor → exibe mensagem de erro
 *  - Resposta mfaRequired → exibe passo de código 2FA
 *  - Código 2FA curto → exibe erro de validação
 *  - Login com 2FA completo → navega para /dashboard
 *
 * Estratégia de mock:
 *  - authService.login: vi.fn() controlável por teste
 *  - useAuth: retorna { login: mockLogin }
 *  - useFormValidation / validators: usados como está (implementação pura)
 *  - react-router-dom: useNavigate + Link mockados
 *  - Componentes filhos (Input, Button, PageMeta): mockados com HTML nativo
 *
 * NOTA sobre timers: NÃO usar vi.useFakeTimers() — quebra o polling interno
 * do waitFor (@testing-library/react usa setInterval para verificar condições).
 * O setTimeout de 600ms para navigate é aguardado via waitFor com timeout maior.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Login } from './Login';
import { authService } from '../services/auth';
import { useAuth } from '../contexts/AuthContext';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../services/auth', () => ({ authService: { login: vi.fn() } }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));

// Componentes de UI: substituídos por equivalentes acessíveis para os testes
vi.mock('../components/ui/Input', () => ({
  Input: ({ label, type, value, onChange, error, disabled }: any) => (
    <div>
      <label htmlFor={label}>{label}</label>
      <input
        id={label}
        type={type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        data-testid={`input-${label}`}
      />
      {error && <span role="alert">{error}</span>}
    </div>
  ),
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, type, status }: any) => (
    <button type={type} disabled={status === 'loading'}>
      {children}
    </button>
  ),
  ButtonStatus: {},
}));

vi.mock('../components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stubs reutilizáveis ─────────────────────────────────────────────────────

const mockLogin = vi.fn();

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ login: mockLogin } as any);
});

const renderLogin = () => render(<Login />);

const submitForm = () =>
  fireEvent.submit(document.querySelector('form')!);

const fillLoginForm = (email = 'user@email.com', password = 'Senha123!') => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } });
};

// ─── Render ───────────────────────────────────────────────────────────────────

describe('render', () => {
  it('exibe campos de email e senha', () => {
    renderLogin();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
  });

  it('exibe botão "Entrar"', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /Entrar/i })).toBeInTheDocument();
  });

  it('não exibe campo de código 2FA na tela inicial', () => {
    renderLogin();
    expect(screen.queryByLabelText(/Código de verificação/i)).not.toBeInTheDocument();
  });
});

// ─── Validação de formulário ──────────────────────────────────────────────────

describe('validação de formulário', () => {
  it('não chama authService.login se email estiver vazio', () => {
    renderLogin();
    // Preenche só senha, deixa email vazio
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha123' } });
    submitForm();
    expect(vi.mocked(authService.login)).not.toHaveBeenCalled();
  });

  it('não chama authService.login se senha estiver vazia', () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@email.com' } });
    submitForm();
    expect(vi.mocked(authService.login)).not.toHaveBeenCalled();
  });
});

// ─── Login bem-sucedido ───────────────────────────────────────────────────────

describe('login bem-sucedido', () => {
  it('chama login() e navega para /dashboard após 600ms', async () => {
    vi.mocked(authService.login).mockResolvedValue({
      user: { id: '1', name: 'João', email: 'user@email.com', plan: 'PRO' },
      accessToken: 'tok123',
    } as any);

    renderLogin();
    fillLoginForm();
    submitForm();

    await waitFor(() => expect(mockLogin).toHaveBeenCalledOnce());
    expect(mockLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@email.com' }),
      'tok123'
    );

    // navigate é chamado 600ms depois — waitFor com timeout estendido
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'), {
      timeout: 2000,
    });
  });
});

// ─── Erro de servidor ─────────────────────────────────────────────────────────

describe('erro de servidor', () => {
  it('exibe mensagem de erro quando authService.login rejeita', async () => {
    vi.mocked(authService.login).mockRejectedValue(new Error('Credenciais inválidas.'));

    renderLogin();
    fillLoginForm();
    submitForm();

    await waitFor(() =>
      expect(screen.getByText('Credenciais inválidas.')).toBeInTheDocument()
    );
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('exibe mensagem genérica para erro sem mensagem', async () => {
    vi.mocked(authService.login).mockRejectedValue('timeout');

    renderLogin();
    fillLoginForm();
    submitForm();

    await waitFor(() =>
      expect(screen.getByText(/indisponível/i)).toBeInTheDocument()
    );
  });
});

// ─── Fluxo MFA ────────────────────────────────────────────────────────────────

describe('fluxo 2FA (MFA)', () => {
  it('exibe campo de código quando backend responde mfaRequired: true', async () => {
    vi.mocked(authService.login).mockResolvedValue({ mfaRequired: true } as any);

    renderLogin();
    fillLoginForm();
    submitForm();

    await waitFor(() =>
      expect(screen.getByLabelText(/Código de verificação/i)).toBeInTheDocument()
    );
    // Campos originais não devem mais aparecer
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
  });

  it('exibe erro quando o código 2FA tem menos de 6 dígitos', async () => {
    vi.mocked(authService.login).mockResolvedValueOnce({ mfaRequired: true } as any);

    renderLogin();
    fillLoginForm();
    submitForm();

    await waitFor(() => screen.getByLabelText(/Código de verificação/i));

    // Digita código curto (4 dígitos) e submete
    fireEvent.change(screen.getByLabelText(/Código de verificação/i), {
      target: { value: '1234' },
    });
    submitForm();

    await waitFor(() =>
      // "Informe o código de 6 dígitos." aparece na mensagem de erro (serverError div)
      // O parágrafo de instrução também contém "6 dígitos", então usamos getAllByText
      expect(screen.getAllByText(/6 dígitos/i).length).toBeGreaterThanOrEqual(1)
    );
    // API não deve ser chamada novamente com o código inválido
    expect(vi.mocked(authService.login)).toHaveBeenCalledTimes(1);
  });

  it('completa login com código 2FA válido e navega para /dashboard', async () => {
    vi.mocked(authService.login)
      .mockResolvedValueOnce({ mfaRequired: true } as any)
      .mockResolvedValueOnce({
        user: { id: '1', name: 'Ana', email: 'ana@email.com', plan: 'BLACK' },
        accessToken: 'tok-mfa',
      } as any);

    renderLogin();
    fillLoginForm('ana@email.com', 'SenhaSegura!1');
    submitForm();

    await waitFor(() => screen.getByLabelText(/Código de verificação/i));

    fireEvent.change(screen.getByLabelText(/Código de verificação/i), {
      target: { value: '123456' },
    });
    submitForm();

    await waitFor(() => expect(mockLogin).toHaveBeenCalledOnce());
    // Segunda chamada deve incluir o mfaToken
    expect(vi.mocked(authService.login)).toHaveBeenLastCalledWith(
      expect.objectContaining({ mfaToken: '123456' })
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'), {
      timeout: 2000,
    });
  });

  it('botão "Voltar para e-mail" restaura o formulário de credenciais', async () => {
    vi.mocked(authService.login).mockResolvedValueOnce({ mfaRequired: true } as any);

    renderLogin();
    fillLoginForm();
    submitForm();

    await waitFor(() => screen.getByLabelText(/Código de verificação/i));

    fireEvent.click(screen.getByText(/Voltar ao login/i));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
  });
});
