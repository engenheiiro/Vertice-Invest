/**
 * Caracterização do AuditDetailModal: trava a saída visível (texto e classes
 * de cor) de cada ramo antes de a lógica de exibição sair do componente.
 * Complementa AuditDetailModal.test.tsx sem repetir os casos dele.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AuditDetailModal } from './AuditDetailModal';
import type { ResearchReport, RankingItem } from '../../services/research';

const rank = (over: Partial<RankingItem>): RankingItem => ({
  ticker: 'X', name: 'X SA', score: 50, action: 'WAIT', riskProfile: 'MODERATE', currentPrice: 10, ...over,
} as RankingItem);

const report = (ranking: RankingItem[], fullAuditLog?: RankingItem[]) =>
  ({ assetClass: 'FII', content: { ranking, fullAuditLog } } as unknown as ResearchReport);

const row = (ticker: string) => screen.getAllByText(ticker)[0].closest('tr') as HTMLElement;
const cells = (ticker: string) => within(row(ticker)).getAllByRole('cell');
const grade = () => document.querySelector('.rotate-12') as HTMLElement;
const tickers = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
  .map((r) => within(r).getAllByRole('cell')[1].firstChild?.textContent);

describe('AuditDetailModal — caracterização', () => {
  it('cor e texto do perfil por linha, inclusive perfil ausente', () => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={report([
      rank({ ticker: 'DEF1', riskProfile: 'DEFENSIVE', score: 60 }),
      rank({ ticker: 'MOD1', riskProfile: 'MODERATE', score: 50 }),
      rank({ ticker: 'BOL1', riskProfile: 'BOLD', score: 40 }),
      rank({ ticker: 'NUL1', riskProfile: undefined, score: 30 }),
    ])} />);
    const profileCell = (t: string) => cells(t)[2].firstChild as HTMLElement;
    expect(profileCell('DEF1')).toHaveClass('text-emerald-400');
    expect(profileCell('DEF1')).toHaveTextContent('DEFENSIVE');
    expect(profileCell('MOD1')).toHaveClass('text-blue-400');
    expect(profileCell('BOL1')).toHaveClass('text-purple-400');
    expect(profileCell('NUL1')).toHaveClass('text-blue-400');
    expect(profileCell('NUL1')).toHaveTextContent('-');
    expect(profileCell('NUL1').querySelector('svg')).not.toBeNull();
    expect(screen.getByText(/4 Ativos Listados/)).toBeInTheDocument();
  });

  it('badge de score, ação e métricas ausentes', () => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={report([
      rank({ ticker: 'BUY1', score: 70, action: 'BUY', metrics: { dy: 0, pl: 0, pvp: undefined } as RankingItem['metrics'] }),
      rank({ ticker: 'SEL1', score: 69, action: 'SELL', currentPrice: NaN }),
      rank({ ticker: 'WAI1', score: 10, action: 'WAIT', position: 7 }),
    ])} />);
    expect(within(cells('BUY1')[3]).getByText('70')).toHaveClass('bg-emerald-500/20', 'text-emerald-400');
    expect(within(cells('SEL1')[3]).getByText('69')).toHaveClass('bg-slate-800', 'text-slate-400');
    expect(within(cells('BUY1')[10]).getByText('BUY')).toHaveClass('bg-emerald-500', 'text-black');
    expect(within(cells('SEL1')[10]).getByText('SELL')).toHaveClass('bg-red-500', 'text-white');
    expect(within(cells('WAI1')[10]).getByText('WAIT')).toHaveClass('bg-slate-700');
    expect(within(cells('WAI1')[10]).getByText('WAIT')).not.toHaveClass('bg-red-500');
    const buy = cells('BUY1').map((c) => c.textContent);
    expect(buy.slice(5)).toEqual(['-', '-', '0%', '0.0', '-', 'BUY']);
    expect(cells('SEL1')[4]).toHaveTextContent('-');
    expect(cells('SEL1')[0]).toHaveTextContent('2');
    expect(cells('WAI1')[0]).toHaveTextContent('7');
  });

  it('ordena por score tratando score ausente como 0 e cai no ranking sem fullAuditLog', () => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={report([
      rank({ ticker: 'ZER1', score: undefined as unknown as number }),
      rank({ ticker: 'NEG1', score: -5 }),
      rank({ ticker: 'TOP1', score: 80 }),
    ])} />);
    expect(tickers()).toEqual(['TOP1', 'ZER1', 'NEG1']);
    fireEvent.click(screen.getByRole('button', { name: 'Auditoria Completa (Logs)' }));
    expect(tickers()).toEqual(['TOP1', 'ZER1', 'NEG1']);
    expect(screen.getByRole('button', { name: 'Auditoria Completa (Logs)' })).toHaveClass('bg-blue-600');
    expect(screen.getByRole('button', { name: 'Ranking (Selecionados)' })).toHaveClass('text-slate-400');
  });

  it('botões de filtro marcam o ativo com a cor do perfil', () => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={report([rank({ ticker: 'A1' })])} />);
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveClass('bg-slate-700', 'text-white');
    expect(screen.getByRole('button', { name: /Defensiva/ })).toHaveClass('text-slate-500', 'hover:border-emerald-900');
    fireEvent.click(screen.getByRole('button', { name: /Defensiva/ }));
    expect(screen.getByRole('button', { name: /Defensiva/ })).toHaveClass('text-emerald-400');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveClass('text-slate-500');
    fireEvent.click(screen.getByRole('button', { name: /Moderada/ }));
    expect(screen.getByRole('button', { name: /Moderada/ })).toHaveClass('text-blue-400', 'bg-blue-900/30');
    fireEvent.click(screen.getByRole('button', { name: /Arrojada/ }));
    expect(screen.getByRole('button', { name: /Arrojada/ })).toHaveClass('text-purple-400', 'bg-purple-900/30');
    expect(screen.getByRole('button', { name: /Moderada/ })).toHaveClass('hover:border-blue-900');
  });

  it.each([
    [95, 'A+', 'border-emerald-500', 'Recomendação Forte para o perfil atual.'],
    [90, 'A', 'border-emerald-500', 'Recomendação Forte para o perfil atual.'],
    [85, 'B+', 'border-blue-500', 'Recomendação Forte para o perfil atual.'],
    [80, 'B+', 'border-blue-500', 'Recomendação Forte para o perfil atual.'],
    [75, 'B', 'border-slate-400', 'Ativo com fundamentos sólidos, mas pontuação média.'],
    [70, 'B', 'border-slate-400', 'Ativo com fundamentos sólidos, mas pontuação média.'],
    [65, 'C', 'border-red-500', 'Ativo com fundamentos sólidos, mas pontuação média.'],
    [60, 'C', 'border-red-500', 'Ativo descartado pelo Motor de Decisão por falta de critérios.'],
    [59, 'F', 'border-red-500', 'Ativo descartado pelo Motor de Decisão por falta de critérios.'],
  ])('score %i: nota %s, borda %s e veredito', (score, letter, border, verdict) => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={report([rank({ ticker: 'SEL9', score })])} />);
    fireEvent.click(screen.getByText('SEL9'));
    expect(grade()).toHaveTextContent(letter);
    expect(grade()).toHaveClass(border);
    expect(screen.getByText(verdict)).toBeInTheDocument();
    expect((document.querySelector('.duration-1000') as HTMLElement).style.width).toBe(`${score}%`);
  });

  it('painel: resumo estrutural, só critérios positivos, sem teses, seleção e fechar', () => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={report([
      rank({ ticker: 'PNL1', score: 77, metrics: { structural: { quality: 70, valuation: 71, risk: 72 } } as RankingItem['metrics'],
        auditLog: [{ category: 'Q', factor: 'Bom', points: 3 }, { category: 'Z', factor: 'Neutro', points: 0 }] }),
      rank({ ticker: 'PNL2', score: 20, metrics: undefined, auditLog: [{ category: 'R', factor: 'Ruim', points: -2 }] }),
    ])} />);
    fireEvent.click(screen.getByText('PNL1'));
    expect(row('PNL1')).toHaveClass('bg-blue-600/10');
    expect(row('PNL2')).not.toHaveClass('bg-blue-600/10');
    expect(screen.getByText('PN')).toBeInTheDocument();
    expect(screen.getByText('70')).toHaveClass('text-white');
    expect(screen.getByText('71')).toHaveClass('text-blue-400');
    expect(screen.getByText('72')).toHaveClass('text-purple-400');
    expect(screen.getByText('Critérios Atendidos (+)')).toBeInTheDocument();
    expect(screen.queryByText('Falhas e Penalidades (-)')).not.toBeInTheDocument();
    expect(screen.queryByText('"Neutro"')).not.toBeInTheDocument();
    expect(screen.queryByText('Ativo em base histórica. Re-crunch para logs detalhados.')).not.toBeInTheDocument();
    expect(screen.queryByText(/^✓/)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText('PNL2')[0]);
    expect(screen.queryByText('Critérios Atendidos (+)')).not.toBeInTheDocument();
    expect(screen.getByText('Falhas e Penalidades (-)')).toBeInTheDocument();
    const summary = Array.from(document.querySelectorAll('.grid-cols-3 .text-lg')).map((e) => e.textContent);
    expect(summary).toEqual(['0', '0', '0']);

    const panel = screen.getByText('Diário de Auditoria').closest('.animate-slide-in-right') as HTMLElement;
    fireEvent.click(within(panel).getAllByRole('button')[0]);
    expect(screen.queryByText('Diário de Auditoria')).not.toBeInTheDocument();
  });

  it('auditLog só com zeros não mostra nem positivos, nem negativos, nem a nota histórica', () => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={report([
      rank({ ticker: 'ZZZ1', auditLog: [{ category: 'Z', factor: 'Neutro', points: 0 }] }),
    ])} />);
    fireEvent.click(screen.getByText('ZZZ1'));
    expect(screen.queryByText('Critérios Atendidos (+)')).not.toBeInTheDocument();
    expect(screen.queryByText('Falhas e Penalidades (-)')).not.toBeInTheDocument();
    expect(screen.queryByText('Ativo em base histórica. Re-crunch para logs detalhados.')).not.toBeInTheDocument();
  });
});
