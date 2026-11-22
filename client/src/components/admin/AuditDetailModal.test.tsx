/**
 * Testes do AuditDetailModal (Admin → auditoria de um relatório de ranking).
 *
 * Cobre: fechado, carregando (relatório ainda nulo), ranking ordenado por
 * score com métricas formatadas, filtro por perfil, auditoria completa
 * (`fullAuditLog`), filtro sem resultado e o painel de detalhe do ativo
 * (nota, critérios + / −, teses, base histórica sem log).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AuditDetailModal } from './AuditDetailModal';
import type { ResearchReport, RankingItem } from '../../services/research';

const rank = (over: Partial<RankingItem>): RankingItem => ({
  ticker: 'X', name: 'X SA', score: 50, action: 'WAIT', riskProfile: 'MODERATE', currentPrice: 10, ...over,
} as RankingItem);

const RANKING = [
  rank({ ticker: 'WEGE3', name: 'WEG', score: 72, riskProfile: 'MODERATE', action: 'BUY', position: 2,
    metrics: { grahamPrice: 30, bazinPrice: 25.5, dy: 2.345, pl: 28.44, pvp: 7.123, structural: { quality: 90, valuation: 40, risk: 75 } },
    auditLog: [
      { category: 'QUALIDADE', factor: 'ROE alto', points: 10 },
      { category: 'VALUATION', factor: 'P/L esticado', points: -8 },
    ],
    bullThesis: ['Margem consistente'], bearThesis: ['Múltiplo caro'] }),
  rank({ ticker: 'TAEE11', name: 'Taesa', score: 96, riskProfile: 'DEFENSIVE', action: 'BUY', position: 1 }),
  rank({ ticker: 'MGLU3', name: 'Magalu', score: 30, riskProfile: 'BOLD', action: 'SELL', currentPrice: undefined }),
];

const REPORT = {
  assetClass: 'STOCK',
  content: { ranking: RANKING, fullAuditLog: [...RANKING, rank({ ticker: 'OIBR3', score: 5, riskProfile: undefined })] },
} as unknown as ResearchReport;

const tickers = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
  .map((r) => within(r).getAllByRole('cell')[1].firstChild?.textContent);

describe('AuditDetailModal', () => {
  it('fechado não renderiza; sem relatório mostra carregando', () => {
    const { rerender } = render(<AuditDetailModal isOpen={false} onClose={vi.fn()} report={REPORT} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<AuditDetailModal isOpen onClose={vi.fn()} report={null} />);
    expect(screen.getByText('Carregando auditoria...')).toBeInTheDocument();
  });

  it('lista o ranking por score com métricas formatadas', () => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={REPORT} />);
    expect(screen.getByText('Auditoria: STOCK')).toBeInTheDocument();
    expect(screen.getByText(/3 Ativos Listados/)).toBeInTheDocument();
    expect(tickers()).toEqual(['TAEE11', 'WEGE3', 'MGLU3']);

    const wege = screen.getByText('WEGE3').closest('tr') as HTMLElement;
    const cells = within(wege).getAllByRole('cell').map((c) => c.textContent?.replace(/\u00a0/g, ' '));
    expect(cells).toEqual(['2', 'WEGE3WEG', 'MODERATE', '72', 'R$ 10,00', 'R$ 30,00', 'R$ 25,50', '2.3%', '28.4', '7.12', 'BUY']);
    const mglu = within(screen.getByText('MGLU3').closest('tr') as HTMLElement).getAllByRole('cell');
    expect(mglu[0]).toHaveTextContent('3');
    expect(mglu[4]).toHaveTextContent('-');
    expect(mglu[7]).toHaveTextContent('0%');
    // Sem axe: o role="dialog" não tem nome acessível (aria-dialog-name) — defeito relatado.
  });

  it('filtra por perfil e mostra o vazio quando nada casa', () => {
    const report = { ...REPORT, content: { ranking: RANKING.slice(0, 2) } } as unknown as ResearchReport;
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={report} />);
    fireEvent.click(screen.getByRole('button', { name: /Defensiva/ }));
    expect(tickers()).toEqual(['TAEE11']);
    fireEvent.click(screen.getByRole('button', { name: /Arrojada/ }));
    expect(screen.getByText('Nenhum ativo encontrado com este filtro.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Moderada/ }));
    expect(tickers()).toEqual(['WEGE3']);
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    expect(tickers()).toHaveLength(2);
  });

  it('auditoria completa usa o fullAuditLog e esconde os filtros', () => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Defensiva/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Auditoria Completa (Logs)' }));
    expect(tickers()).toEqual(['TAEE11', 'WEGE3', 'MGLU3', 'OIBR3']);
    expect(screen.queryByRole('button', { name: /Defensiva/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ranking (Selecionados)' }));
    expect(tickers()).toHaveLength(3);
  });

  it('clicar num ativo abre o diário com nota, critérios e teses', () => {
    render(<AuditDetailModal isOpen onClose={vi.fn()} report={REPORT} />);
    fireEvent.click(screen.getByText('WEGE3'));
    expect(screen.getByText('Diário de Auditoria')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Ativo com fundamentos sólidos, mas pontuação média.')).toBeInTheDocument();
    expect(screen.getByText('90')).toHaveClass('text-emerald-400');
    expect(screen.getByText('"ROE alto"')).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
    expect(screen.getByText('❌ P/L esticado')).toBeInTheDocument();
    expect(screen.getByText('-8')).toBeInTheDocument();
    expect(screen.getByText('✓ Margem consistente')).toBeInTheDocument();
    expect(screen.getByText('⚠ Múltiplo caro')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('TAEE11')[0]);
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('Recomendação Forte para o perfil atual.')).toBeInTheDocument();
    expect(screen.getByText('Ativo em base histórica. Re-crunch para logs detalhados.')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('MGLU3')[0]);
    expect(screen.getByText('F')).toBeInTheDocument();
    expect(screen.getByText('Ativo descartado pelo Motor de Decisão por falta de critérios.')).toBeInTheDocument();
  });

  it('fechar pelo X e pelo fundo chama onClose', () => {
    const onClose = vi.fn();
    const { baseElement } = render(<AuditDetailModal isOpen onClose={onClose} report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    fireEvent.click(baseElement.querySelector('[role="presentation"]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
