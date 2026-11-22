/**
 * Modal de detalhe da meta: o que a pessoa vê em cada estado da meta.
 *
 * Teste de caracterização escrito antes de a lógica derivada sair do componente
 * (`goalDetailView.ts`): trava o bloco de datas (adiantado/atrasado/no plano/
 * conquistada), a premissa de rendimento, o simulador "e se", o aporte do mês,
 * a sequência, o mercado no mês, o ledger e a trava do modo demo.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Goal, GoalDetail } from '../../services/goals';
import { GoalDetailModal } from './GoalDetailModal';

const h = vi.hoisted(() => ({
  detail: undefined as unknown,
  isLoading: false,
  demo: false,
  mutate: vi.fn(),
  addToast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: h.detail, isLoading: h.isLoading }),
  useMutation: () => ({ mutate: h.mutate, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: h.addToast }) }));
vi.mock('../../contexts/WalletContext', () => ({ useWallet: () => ({ activeWalletId: 'w1' }) }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: () => ({ isDemoMode: h.demo }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => h.confirm }));
vi.mock('../../services/goals', () => ({ goalsService: {} }));
vi.mock('./GoalTrajectoryChart', () => ({ GoalTrajectoryChart: () => <div>gráfico</div> }));
vi.mock('./ContributionModal', () => ({ ContributionModal: () => <div>modal de aporte</div> }));
vi.mock('./CreateGoalModal', () => ({ CreateGoalModal: () => <div>modal de edição</div> }));

const goal = (over: Partial<Goal> = {}): Goal => ({
  _id: 'g1', name: 'Casa própria', icon: 'home', color: 'blue',
  targetAmount: 100000, monthlyTarget: 1000, expectedAnnualRate: 12,
  startDate: '2026-01-01', targetDate: null, startValue: 0, achievedAt: null,
  lastCelebratedMilestone: 25, mirrorWallet: true, manualBalance: 0, status: 'ACTIVE',
  currentValue: 40000, walletEquity: 40000, remainingAmount: 60000, progressPct: 40,
  monthsRemaining: 30, projectedDate: '2029-05-15T12:00:00Z', plannedDate: '2029-08-15T12:00:00Z',
  planExpectedNow: 38000, valueVsPlan: 2000, dateDeltaMonths: 3, requiredMonthlyForDeadline: null,
  onTrack: true, achieved: false, rateDeltaPp: 0, rateStale: false,
  ...over,
});

const detail = (g: Goal, over: Partial<GoalDetail> = {}): GoalDetail => ({
  goal: g,
  contributions: [],
  currentMonth: { contributions: 400, manual: 0, wallet: 0, totalChange: 0, fromContribution: 400, fromMarket: 150 },
  trajectory: [],
  monthlyHistory: [],
  streak: 3,
  avgContribution3m: 900,
  walletEquity: 40000,
  snapshotDate: null,
  rateContext: {
    suggested: 14, breakdown: [], cdi: 14, ipca: 4.5, ntnbLong: 7,
    walletReturn: { value: null, days: 10, totalReturnPct: 0, enough: false, capped: false },
  },
  ...over,
});

const renderModal = () => render(<GoalDetailModal isOpen onClose={vi.fn()} goalId="g1" />);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T12:00:00-03:00'));
  h.detail = undefined;
  h.isLoading = false;
  h.demo = false;
  h.mutate.mockReset();
  h.addToast.mockReset();
  h.confirm.mockReset();
});

afterEach(() => vi.useRealTimers());

describe('GoalDetailModal — carregamento', () => {
  it('sem dado ainda mostra só o título genérico e o indicador de carga', () => {
    h.isLoading = true;
    renderModal();
    expect(screen.getByText('Meta')).toBeInTheDocument();
    expect(screen.queryByText('Data prevista')).not.toBeInTheDocument();
  });
});

describe('GoalDetailModal — meta em andamento', () => {
  it('adiantada: data prevista, meses de folga e valor acima do plano', () => {
    h.detail = detail(goal());
    renderModal();
    expect(screen.getByText('Casa própria')).toBeInTheDocument();
    expect(screen.getByText(/maio de 2029/)).toBeInTheDocument();
    expect(screen.getByText(/3 meses adiantado/)).toBeInTheDocument();
    expect(screen.getByText(/^\+R\$\s?2\.000,00 vs\. plano$/)).toBeInTheDocument();
    expect(screen.getByText('40,0% · faltam R$ 60.000,00')).toBeInTheDocument();
  });

  it('atrasada mostra o atraso e o valor abaixo do plano', () => {
    h.detail = detail(goal({ dateDeltaMonths: -2, valueVsPlan: -1500, onTrack: false }));
    renderModal();
    expect(screen.getByText(/2 meses atrasado/)).toBeInTheDocument();
    expect(screen.getByText(/^−R\$\s?1\.500,00 vs\. plano$/)).toBeInTheDocument();
  });

  it('no plano, sem diferença de valor relevante', () => {
    h.detail = detail(goal({ dateDeltaMonths: 0, valueVsPlan: 0.5 }));
    renderModal();
    expect(screen.getByText('No plano')).toBeInTheDocument();
    expect(screen.queryByText(/vs\. plano/)).not.toBeInTheDocument();
  });

  it('premissa: aporte + rendimento do mês e a chegada sem rendimento', () => {
    h.detail = detail(goal());
    renderModal();
    expect(screen.getByText('12,0% ao ano')).toBeInTheDocument();
    expect(screen.getByText(/Sem nenhum rendimento, a chegada seria em/)).toBeInTheDocument();
  });

  it('premissa envelhecida oferece a taxa da carteira e grava ao clicar', () => {
    h.detail = detail(goal({ rateStale: true, rateDeltaPp: 2 }));
    renderModal();
    expect(screen.getByText(/2,0 pp abaixo da premissa/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar para 14,0%' }));
    expect(h.mutate).toHaveBeenCalledWith({ expectedAnnualRate: 14 });
  });

  it('aporte do mês: quanto falta e, batido, o selo de meta do mês', () => {
    h.detail = detail(goal());
    const { unmount } = renderModal();
    expect(screen.getByText('faltam R$ 600,00')).toBeInTheDocument();
    unmount();
    h.detail = detail(goal(), { currentMonth: { contributions: 1200, manual: 0, wallet: 0, totalChange: 0, fromContribution: 0, fromMarket: 0 } });
    renderModal();
    expect(screen.getByText('✓ meta do mês batida')).toBeInTheDocument();
  });

  it('simulador: aporte maior antecipa a chegada e "Adotar" grava o aporte', () => {
    h.detail = detail(goal());
    renderModal();
    expect(screen.queryByRole('button', { name: 'Adotar' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '2000' } });
    expect(screen.getByText(/chega .* antes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adotar' }));
    expect(h.mutate).toHaveBeenCalledWith({ monthlyTarget: 2000 });
  });

  it('sequência e mercado no mês', () => {
    h.detail = detail(goal());
    renderModal();
    expect(screen.getByText('3 meses seguidos')).toBeInTheDocument();
    expect(screen.getByText('+R$ 150,00')).toBeInTheDocument();
  });

  it('sem sequência e sem movimento no mês, os dois quadros somem', () => {
    h.detail = detail(goal(), {
      streak: 0,
      currentMonth: { contributions: 0, manual: 0, wallet: 0, totalChange: 0, fromContribution: 0, fromMarket: 0 },
    });
    renderModal();
    expect(screen.queryByText(/seguidos/)).not.toBeInTheDocument();
    expect(screen.queryByText('Mercado no mês')).not.toBeInTheDocument();
  });

  it('prazo definido mostra o necessário por mês', () => {
    h.detail = detail(goal({ targetDate: '2028-01-01', requiredMonthlyForDeadline: 2500 }));
    renderModal();
    expect(screen.getByText('Necessário/mês')).toBeInTheDocument();
    expect(screen.queryByText('Ritmo 3m')).not.toBeInTheDocument();
  });

  it('ledger: remover aporte pede confirmação e então apaga', async () => {
    h.confirm.mockResolvedValue(true);
    h.detail = detail(goal(), { contributions: [{ _id: 'c1', amount: 300, date: '2026-11-10T12:00:00Z', note: 'bônus' }] });
    renderModal();
    expect(screen.getByText('Aportes manuais')).toBeInTheDocument();
    expect(screen.getByText(/· bônus/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover aporte' }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledWith('c1'));
  });

  it('abre os modais de aporte e de edição', () => {
    h.detail = detail(goal());
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Registrar aporte/ }));
    expect(screen.getByText('modal de aporte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar meta' }));
    expect(screen.getByText('modal de edição')).toBeInTheDocument();
  });
});

describe('GoalDetailModal — meta conquistada', () => {
  it('mostra a conquista e esconde premissa, simulador e aporte do mês', () => {
    h.detail = detail(goal({
      achieved: true, achievedAt: '2026-10-05T12:00:00Z', dateDeltaMonths: 1, progressPct: 100,
      lastCelebratedMilestone: 100, remainingAmount: 0,
    }));
    renderModal();
    expect(screen.getByText('Conquistada em 05/10/2026')).toBeInTheDocument();
    expect(screen.getByText('1 mês antes do previsto')).toBeInTheDocument();
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    expect(screen.queryByText('Premissa de rendimento')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByText('Aporte deste mês')).not.toBeInTheDocument();
  });
});

describe('GoalDetailModal — marcos e modo demo', () => {
  it('cruzar um marco comemora uma vez e grava o marco', () => {
    h.detail = detail(goal({ progressPct: 55, lastCelebratedMilestone: 25 }));
    renderModal();
    expect(h.addToast).toHaveBeenCalledWith('🎉 Você cruzou 50% da meta!', 'success');
    expect(h.mutate).toHaveBeenCalledWith({ lastCelebratedMilestone: 50 });
  });

  it('no demo comemora mas não grava, e excluir a meta é bloqueado', () => {
    h.demo = true;
    h.detail = detail(goal({ progressPct: 55, lastCelebratedMilestone: 25 }));
    renderModal();
    expect(h.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir meta' }));
    expect(h.confirm).not.toHaveBeenCalled();
  });
});
