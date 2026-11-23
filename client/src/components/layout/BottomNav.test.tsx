import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'jest-axe';
import { BottomNav } from './BottomNav';

const auth = vi.hoisted(() => ({ user: { role: 'USER' } as { role: string } | null, logout: vi.fn(async () => {}) }));
const demo = vi.hoisted(() => ({ isDemoMode: false }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: () => demo }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><BottomNav /></MemoryRouter>);
const nav = () => screen.getByRole('navigation', { name: 'Navegação principal' });

describe('BottomNav — barra inferior do celular', () => {
  beforeEach(() => {
    auth.user = { role: 'USER' };
    auth.logout.mockClear();
    navigate.mockClear();
    demo.isDemoMode = false;
  });

  it('mostra os 4 destinos principais com a Carteira primeiro e marca o ativo', () => {
    renderAt('/wallet');
    const links = within(nav()).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Carteira', 'Terminal', 'Research', 'Radar']);
    expect(within(nav()).getByRole('link', { name: 'Carteira' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('link', { name: 'Radar' })).not.toHaveAttribute('aria-current');
  });

  it('sub-rota conta como ativa; prefixo parecido não', () => {
    renderAt('/radar/PETR4');
    expect(within(nav()).getByRole('link', { name: 'Radar' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('button', { name: 'Mais' }).className).not.toContain('text-blue-400');
  });

  it('"Mais" abre a folha com os destinos secundários, Comparar desabilitado e sem Admin para usuário comum', async () => {
    renderAt('/goals');
    const mais = within(nav()).getByRole('button', { name: 'Mais' });
    expect(mais.className).toContain('text-blue-400');
    expect(mais).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(mais);
    const folha = screen.getByRole('dialog', { name: 'Mais opções' });
    expect(within(folha).getAllByRole('link').map((l) => l.textContent)).toEqual(
      ['Buy-and-Hold', 'Metas', 'Indicadores', 'Calculadora', 'Cursos', 'Planos', 'Meu Perfil'],
    );
    expect(within(folha).getByTitle('Em breve')).toHaveTextContent('Comparar');
    expect(within(folha).getByRole('link', { name: 'Metas' }).className).toContain('bg-slate-800');
  });

  it('admin vê o atalho do Admin', async () => {
    auth.user = { role: 'ADMIN' };
    renderAt('/wallet');
    await userEvent.click(within(nav()).getByRole('button', { name: 'Mais' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('fecha pelo X, pelo fundo e ao escolher um destino', async () => {
    renderAt('/wallet');
    const abrir = () => userEvent.click(within(nav()).getByRole('button', { name: 'Mais' }));
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await abrir();
    const fundo = screen.getByRole('dialog').querySelector('[role="presentation"]');
    expect(fundo).not.toBeNull();
    if (fundo) await userEvent.click(fundo);
    expect(screen.queryByRole('dialog')).toBeNull();
    await abrir();
    await userEvent.click(screen.getByRole('link', { name: 'Cursos' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Sair fecha a folha, desloga e leva ao login', async () => {
    renderAt('/wallet');
    await userEvent.click(within(nav()).getByRole('button', { name: 'Mais' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no tour do demo a barra sobe acima do overlay', () => {
    demo.isDemoMode = true;
    renderAt('/wallet');
    expect(nav().className).toContain('z-[100]');
  });

  it('não viola WCAG estrutural, fechada e com a folha aberta', async () => {
    const { container } = renderAt('/wallet');
    const regras = { rules: { 'color-contrast': { enabled: false } } };
    expect(await axe(container, regras)).toHaveNoViolations();
    await userEvent.click(within(nav()).getByRole('button', { name: 'Mais' }));
    expect(await axe(container, regras)).toHaveNoViolations();
  });
});
