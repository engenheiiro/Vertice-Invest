/**
 * Caracterização do formulário de metas: trava o que a tela MOSTRA e o que ela
 * MANDA ao servidor (forma exata do corpo, mensagens de validação, criar ×
 * editar, demo, fechar, foco), para que reorganizar o código não mude nada.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { Goal, RateContext } from '../../services/goals';
import { goalsService } from '../../services/goals';
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

interface MutationOptions {
  mutationFn: (payload: unknown) => unknown;
  onSuccess: () => void;
  onError: (err: unknown) => void;
}
const state: { rate: RateContext | undefined; goals: Goal[]; mutation: MutationOptions | null } = {
  rate: undefined, goals: [], mutation: null,
};
const mutate = vi.fn();
const invalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => (queryKey[0] === 'goalRateSuggestion'
    ? { data: state.rate, isLoading: false }
    : { data: { goals: state.goals }, isLoading: false }),
  useMutation: (opts: MutationOptions) => { state.mutation = opts; return { mutate, isPending: false }; },
  useQueryClient: () => ({ invalidateQueries }),
}));

const AGORA = new Date('2026-11-22T12:00:00-03:00');
const AXE_CONFIG = { rules: { 'color-contrast': { enabled: false } } };
// Os botões de ícone não têm nome acessível (só o SVG) — lacuna anterior a esta
// caracterização, mantida de propósito para não mudar o HTML; o resto do axe vale.
const AXE_SEM_NOME_DE_ICONE = { rules: { ...AXE_CONFIG.rules, 'button-name': { enabled: false } } };

const context = (over: Partial<RateContext> = {}): RateContext => ({
  suggested: 14,
  breakdown: [{ type: 'CASH', value: 1000, weight: 1, rate: 13.9 }],
  cdi: 13.9,
  ipca: 4.44,
  ntnbLong: 7.81,
  walletReturn: { value: null, days: 62, totalReturnPct: 12, enough: false, capped: false },
  ...over,
});

const makeGoal = (over: Partial<Goal> = {}): Goal => ({
  _id: 'g1', name: 'Reserva', icon: 'home', color: 'blue', targetAmount: 1234567.5, monthlyTarget: 850,
  expectedAnnualRate: 8, startDate: '2026-01-01', targetDate: '2027-06-30T00:00:00.000Z', startValue: 3200.4,
  previousGoalId: null, mirrorWallet: false, manualBalance: 0, status: 'ACTIVE',
  ...over,
} as Goal);

const addToast = vi.fn();
const onClose = vi.fn();

const byLabel = (re: RegExp) => screen.getByLabelText(re) as HTMLInputElement;
const type = (re: RegExp, value: string) => fireEvent.change(byLabel(re), { target: { value } });
const submit = (label = 'Criar meta') => fireEvent.click(screen.getByRole('button', { name: label }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  vi.clearAllMocks();
  demo.on = false;
  state.rate = context();
  state.goals = [];
  state.mutation = null;
  (useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    kpis: { totalEquity: 10_000 }, activeWalletId: 'w1', isWalletScopeReady: true,
  });
  (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ addToast });
});
afterEach(() => { vi.useRealTimers(); });

describe('CreateGoalModal (caracterização) — criar × editar', () => {
  it('criação: título, campos vazios, espelho ligado, saldo fora da carteira e botão "Criar meta"', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Nova meta' })).toBeTruthy();
    expect(byLabel(/Nome da meta/).value).toBe('');
    expect(byLabel(/Valor-alvo/).value).toBe('');
    expect(byLabel(/Aporte mensal/).value).toBe('');
    expect(byLabel(/Prazo/).value).toBe('');
    expect(byLabel(/Já tenho guardado/)).toBeTruthy();
    expect(screen.queryByLabelText(/Patrimônio no início/)).toBeNull();
    expect(screen.getByRole('button', { name: /Espelhar minha carteira/ }).innerHTML).toContain('bg-emerald-500');
    expect(screen.getByRole('button', { name: 'Criar meta' })).toBeTruthy();
  });

  it('criação sem sugestão do servidor: taxa 10, sem atalhos e texto genérico', () => {
    state.rate = undefined;
    render(<CreateGoalModal isOpen onClose={onClose} />);
    expect(byLabel(/Rentabilidade esperada/).value).toBe('10');
    expect(screen.queryByRole('button', { name: /Minha carteira|CDI|Meu histórico/ })).toBeNull();
    expect(screen.getByText(/Quanto você espera que o dinheiro renda por ano/)).toBeTruthy();
  });

  it('edição: título, campos preenchidos com vírgula e sem milhar, patrimônio inicial e "Salvar alterações"', () => {
    render(<CreateGoalModal isOpen onClose={onClose} goal={makeGoal()} />);
    expect(screen.getByRole('heading', { name: 'Editar meta' })).toBeTruthy();
    expect(byLabel(/Nome da meta/).value).toBe('Reserva');
    expect(byLabel(/Valor-alvo/).value).toBe('1234567,50');
    expect(byLabel(/Aporte mensal/).value).toBe('850,00');
    expect(byLabel(/Rentabilidade esperada/).value).toBe('8');
    expect(byLabel(/Prazo/).value).toBe('2027-06-30');
    expect(byLabel(/Patrimônio no início/).value).toBe('3200,40');
    expect(screen.queryByLabelText(/Já tenho guardado/)).toBeNull();
    expect(screen.getByText(/Ponto de partida da linha/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeTruthy();
  });

  it('edição com campos opcionais ausentes cai nos padrões (ícone alvo, cor esmeralda, sem prazo, início 0)', () => {
    const goal = makeGoal({ name: '', icon: '', color: '', targetDate: null, startValue: 0 });
    render(<CreateGoalModal isOpen onClose={onClose} goal={goal} />);
    expect(byLabel(/Prazo/).value).toBe('');
    expect(byLabel(/Patrimônio no início/).value).toBe('0,00');
    submit('Salvar alterações');
    expect(addToast).toHaveBeenCalledWith('Dê um nome para a meta.', 'error');
  });
});

describe('CreateGoalModal (caracterização) — validação', () => {
  it('nome vazio: avisa e não grava', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Valor-alvo/, '100000');
    submit();
    expect(addToast).toHaveBeenCalledWith('Dê um nome para a meta.', 'error');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('nome só de espaços conta como vazio', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Nome da meta/, '   ');
    type(/Valor-alvo/, '100000');
    submit();
    expect(addToast).toHaveBeenCalledWith('Dê um nome para a meta.', 'error');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('nome e valor faltando: a mensagem do nome vem primeiro, uma só', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    submit();
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('Dê um nome para a meta.', 'error');
  });

  it.each([[''], ['0'], ['000']])('valor-alvo "%s" (zero/vazio) é recusado', (raw) => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Nome da meta/, 'Casa');
    type(/Valor-alvo/, raw);
    submit();
    expect(addToast).toHaveBeenCalledWith('Defina um valor-alvo maior que zero.', 'error');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('fronteira: R$ 0,01 já passa', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Nome da meta/, 'Casa');
    type(/Valor-alvo/, '1');
    expect(byLabel(/Valor-alvo/).value).toBe('0,01');
    submit();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(addToast).not.toHaveBeenCalled();
  });

  it('modo demo bloqueia antes da validação: só o aviso do demo', () => {
    demo.on = true;
    render(<CreateGoalModal isOpen onClose={onClose} />);
    submit();
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('Modo demonstração: nada foi alterado.', 'info');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('modo demo também bloqueia a edição', () => {
    demo.on = true;
    render(<CreateGoalModal isOpen onClose={onClose} goal={makeGoal()} />);
    submit('Salvar alterações');
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('CreateGoalModal (caracterização) — corpo enviado', () => {
  it('criação mínima: forma exata, sem manualBalance nem startValue', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Nome da meta/, '  O Milhão  ');
    type(/Valor-alvo/, '100000000');
    submit();
    expect(mutate).toHaveBeenCalledWith({
      name: 'O Milhão', icon: 'target', color: 'emerald', targetAmount: 1_000_000, monthlyTarget: 0,
      expectedAnnualRate: 14, mirrorWallet: true, targetDate: null, previousGoalId: null,
    });
    const payload = mutate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual([
      'name', 'icon', 'color', 'targetAmount', 'monthlyTarget', 'expectedAnnualRate', 'mirrorWallet', 'targetDate', 'previousGoalId',
    ]);
  });

  it('criação completa: ícone, cor, aporte, taxa, prazo, espelho desligado, saldo fora e continuação', () => {
    state.goals = [makeGoal({ _id: 'p1', name: 'Reserva' })];
    render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Nome da meta/, 'Casa');
    fireEvent.click(screen.getAllByRole('group')[0].querySelectorAll('button')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'purple' }));
    type(/Valor-alvo/, '50000000');
    type(/Aporte mensal/, '250000');
    type(/Rentabilidade esperada/, '12.5');
    type(/Prazo/, '2030-01-15');
    fireEvent.click(screen.getByRole('button', { name: /Espelhar minha carteira/ }));
    type(/Já tenho guardado/, '1234500');
    fireEvent.change(screen.getByLabelText(/Continuação de/), { target: { value: 'p1' } });
    submit();
    const payload = mutate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({
      name: 'Casa', icon: payload.icon, color: 'purple', targetAmount: 500_000, monthlyTarget: 2500,
      expectedAnnualRate: 12.5, mirrorWallet: false, targetDate: '2030-01-15', previousGoalId: 'p1', manualBalance: 12345,
    });
    expect(payload.icon).not.toBe('target');
  });

  it('taxa apagada vai como 0', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Nome da meta/, 'Casa');
    type(/Valor-alvo/, '100');
    type(/Rentabilidade esperada/, '');
    submit();
    expect((mutate.mock.calls[0][0] as Record<string, unknown>).expectedAnnualRate).toBe(0);
  });

  it('edição: manda startValue (e nunca manualBalance) com os valores salvos', () => {
    render(<CreateGoalModal isOpen onClose={onClose} goal={makeGoal({ previousGoalId: 'p9' })} />);
    submit('Salvar alterações');
    expect(mutate).toHaveBeenCalledWith({
      name: 'Reserva', icon: 'home', color: 'blue', targetAmount: 1234567.5, monthlyTarget: 850,
      expectedAnnualRate: 8, mirrorWallet: false, targetDate: '2027-06-30', previousGoalId: 'p9', startValue: 3200.4,
    });
  });

  it('edição: startValue apagado vai como 0', () => {
    render(<CreateGoalModal isOpen onClose={onClose} goal={makeGoal()} />);
    type(/Patrimônio no início/, '');
    submit('Salvar alterações');
    expect((mutate.mock.calls[0][0] as Record<string, unknown>).startValue).toBe(0);
  });

  it('criação chama createGoal com a carteira ativa; sucesso invalida "goals", avisa e fecha', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    state.mutation?.mutationFn({ name: 'x' });
    expect(goalsService.createGoal).toHaveBeenCalledWith({ name: 'x' }, 'w1');
    expect(goalsService.updateGoal).not.toHaveBeenCalled();
    state.mutation?.onSuccess();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['goals'] });
    expect(addToast).toHaveBeenCalledWith('Meta criada com sucesso!', 'success');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('edição chama updateGoal com o id; sucesso invalida a lista e a meta', () => {
    render(<CreateGoalModal isOpen onClose={onClose} goal={makeGoal()} />);
    state.mutation?.mutationFn({ name: 'x' });
    expect(goalsService.updateGoal).toHaveBeenCalledWith('g1', { name: 'x' }, 'w1');
    state.mutation?.onSuccess();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['goals'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['goal', 'g1'] });
    expect(addToast).toHaveBeenCalledWith('Meta atualizada.', 'success');
  });

  it('erro: mostra a mensagem do servidor, ou a genérica', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    state.mutation?.onError(new Error('Nome repetido'));
    state.mutation?.onError(undefined);
    expect(addToast).toHaveBeenNthCalledWith(1, 'Nome repetido', 'error');
    expect(addToast).toHaveBeenNthCalledWith(2, 'Erro ao salvar meta.', 'error');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('CreateGoalModal (caracterização) — continuação de outra meta', () => {
  it('sem meta elegível, o seletor não aparece', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    expect(screen.queryByLabelText(/Continuação de/)).toBeNull();
  });

  it('exclui a própria meta e as que já têm sucessora; mostra o aviso ao escolher', () => {
    state.goals = [
      makeGoal({ _id: 'g1', name: 'Eu mesma' }),
      makeGoal({ _id: 'a', name: 'Primeira', targetAmount: 1000 }),
      makeGoal({ _id: 'b', name: 'Segunda', previousGoalId: 'a' }),
    ];
    render(<CreateGoalModal isOpen onClose={onClose} goal={makeGoal({ _id: 'g1' })} />);
    const select = screen.getByLabelText(/Continuação de/) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['', 'b']);
    expect(screen.queryByText(/próximo passo da jornada/)).toBeNull();
    fireEvent.change(select, { target: { value: 'b' } });
    expect(screen.getByText(/próximo passo da jornada/)).toBeTruthy();
  });
});

describe('CreateGoalModal (caracterização) — atalhos de taxa e projeção', () => {
  it('atalho "Minha carteira" usa a sugestão; histórico com 0 dias não explica nada', () => {
    state.rate = context({ walletReturn: { value: null, days: 0, totalReturnPct: 0, enough: false, capped: false } });
    render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Rentabilidade esperada/, '3');
    fireEvent.click(screen.getByRole('button', { name: /Minha carteira \(14,0%\)/ }));
    expect(byLabel(/Rentabilidade esperada/).value).toBe('14');
    expect(screen.queryByText(/curto demais/)).toBeNull();
    expect(screen.getByText(/"Minha carteira" é a média/)).toBeTruthy();
  });

  it('histórico com dias fracionados arredonda no aviso', () => {
    state.rate = context({ walletReturn: { value: null, days: 40.6, totalReturnPct: 1, enough: false, capped: false } });
    render(<CreateGoalModal isOpen onClose={onClose} />);
    expect(screen.getByText(/41 dias/)).toBeTruthy();
  });

  it('sem valor-alvo não há projeção', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    expect(screen.queryByText('Projeção')).toBeNull();
  });

  it('projeção: base = carteira + saldo fora, tempo, data prevista e aporte para o prazo', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Valor-alvo/, '10000000');
    type(/Aporte mensal/, '100000');
    type(/Já tenho guardado/, '500000');
    type(/Prazo/, '2030-11-22');
    expect(screen.getByText('Projeção')).toBeTruthy();
    expect(screen.getByText('Você já tem').nextSibling?.textContent).toMatch(/15\.000,00/);
    expect(screen.getByText('Tempo estimado').nextSibling?.textContent).toMatch(/^~/);
    expect(screen.getByText('Data prevista')).toBeTruthy();
    expect(screen.getByText('Aporte p/ bater o prazo').nextSibling?.textContent).toMatch(/\/mês$/);
  });

  it('sem crescimento possível: "Sem caminho de chegada", sem data; prazo vencido não mostra aporte', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Espelhar minha carteira/ }));
    type(/Valor-alvo/, '10000000');
    type(/Prazo/, '2020-01-01');
    const tempo = screen.getByText('Tempo estimado').nextSibling as HTMLElement;
    expect(tempo.textContent).toBe('Sem caminho de chegada');
    expect(tempo.className).toContain('text-yellow-400');
    expect(screen.queryByText('Data prevista')).toBeNull();
    expect(screen.queryByText('Aporte p/ bater o prazo')).toBeNull();
    expect(screen.getByText('Você já tem').nextSibling?.textContent).toMatch(/0,00/);
  });
});

describe('CreateGoalModal (caracterização) — ícone, cor, fechar e foco', () => {
  it('ícone e cor escolhidos ganham destaque', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    const icons = screen.getAllByRole('group')[0].querySelectorAll('button');
    expect(icons[0].className).toContain('emerald');
    fireEvent.click(icons[2]);
    expect(icons[2].className).toContain('emerald');
    expect(icons[0].className).toContain('bg-base');
    fireEvent.click(screen.getByRole('button', { name: 'blue' }));
    expect(screen.getByRole('button', { name: 'blue' }).className).toContain('scale-110');
    expect(screen.getByRole('button', { name: 'emerald' }).className).toContain('border-transparent');
  });

  it('fechar pelo X e pelo Escape chama onClose', () => {
    render(<CreateGoalModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('fechado não renderiza nada', () => {
    render(<CreateGoalModal isOpen={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('o foco fica no campo enquanto se digita (o modal não devolve o foco ao "Fechar")', () => {
    render(<CreateGoalModal isOpen onClose={() => {}} />);
    const nome = byLabel(/Nome da meta/);
    nome.focus();
    for (const v of ['C', 'Ca', 'Cas', 'Casa']) fireEvent.change(nome, { target: { value: v } });
    expect(document.activeElement).toBe(nome);
    const alvo = byLabel(/Valor-alvo/);
    alvo.focus();
    type(/Valor-alvo/, '12');
    type(/Valor-alvo/, '123');
    expect(document.activeElement).toBe(alvo);
    expect(nome.value).toBe('Casa');
  });

  it('não viola WCAG estrutural (criação com projeção e edição com continuação)', async () => {
    state.goals = [makeGoal({ _id: 'p1' })];
    const { unmount } = render(<CreateGoalModal isOpen onClose={onClose} />);
    type(/Valor-alvo/, '100000');
    expect(await axe(document.body, AXE_SEM_NOME_DE_ICONE)).toHaveNoViolations();
    unmount();
    render(<CreateGoalModal isOpen onClose={onClose} goal={makeGoal()} />);
    expect(await axe(document.body, AXE_SEM_NOME_DE_ICONE)).toHaveNoViolations();
    const semNome = screen.getAllByRole('button').filter((b) => !b.textContent?.trim() && !b.getAttribute('aria-label'));
    expect(semNome.every((b) => b.closest('[role="group"]') === screen.getAllByRole('group')[0])).toBe(true);
  });
});
