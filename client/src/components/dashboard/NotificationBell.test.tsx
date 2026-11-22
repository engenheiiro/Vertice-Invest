/**
 * Testes do NotificationBell (sino de notificações do Header).
 *
 * Cobre: contagem de não lidas no rótulo, painel vazio, tempo relativo,
 * leitura individual × difusão (`readBy`), marcar uma/todas como lidas com
 * invalidação, navegação só para link interno (nunca `//host`), fechar por
 * botão e por clique fora, e o posicionamento móvel.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { NotificationBell } from './NotificationBell';
import { notificationsService } from '../../services/notifications';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../services/notifications', () => ({
  notificationsService: { getNotifications: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() },
}));

const svc = vi.mocked(notificationsService);
type List = Awaited<ReturnType<typeof notificationsService.getNotifications>>;

const NOW = new Date('2026-11-20T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const NOTIFS = [
  { _id: 'n1', user: 'u1', isRead: false, readBy: [], title: 'Provento pago', message: 'HGLG11 pagou R$ 12', link: '/wallet', createdAt: ago(30_000) },
  { _id: 'n2', user: null, isRead: false, readBy: ['u1'], title: 'Manutenção', message: 'Sábado', link: '//evil.example', createdAt: ago(5 * 60_000) },
  { _id: 'n3', user: null, isRead: false, readBy: [], title: 'Novo ranking', message: 'Saiu', link: 'https://x.example', createdAt: ago(3 * 3_600_000) },
  { _id: 'n4', user: 'u1', isRead: true, readBy: [], title: 'Antiga', message: 'Velha', createdAt: ago(2 * 86_400_000) },
];

let client: QueryClient;
const renderBell = () => render(<QueryClientProvider client={client}><NotificationBell /></QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  svc.getNotifications.mockResolvedValue({ notifications: NOTIFS, unreadCount: 2 } as unknown as List);
  svc.markRead.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof notificationsService.markRead>>);
  svc.markAllRead.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof notificationsService.markAllRead>>);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NotificationBell', () => {
  it('rótulo do sino conta as não lidas', async () => {
    const { container } = renderBell();
    expect(await screen.findByRole('button', { name: 'Notificações (2 não lidas)' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('sem notificações mostra o painel vazio', async () => {
    svc.getNotifications.mockResolvedValue({ notifications: [], unreadCount: 0 } as unknown as List);
    renderBell();
    await waitFor(() => expect(svc.getNotifications).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(screen.getByText('Nenhuma notificação')).toBeInTheDocument();
    expect(screen.queryByTitle('Marcar todas como lidas')).not.toBeInTheDocument();
  });

  it('lista com tempo relativo e estado lido por usuário/difusão', async () => {
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /2 não lidas/ }));
    expect(screen.getByText('agora')).toBeInTheDocument();
    expect(screen.getByText('5m atrás')).toBeInTheDocument();
    expect(screen.getByText('3h atrás')).toBeInTheDocument();
    expect(screen.getByText('2d atrás')).toBeInTheDocument();

    const card = (title: string) => screen.getByText(title).closest('[role="button"]') as HTMLElement;
    expect(card('Manutenção').className).toContain('opacity-50'); // difusão lida por u1
    expect(card('Novo ranking').className).not.toContain('opacity-50');
    expect(card('Antiga').className).toContain('opacity-50');
  });

  it('clicar numa não lida marca como lida e navega para link interno', async () => {
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /2 não lidas/ }));
    fireEvent.click(screen.getByText('Provento pago'));
    await waitFor(() => expect(svc.markRead).toHaveBeenCalledWith('n1'));
    expect(navigate).toHaveBeenCalledWith('/wallet');
    await waitFor(() => expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notifications'] }));
    expect(screen.queryByText('Provento pago')).not.toBeInTheDocument();
  });

  it('link protocol-relative ou externo não navega; lida não remarca', async () => {
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /2 não lidas/ }));
    fireEvent.keyDown(screen.getByText('Manutenção').closest('[role="button"]') as HTMLElement, { key: 'Enter' });
    fireEvent.click(screen.getByText('Novo ranking'));
    await waitFor(() => expect(svc.markRead).toHaveBeenCalledWith('n3'));
    expect(svc.markRead).not.toHaveBeenCalledWith('n2');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText('Novo ranking')).toBeInTheDocument();
  });

  it('"Todas" marca tudo como lido', async () => {
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: /2 não lidas/ }));
    fireEvent.click(screen.getByTitle('Marcar todas como lidas'));
    await waitFor(() => expect(svc.markAllRead).toHaveBeenCalled());
    await waitFor(() => expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notifications'] }));
  });

  it('fecha pelo X e por clique fora; no celular o painel ocupa a largura', async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    renderBell();
    const bell = await screen.findByRole('button', { name: /2 não lidas/ });
    fireEvent.click(bell);
    const panel = screen.getByText('Provento pago').closest('.z-\\[100\\]') as HTMLElement;
    expect(panel.style.left).toBe('12px');
    expect(panel.style.right).toBe('12px');

    fireEvent.mouseDown(panel);
    expect(screen.getByText('Provento pago')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Provento pago')).not.toBeInTheDocument();

    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    fireEvent.click(bell);
    expect((screen.getByText('Provento pago').closest('.z-\\[100\\]') as HTMLElement).style.width).toBe('320px');
    const close = screen.getByTitle('Marcar todas como lidas').nextElementSibling as HTMLElement;
    fireEvent.click(close);
    expect(screen.queryByText('Provento pago')).not.toBeInTheDocument();
  });
});
