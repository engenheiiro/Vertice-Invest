import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { AdminRoute } from './AdminRoute';
import { useAuth } from '../../contexts/AuthContext';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));

const mockAuth = (value: Record<string, unknown>) =>
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(value);

const renderProtected = (initialPath = '/wallet') => render(
  <MemoryRouter initialEntries={[initialPath]}>
    <Routes>
      <Route path="/login" element={<p>Login page</p>} />
      <Route path="/wallet" element={<ProtectedRoute><p>Private wallet</p></ProtectedRoute>} />
    </Routes>
  </MemoryRouter>
);

const renderAdmin = (initialPath = '/admin') => render(
  <MemoryRouter initialEntries={[initialPath]}>
    <Routes>
      <Route path="/login" element={<p>Login page</p>} />
      <Route path="/dashboard" element={<p>Dashboard page</p>} />
      <Route path="/admin" element={<AdminRoute><p>Admin panel</p></AdminRoute>} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => vi.clearAllMocks());

describe('ProtectedRoute', () => {
  it('exibe carregamento enquanto a sessão está sendo restaurada', () => {
    mockAuth({ isLoading: true, isAuthenticated: false, user: null });
    const { container } = renderProtected();

    expect(container.querySelector('svg.animate-spin')).toBeTruthy();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('redireciona visitante para login', () => {
    mockAuth({ isLoading: false, isAuthenticated: false, user: null });
    renderProtected();

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Private wallet')).not.toBeInTheDocument();
  });

  it('renderiza o conteúdo para usuário autenticado', () => {
    mockAuth({ isLoading: false, isAuthenticated: true, user: { role: 'USER' } });
    renderProtected();

    expect(screen.getByText('Private wallet')).toBeInTheDocument();
  });
});

describe('AdminRoute', () => {
  it('redireciona visitante para login', () => {
    mockAuth({ isLoading: false, isAuthenticated: false, user: null });
    renderAdmin();

    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('redireciona usuário sem papel ADMIN para o dashboard', () => {
    mockAuth({ isLoading: false, isAuthenticated: true, user: { role: 'USER' } });
    renderAdmin();

    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
    expect(screen.queryByText('Admin panel')).not.toBeInTheDocument();
  });

  it('renderiza o painel para ADMIN autenticado', () => {
    mockAuth({ isLoading: false, isAuthenticated: true, user: { role: 'ADMIN' } });
    renderAdmin();

    expect(screen.getByText('Admin panel')).toBeInTheDocument();
  });
});
