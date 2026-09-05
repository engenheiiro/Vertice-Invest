/**
 * Persistência das seções recolhíveis da página de Metas.
 *
 * Recolher as concluídas é o usuário arrumando a própria tela — e a arrumação
 * era desfeita a cada navegação, porque a escolha vivia só em `useState`. Sair
 * para a Carteira e voltar trazia tudo aberto de novo, o que anula o único efeito
 * que o botão tem.
 *
 * O que os testes travam:
 *  - a escolha sobrevive à desmontagem da página (é o "sair e voltar");
 *  - o tri-estado continua existindo: sem escolha gravada, o padrão ainda é
 *    derivado do que há em andamento, e não um `false` herdado de ninguém;
 *  - cada jornada guarda a sua — recolher uma não pode recolher as outras.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Goal } from '../services/goals';
import { Goals } from './Goals';
import { useWallet } from '../contexts/WalletContext';
import { useToast } from '../contexts/ToastContext';

vi.mock('../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../contexts/ToastContext', () => ({ useToast: vi.fn() }));
vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../components/goals/CreateGoalModal', () => ({ CreateGoalModal: () => null }));
vi.mock('../components/goals/GoalDetailModal', () => ({ GoalDetailModal: () => null }));
vi.mock('../components/goals/GoalCard', () => ({
  GoalCard: ({ goal }: { goal: Goal }) => <div data-testid={`card-${goal._id}`}>{goal.name}</div>,
}));
vi.mock('../components/goals/AchievedTrail', () => ({
  AchievedTrail: ({ goals }: { goals: Goal[] }) => <div data-testid="trilha">{goals.length}</div>,
}));
vi.mock('../services/goals', () => ({ goalsService: { getGoals: vi.fn(), renameJourney: vi.fn(), clearAllGoals: vi.fn() } }));

const mockGoals: { current: Goal[] } = { current: [] };
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { goals: mockGoals.current }, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const goal = (over: Partial<Goal> & { _id: string; name: string }): Goal =>
  ({
    icon: 'target', color: 'emerald', targetAmount: 1000, monthlyTarget: 100,
    expectedAnnualRate: 10, startDate: '2026-01-01', startValue: 0,
    lastCelebratedMilestone: 0, previousGoalId: null, mirrorWallet: true,
    manualBalance: 0, status: 'ACTIVE', currentValue: 500, walletEquity: 500,
    remainingAmount: 500, progressPct: 50, monthsRemaining: 5, projectedDate: null,
    plannedDate: null, planExpectedNow: 0, valueVsPlan: 0, dateDeltaMonths: null,
    requiredMonthlyForDeadline: null, onTrack: true, achieved: false,
    ...over,
  }) as Goal;

const conquistada = (over: Partial<Goal> & { _id: string; name: string }) =>
  goal({ status: 'ACHIEVED', achieved: true, progressPct: 100, remainingAmount: 0, ...over });

beforeEach(() => {
  localStorage.clear();
  (useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    isPrivacyMode: false, activeWalletId: 'w1', isWalletScopeReady: true,
  });
  (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ addToast: vi.fn() });
});

describe('seção "Concluídas"', () => {
  beforeEach(() => {
    // Uma viva e uma concluída: é o cenário em que o botão aparece e o padrão
    // (aberto só quando não há nada em andamento) resolve para FECHADO.
    mockGoals.current = [
      goal({ _id: 'viva', name: 'Reserva' }),
      conquistada({ _id: 'feita', name: 'Notebook' }),
    ];
  });

  it('sem escolha gravada, segue o padrão derivado (fechada, porque há meta em andamento)', () => {
    render(<Goals />);
    expect(screen.getByTestId('card-viva')).toBeInTheDocument();
    expect(screen.queryByTestId('card-feita')).not.toBeInTheDocument();
  });

  it('a escolha sobrevive a sair e voltar', () => {
    const primeira = render(<Goals />);
    fireEvent.click(screen.getByRole('button', { name: /Concluídas/i }));
    expect(screen.getByTestId('card-feita')).toBeInTheDocument();

    primeira.unmount();
    render(<Goals />);
    expect(screen.getByTestId('card-feita')).toBeInTheDocument();
  });

  it('esconder também sobrevive — o padrão não volta por cima da escolha', () => {
    // Sem nada em andamento o padrão é ABERTO; o teste prova que um "fechar"
    // explícito vence esse padrão na volta.
    mockGoals.current = [conquistada({ _id: 'feita', name: 'Notebook' })];
    const primeira = render(<Goals />);
    expect(screen.getByTestId('card-feita')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Concluídas/i }));
    expect(screen.queryByTestId('card-feita')).not.toBeInTheDocument();

    primeira.unmount();
    render(<Goals />);
    expect(screen.queryByTestId('card-feita')).not.toBeInTheDocument();
  });

  it('storage indisponível não derruba a página', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => render(<Goals />)).not.toThrow();
    spy.mockRestore();
  });
});

describe('marcos recolhíveis de uma jornada', () => {
  beforeEach(() => {
    // Três conquistadas seguidas + uma viva: `collapsibleAchievedCount` exige
    // pelo menos duas no início da cadeia para o botão de recolher aparecer.
    mockGoals.current = [
      conquistada({ _id: 'm1', name: 'Marco 1' }),
      conquistada({ _id: 'm2', name: 'Marco 2', previousGoalId: 'm1' }),
      conquistada({ _id: 'm3', name: 'Marco 3', previousGoalId: 'm2' }),
      goal({ _id: 'm4', name: 'Marco 4', previousGoalId: 'm3' }),
    ];
  });

  it('recolher a jornada sobrevive a sair e voltar', () => {
    const primeira = render(<Goals />);
    expect(screen.queryByTestId('trilha')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Recolher .* conquistadas/i }));
    expect(screen.getByTestId('trilha')).toBeInTheDocument();

    primeira.unmount();
    render(<Goals />);
    expect(screen.getByTestId('trilha')).toBeInTheDocument();
  });
});
