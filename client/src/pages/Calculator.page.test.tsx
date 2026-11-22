/**
 * Calculadora como tela: o que a pessoa vê ao mexer nos controles.
 *
 * As funções puras (`pickPrefixadoRate`, `macroRates`) já têm teste próprio em
 * `Calculator.test.tsx`; aqui o alvo é o comportamento da página:
 *  - abre zerada e não simula sem número da pessoa;
 *  - sem taxa real (macro falhou), não simula e diz por quê — nunca um fallback fixo;
 *  - com taxas, mostra a melhor opção, o ranking e o detalhamento de cada card;
 *  - "comparar" limita a 3 curvas e nunca deixa o gráfico vazio;
 *  - aba da meta calcula o aporte por bisseção;
 *  - cenários salvos sobrevivem à desmontagem (localStorage) e restauram o estado;
 *  - ação/FII entram no ranking só com DY > 0.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { Calculator } from './Calculator';
import { researchService } from '../services/research';
import { authService } from '../services/auth';

vi.mock('../components/dashboard/Header', () => ({ Header: () => <header>cabeçalho</header> }));
vi.mock('../services/research', () => ({ researchService: { getMacroData: vi.fn() } }));
vi.mock('../services/auth', () => ({ authService: { api: vi.fn() } }));

const getMacro = vi.mocked(researchService.getMacroData);
const api = vi.mocked(authService.api);

const MACRO = {
  selic: { value: 15 },
  cdi: { value: 14.9 },
  ipca: { value: 4.5 },
  ntnbLong: { value: 7.2 },
  bonds: [
    { title: 'Tesouro Prefixado 2037 Juros Semestrais', type: 'PREFIXADO', rate: 14.62 },
    { title: 'Tesouro Prefixado 2029', type: 'PREFIXADO', rate: 14.13 },
  ],
};

const quote = (dy: number) => ({ ok: true, json: async () => ({ dy }) }) as unknown as Response;

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Calculator />
    </QueryClientProvider>,
  );
};

const setInitial = (v: string) => fireEvent.change(screen.getByLabelText('Investimento inicial'), { target: { value: v } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T12:00:00-03:00'));
  localStorage.clear();
  getMacro.mockReset();
  api.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('estado inicial', () => {
  it('abre zerada e pede o investimento antes de simular', async () => {
    getMacro.mockResolvedValue(MACRO);
    renderPage();
    expect(await screen.findByText('AO VIVO')).toBeInTheDocument();
    expect(screen.getByText('Informe o investimento inicial ou o aporte mensal para simular.')).toBeInTheDocument();
    expect(screen.queryByText('MELHOR OPÇÃO')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Salvar atual' })).toBeDisabled();
    // Parâmetros de mercado com o prefixado simples (o de juros semestrais fica de fora).
    expect(screen.getByText('14,90%')).toBeInTheDocument();
    expect(screen.getByText('14,13%')).toBeInTheDocument();
    expect(screen.queryByText('14,62%')).not.toBeInTheDocument();
    expect(screen.getByText('Taxas atualizadas em 22/11/2026')).toBeInTheDocument();
  });

  it('macro sem uma das taxas: selo INDISPONÍVEL e nenhuma simulação, mesmo com valor digitado', async () => {
    getMacro.mockResolvedValue({ ...MACRO, ntnbLong: { value: null } });
    renderPage();
    expect(await screen.findByText('INDISPONÍVEL')).toBeInTheDocument();
    setInitial('10000');
    expect(screen.getByText(/As taxas de mercado .* não chegaram agora/)).toBeInTheDocument();
    expect(screen.queryByText('MELHOR OPÇÃO')).not.toBeInTheDocument();
  });

  it('enquanto o macro carrega, mostra o esqueleto dos parâmetros', () => {
    getMacro.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6);
    expect(screen.queryByText('AO VIVO')).not.toBeInTheDocument();
  });
});

describe('simulação com taxas reais', () => {
  beforeEach(() => getMacro.mockResolvedValue(MACRO));

  it('mostra a melhor opção, o ranking de 7 instrumentos e o total investido', async () => {
    renderPage();
    await screen.findByText('AO VIVO');
    setInitial('10.000');
    // "R$ 1k" existe nos dois grupos de chips: o primeiro é o do investimento inicial.
    fireEvent.click(screen.getAllByRole('button', { name: 'R$ 1k' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'R$ 500' }));
    expect(screen.getByText('R$ 31.000')).toBeInTheDocument(); // 1.000 + 500 × 60
    expect(screen.getByText('MELHOR OPÇÃO')).toBeInTheDocument();
    expect(screen.getAllByText('Por que esse resultado?')).toHaveLength(7);
    // Poupança é o piso: aparece por último no ranking.
    const ranks = screen.getAllByText(/^0\d$/).map((el) => el.parentElement?.textContent ?? '');
    expect(ranks[ranks.length - 1]).toContain('Poupança');
    expect(screen.getAllByText('ISENTO DE IR').length).toBeGreaterThanOrEqual(2);
  });

  it('o detalhamento abre e fecha, com IR da faixa do prazo', async () => {
    renderPage();
    await screen.findByText('AO VIVO');
    setInitial('10000');
    fireEvent.click(screen.getByRole('button', { name: '1a' }));
    const cards = screen.getAllByText('Por que esse resultado?');
    fireEvent.click(cards[0]);
    expect(screen.getByText('Fechar detalhamento')).toBeInTheDocument();
    expect(screen.getByText('Valor bruto', { selector: 'span' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Fechar detalhamento'));
    expect(screen.queryByText('Fechar detalhamento')).not.toBeInTheDocument();
  });

  it('cada tipo de instrumento explica o próprio desconto', async () => {
    renderPage();
    await screen.findByText('AO VIVO');
    setInitial('10000');
    // Só um card abre por vez: abrir o próximo fecha o anterior.
    const textos: string[] = [];
    for (let i = 0; i < 7; i++) {
      const card = screen.getAllByText(/^0\d$/)[i].closest('div.rounded-2xl') as HTMLElement;
      fireEvent.click(within(card).getByText('Por que esse resultado?'));
      expect(screen.getAllByText('Fechar detalhamento')).toHaveLength(1);
      textos.push(within(card).getByText(/./, { selector: 'p' }).textContent ?? '');
    }
    const tudo = textos.join(' | ');
    expect(tudo).toMatch(/custódia da B3/);
    expect(tudo).toMatch(/taxa de administração/);
    expect(tudo).toMatch(/Isenta de imposto de renda/);
    expect(tudo).toMatch(/piso do mercado/);
    expect(tudo).toMatch(/Sem custódia nem taxa de administração/);
  });

  it('comparar: até 3 curvas, a mais antiga sai, e a última não pode ser removida', async () => {
    renderPage();
    await screen.findByText('AO VIVO');
    setInitial('10000');
    // Padrão: CDB e Poupança no gráfico.
    expect(screen.getAllByText('no gráfico')).toHaveLength(2);
    const comparar = () => screen.getAllByRole('button', { name: 'comparar' });
    fireEvent.click(comparar()[0]);
    expect(screen.getAllByText('no gráfico')).toHaveLength(3);
    fireEvent.click(comparar()[0]);
    expect(screen.getAllByText('no gráfico')).toHaveLength(3);
    // Remove até sobrar um; o último fica.
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getAllByText('no gráfico')[0]);
    expect(screen.getAllByText('no gráfico')).toHaveLength(1);
  });

  it('o gráfico mostra o tooltip do mês sob o cursor e some ao sair', async () => {
    renderPage();
    await screen.findByText('AO VIVO');
    setInitial('10000');
    const svg = screen.getByRole('img', { name: /Evolução do patrimônio/ });
    const area = svg.parentElement as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 250, right: 100, bottom: 250, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseMove(area, { clientX: 50 });
    expect(screen.getByText('MÊS 30 · 2a 6m')).toBeInTheDocument();
    fireEvent.mouseLeave(area);
    expect(screen.queryByText(/^MÊS 30/)).not.toBeInTheDocument();
  });

  it('prazo curto usa rótulos em meses no eixo', async () => {
    renderPage();
    await screen.findByText('AO VIVO');
    setInitial('10000');
    fireEvent.change(screen.getByLabelText('Período da aplicação em meses'), { target: { value: '7' } });
    expect(screen.getAllByText('7 meses').length).toBeGreaterThan(0);
    expect(screen.getByText('7m')).toBeInTheDocument();
  });

  it('sem violações de acessibilidade com resultados na tela', async () => {
    const { container } = renderPage();
    await screen.findByText('AO VIVO');
    setInitial('10000');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('aba "Chegar na meta"', () => {
  beforeEach(() => getMacro.mockResolvedValue(MACRO));

  it('sem meta pede o valor; com meta mostra o aporte mensal necessário', async () => {
    renderPage();
    await screen.findByText('AO VIVO');
    fireEvent.click(screen.getByRole('button', { name: 'Chegar na meta' }));
    expect(screen.getByText('Informe quanto você quer ter no fim do período para ver o aporte necessário.')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Meta de patrimônio'), { target: { value: '100000' } });
    const valor = screen.getByText(/^R\$ [\d.]+\/mês$/);
    const aporte = Number(valor.textContent?.replace(/\D/g, ''));
    expect(aporte).toBeGreaterThan(500);
    expect(aporte).toBeLessThan(1667); // abaixo de 100k/60: os juros ajudam
    expect(aporte % 10).toBe(0);
    expect(screen.getByText(/você chega a R\$ 100\.000 líquidos/)).toBeInTheDocument();
    expect(screen.getByText('Total aportado na meta')).toBeInTheDocument();
  });
});

describe('cenários salvos', () => {
  beforeEach(() => getMacro.mockResolvedValue(MACRO));

  it('salvar grava no storage, sobrevive a sair e voltar e restaura os números', async () => {
    const primeira = renderPage();
    await screen.findByText('AO VIVO');
    setInitial('10000');
    fireEvent.click(screen.getAllByRole('button', { name: 'R$ 1k' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '2a' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Salvar atual' }));
    const salvo = JSON.parse(localStorage.getItem('vertice_calc_scenarios_v1') ?? '[]');
    expect(salvo).toHaveLength(1);
    expect(salvo[0]).toMatchObject({ mode: 'simular', initial: 1000, months: 24, compare: ['cdb', 'poupanca'] });

    primeira.unmount();
    renderPage();
    await screen.findByText('AO VIVO');
    const titulo = screen.getByText('2 anos · R$ 0/mês · R$ 1.000');
    expect(screen.getByText('CDB · Poupança')).toBeInTheDocument();
    fireEvent.click(titulo);
    expect(screen.getAllByText('2 anos').length).toBeGreaterThan(1);
    expect(screen.getByText('MELHOR OPÇÃO')).toBeInTheDocument();
  });

  it('cada aba lista só os seus, e remover apaga do storage', async () => {
    localStorage.setItem('vertice_calc_scenarios_v1', JSON.stringify([
      { initial: 5000, monthly: 100, months: 12, summary: 'antigo sem modo' },
      { mode: 'meta', initial: 0, monthly: 900, months: 60, goal: 80000, summary: 'R$ 900/mês · CDB', compare: ['cdb'] },
    ]));
    renderPage();
    await screen.findByText('AO VIVO');
    expect(screen.getByText('antigo sem modo')).toBeInTheDocument();
    expect(screen.queryByText('R$ 900/mês · CDB')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Chegar na meta' }));
    expect(screen.getByText('METAS SALVAS')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Meta R$ 80.000 · 5 anos'));
    expect(screen.getByLabelText('Meta de patrimônio')).toHaveValue('80.000');

    fireEvent.click(screen.getByRole('button', { name: 'Remover meta' }));
    const resto = JSON.parse(localStorage.getItem('vertice_calc_scenarios_v1') ?? '[]');
    expect(resto).toHaveLength(1);
    expect(resto[0].summary).toBe('antigo sem modo');
  });

  it('storage corrompido não derruba a página', async () => {
    localStorage.setItem('vertice_calc_scenarios_v1', '{não é json');
    renderPage();
    expect(await screen.findByText('AO VIVO')).toBeInTheDocument();
    expect(screen.getByText('Salve a simulação atual para comparar depois com outro prazo ou aporte.')).toBeInTheDocument();
  });
});

describe('comparar com ativo', () => {
  beforeEach(() => getMacro.mockResolvedValue(MACRO));

  it('ação com DY entra no ranking como ativo; FII sem DY avisa e fica de fora', async () => {
    api.mockImplementation(async (url: string) => (url.includes('BBAS3') ? quote(9.5) : quote(0)));
    renderPage();
    await screen.findByText('AO VIVO');
    setInitial('10000');
    const [acao, fii] = screen.getAllByRole('combobox');
    fireEvent.change(acao, { target: { value: 'BBAS3' } });
    expect(screen.getByText(/Projeção considera apenas o DY atual/)).toBeInTheDocument();
    expect(await screen.findByText('DY atual: 9,50%')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/market/quote?ticker=BBAS3');
    expect(screen.getByText('BBAS3 · Banco do Brasil', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getAllByText('Por que esse resultado?')).toHaveLength(8);

    fireEvent.change(fii, { target: { value: 'MXRF11' } });
    expect(await screen.findByText('DY não disponível para este ativo')).toBeInTheDocument();
    expect(screen.getAllByText('Por que esse resultado?')).toHaveLength(8);

    const cardAcao = screen.getByText('BBAS3 · Banco do Brasil', { selector: 'span' }).closest('div.rounded-2xl') as HTMLElement;
    fireEvent.click(within(cardAcao).getByText('Por que esse resultado?'));
    expect(within(cardAcao).getByText(/Projeção feita só com o rendimento distribuído/)).toBeInTheDocument();
  });

  it('cotação que falha (HTTP) conta como sem DY', async () => {
    api.mockResolvedValue({ ok: false } as Response);
    renderPage();
    await screen.findByText('AO VIVO');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'VALE3' } });
    expect(screen.getByText('Carregando DY…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('DY não disponível para este ativo')).toBeInTheDocument());
  });
});
