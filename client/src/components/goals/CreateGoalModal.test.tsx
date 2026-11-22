/**
 * Atalhos de taxa do formulário de metas.
 *
 * A "rentabilidade esperada" é metade da projeção: numa meta com patrimônio
 * grande e aporte pequeno, a maior parte do avanço previsto vem dela. Até
 * 08/09/2026 o formulário nascia com um "10" redondo e oferecia um atalho
 * "Minha carteira" que colava `kpis.weightedRentability` — rentabilidade
 * ACUMULADA da cota, de 2 meses ou de 5 anos — num campo que significa "ao ano".
 *
 * O que estes testes travam:
 *  - meta nova nasce na taxa derivada da carteira, não num número redondo;
 *  - histórico curto NÃO vira atalho (o servidor manda `enough: false`), e a
 *    tela explica por quê em vez de sumir em silêncio;
 *  - quando vira, o número oferecido é o ANUALIZADO que veio do servidor;
 *  - edição jamais sobrescreve a premissa que o usuário já tinha salvo.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Goal, RateContext } from '../../services/goals';
import { CreateGoalModal } from './CreateGoalModal';
import { useWallet } from '../../contexts/WalletContext';
import { useToast } from '../../contexts/ToastContext';

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: vi.fn() }));
vi.mock('../../services/goals', () => ({
  goalsService: { getRateSuggestion: vi.fn(), getGoals: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn() },
}));

const demo = { on: false };
vi.mock('../../contexts/DemoContext', () => ({ useDemo: () => ({ isDemoMode: demo.on }) }));

const rateCtx: { current: RateContext | undefined } = { current: undefined };
// `enabled` de cada query, pela primeira parte da chave — o mock ignora o flag,
// então é aqui que se confere SE a busca sairia.
const queryEnabled: Record<string, unknown> = {};
const mutate = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => {
    queryEnabled[String(queryKey[0])] = enabled;
    return queryKey[0] === 'goalRateSuggestion'
      ? { data: rateCtx.current, isLoading: false }
      : { data: { goals: [] }, isLoading: false };
  },
  useMutation: () => ({ mutate, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const context = (over: Partial<RateContext> = {}): RateContext => ({
  suggested: 14,
  breakdown: [{ type: 'CASH', value: 1000, weight: 1, rate: 13.9 }],
  cdi: 13.9,
  ipca: 4.44,
  ntnbLong: 7.81,
  walletReturn: { value: null, days: 62, totalReturnPct: 12, enough: false, capped: false },
  ...over,
});

const rateInput = () => screen.getByLabelText(/Rentabilidade esperada/i) as HTMLInputElement;

const addToast = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  demo.on = false;
  rateCtx.current = context();
  (useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    kpis: { totalEquity: 46_667 },
    activeWalletId: 'w1',
    isWalletScopeReady: true,
  });
  (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ addToast });
});

describe('CreateGoalModal — escopo de carteira e modo demo', () => {
  it('não busca metas nem sugestão de taxa antes do escopo de carteira ficar pronto', () => {
    (useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      kpis: { totalEquity: 0 }, activeWalletId: undefined, isWalletScopeReady: false,
    });
    render(<CreateGoalModal isOpen onClose={() => {}} />);
    expect(queryEnabled.goals).toBe(false);
    expect(queryEnabled.goalRateSuggestion).toBe(false);
  });

  it('modal fechado não busca a lista de metas', () => {
    render(<CreateGoalModal isOpen={false} onClose={() => {}} />);
    expect(queryEnabled.goals).toBe(false);
  });

  it('com o escopo pronto e o modal aberto, busca', () => {
    render(<CreateGoalModal isOpen onClose={() => {}} />);
    expect(queryEnabled.goals).toBe(true);
    expect(queryEnabled.goalRateSuggestion).toBe(true);
  });

  it('no demo, "Criar meta" não grava nada e avisa', () => {
    demo.on = true;
    render(<CreateGoalModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByText('Criar meta'));
    expect(mutate).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/demonstração/i), 'info');
  });
});

describe('CreateGoalModal — taxa esperada', () => {
  it('meta nova nasce na taxa derivada da carteira, não num 10 redondo', () => {
    render(<CreateGoalModal isOpen onClose={() => {}} />);
    expect(rateInput().value).toBe('14');
  });

  it('histórico curto não vira atalho — e a tela diz por quê', () => {
    render(<CreateGoalModal isOpen onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /Meu histórico/i })).toBeNull();
    expect(screen.getByText(/62 dias/)).toBeTruthy();
  });

  it('histórico suficiente oferece a taxa ANUALIZADA que veio do servidor', () => {
    // +96,44% em 5 anos = 14,5% a.a. — jamais "96,4%".
    rateCtx.current = context({
      walletReturn: { value: 14.5, days: 1825, totalReturnPct: 96.4, enough: true, capped: false },
    });
    render(<CreateGoalModal isOpen onClose={() => {}} />);

    const chip = screen.getByRole('button', { name: /Meu histórico/i });
    expect(chip.textContent).toContain('14,5%');
    expect(chip.textContent).not.toContain('96');

    fireEvent.click(chip);
    expect(rateInput().value).toBe('14.5');
  });

  it('atalho do CDI usa o CDI vivo do servidor', () => {
    render(<CreateGoalModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /CDI/i }));
    expect(rateInput().value).toBe('13.9');
  });

  it('o que o usuário digita não é sobrescrito pela sugestão', () => {
    const { rerender } = render(<CreateGoalModal isOpen onClose={() => {}} />);
    fireEvent.change(rateInput(), { target: { value: '7' } });

    // Uma nova sugestão chega (refetch): a premissa digitada continua de pé.
    rateCtx.current = context({ suggested: 16 });
    rerender(<CreateGoalModal isOpen onClose={() => {}} />);
    expect(rateInput().value).toBe('7');
  });

  it('editar meta preserva a taxa salva, mesmo divergindo da sugestão', () => {
    const goal = { _id: 'g1', name: 'Reserva', expectedAnnualRate: 8, targetAmount: 1000, monthlyTarget: 100, mirrorWallet: true, startValue: 0 } as Goal;
    render(<CreateGoalModal isOpen onClose={() => {}} goal={goal} />);
    expect(rateInput().value).toBe('8');
  });
});
