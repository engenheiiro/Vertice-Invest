/**
 * AssetDetailModal — dossiê de um ativo do ranking (Pesquisa).
 *
 * Testes de caracterização: travam o que a tela mostra hoje por classe
 * (STOCK / FII / CRYPTO / STOCK_US), por perfil de risco, no corte de compra
 * (70 → COMPRAR/AGUARDAR), com métricas ausentes, com e sem auditoria/teses,
 * moeda por classe, alerta qualitativo e abrir/fechar.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AssetDetailModal } from './AssetDetailModal';
import type { RankingItem } from '../../services/research';

beforeAll(() => {
  // jsdom não implementa ResizeObserver — usado pelo ResponsiveContainer do recharts.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterAll(() => vi.unstubAllGlobals());

const mk = (over: Partial<RankingItem>): RankingItem => ({
  position: 1,
  ticker: 'WEGE3',
  name: 'WEG SA',
  sector: 'Industrial',
  type: 'STOCK',
  action: 'BUY',
  currentPrice: 40,
  targetPrice: 50,
  score: 70,
  probability: 0.8,
  riskProfile: 'DEFENSIVE',
  thesis: '',
  reason: '',
  metrics: {
    grahamPrice: 0, bazinPrice: 0, pegRatio: 0, altmanZScore: 0, earningsYield: 0,
    roe: 20, dy: 7, pl: 12.5, pvp: 1.1,
    structural: { quality: 81, valuation: 62, risk: 73 },
  },
  ...over,
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\xa0/g, ' ');

/** Valor exibido na linha de indicador cujo rótulo é `label`. */
const rowValue = (label: string) => {
  const row = screen.getByText(label).parentElement as HTMLElement;
  return row.lastElementChild as HTMLElement;
};

describe('AssetDetailModal', () => {
  it('fechado ou sem ativo não renderiza nada', () => {
    const { rerender } = render(<AssetDetailModal isOpen={false} onClose={vi.fn()} asset={mk({})} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<AssetDetailModal isOpen onClose={vi.fn()} asset={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fundo do modal é bg-black/95 do design system (era bg-black/90)', () => {
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={mk({})} />);
    const backdrop = screen.getByRole('dialog').querySelector('[role="presentation"]');
    expect(backdrop).toHaveClass('bg-black/95');
    expect(backdrop).not.toHaveClass('bg-black/90');
  });

  it('STOCK defensivo com score 70 (corte) é COMPRAR, nota B, em R$ e acessível', async () => {
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={mk({ usSubType: 'REIT' })} />);
    const dialog = screen.getByRole('dialog', { name: 'WEGE3' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('STOCK')).toBeInTheDocument();
    expect(screen.getByText('Industrial')).toBeInTheDocument();
    // Badge de sub-tipo só existe em STOCK_US.
    expect(screen.queryByText('REIT')).not.toBeInTheDocument();
    expect(screen.getByText('Defensivo')).toBeInTheDocument();
    expect(screen.queryByText('Moderado')).not.toBeInTheDocument();
    expect(screen.getByText('B')).toHaveClass('border-slate-400');
    expect(screen.getByText('OPORTUNIDADE DE ENTRADA')).toHaveClass('text-emerald-500');
    expect(screen.getByText('Para o perfil defensivo')).toBeInTheDocument();
    expect(screen.getByText('Ativo com fundamentos sólidos, recomendado para diversificação.')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();

    // Valuation da sidebar em reais; upside = 50/40 − 1 = +25%.
    expect(norm(screen.getByText('Preço Atual').nextElementSibling?.textContent)).toBe('R$ 40');
    expect(norm(screen.getByText('Preço Teto').nextElementSibling?.textContent)).toBe('R$ 50');
    expect(screen.getByText('+25.0%')).toHaveClass('text-emerald-400');
    expect(screen.getByText('7.0%')).toHaveClass('text-emerald-400');

    // Eixos estruturais: legenda do radar e barras do boletim.
    expect(screen.getByText('81')).toBeInTheDocument();
    expect(screen.getByText('81%')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('73')).toBeInTheDocument();

    // Quadro de indicadores de AÇÃO.
    expect(rowValue('P/L')).toHaveTextContent('12,5');
    expect(rowValue('P/L')).toHaveClass('text-white');
    expect(rowValue('P/VP')).toHaveClass('text-emerald-400');
    expect(rowValue('ROE')).toHaveTextContent('20.00%');
    expect(rowValue('Margem Líquida')).toHaveTextContent('-');
    expect(rowValue('Margem Líquida')).toHaveClass('text-slate-500');
    expect(rowValue('Beta')).toHaveTextContent('N/A');
    expect(screen.getByText('Financials (LTM)')).toBeInTheDocument();
    expect(screen.queryByText('Financials (USD)')).not.toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('score 69 é AGUARDAR com nota C e boletim de cautela (perfil moderado)', () => {
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={mk({ score: 69, action: 'WAIT', riskProfile: 'MODERATE' })} />);
    expect(screen.getByText('Moderado')).toBeInTheDocument();
    expect(screen.getByText('C')).toHaveClass('border-red-500');
    expect(screen.getByText('AGUARDAR')).toHaveClass('text-yellow-500');
    expect(screen.getByText('Para o perfil moderado')).toBeInTheDocument();
    expect(screen.getByText('Ativo apresenta riscos ou valuation esticado, requer cautela.')).toBeInTheDocument();
  });

  it('notas por faixa de score e boletim classe A', () => {
    const grades: Array<[number, string, string]> = [
      [95, 'A+', 'border-emerald-500'], [90, 'A', 'border-emerald-500'], [80, 'B+', 'border-blue-500'], [59, 'F', 'border-red-500'],
    ];
    for (const [score, grade, border] of grades) {
      const { unmount } = render(<AssetDetailModal isOpen onClose={vi.fn()} asset={mk({ score })} />);
      expect(screen.getByText(grade)).toHaveClass(border);
      if (score >= 80) {
        expect(screen.getByText('Ativo classe A com fundamentos excepcionais e valuation atrativo.')).toBeInTheDocument();
      }
      unmount();
    }
  });

  it('sem perfil o rótulo cai em moderado e nenhum badge de perfil aparece; SELL vira VENDA', () => {
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={mk({ riskProfile: undefined, action: 'SELL', sector: undefined })} />);
    expect(screen.getByText('VENDA')).toHaveClass('text-red-500');
    expect(screen.getByText('Para o perfil moderado')).toBeInTheDocument();
    expect(screen.getByText('Geral')).toBeInTheDocument();
    expect(screen.queryByText('Defensivo')).not.toBeInTheDocument();
    expect(screen.queryByText('Moderado')).not.toBeInTheDocument();
    expect(screen.queryByText('Arrojado')).not.toBeInTheDocument();
  });

  it('FII arrojado mostra o quadro de FII e nenhum bloco de Financials', () => {
    const asset = mk({
      ticker: 'HGLG11', type: 'FII', riskProfile: 'BOLD', score: 75,
      metrics: { dy: 9, pvp: 1.4, vacancy: 3, capRate: 5, ffoYield: 9.5, beta: 1.3, volatility: 18, avgLiquidity: 2_500_000 } as RankingItem['metrics'],
    });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(screen.getByText('Arrojado')).toBeInTheDocument();
    expect(screen.getByText('Para o perfil arrojado')).toBeInTheDocument();
    expect(rowValue('Dividend Yield (12m)')).toHaveClass('text-emerald-400');
    expect(rowValue('P/VP')).toHaveClass('text-yellow-400');
    expect(rowValue('Vacância Física')).toHaveTextContent('3.00%');
    expect(rowValue('Vacância Física')).toHaveClass('text-emerald-400');
    expect(rowValue('Cap Rate Impl.')).toHaveClass('text-yellow-400');
    expect(rowValue('FFO Yield')).toHaveClass('text-emerald-400');
    expect(rowValue('Beta')).toHaveClass('text-yellow-400');
    expect(rowValue('Volatilidade')).toHaveTextContent('18.00%');
    expect(norm(rowValue('Liquidez Diária').textContent)).toBe('R$ 2.5M');
    expect(screen.queryByText(/^Financials/)).not.toBeInTheDocument();
    expect(screen.getByText('9.0%')).toHaveClass('text-emerald-400');
  });

  it('CRYPTO usa US$ no preço e mostra SMA 200 e score estrutural', () => {
    const asset = mk({
      ticker: 'BTC', type: 'CRYPTO', currentPrice: 90_000, targetPrice: 81_000, score: 72,
      metrics: { dy: 0, mktCap: 1.8e12, sma200: 80_000, volatility: 120, avgLiquidity: 3e10 } as RankingItem['metrics'],
    });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(norm(rowValue('Market Cap').textContent)).toBe('$ 1800.0B');
    expect(norm(screen.getAllByText('Preço Atual')[0].parentElement?.lastElementChild?.textContent)).toMatch(/^US\$ 90 mil$/);
    expect(norm(screen.getByText('Preço Teto').nextElementSibling?.textContent)).toMatch(/^US\$ 81 mil$/);
    expect(rowValue('SMA 200')).toHaveClass('text-emerald-400');
    expect(rowValue('Volatilidade (a.a.)')).toHaveClass('text-red-500');
    expect(rowValue('Score Estrutural')).toHaveTextContent('72');
    expect(rowValue('Score Estrutural')).toHaveClass('text-emerald-400');
    expect(screen.getByText('-10.0%')).toHaveClass('text-red-400');
    expect(screen.getByText('0%')).toHaveClass('text-slate-500');
    expect(screen.queryByText(/^Financials/)).not.toBeInTheDocument();
  });

  it('CRYPTO sem SMA e abaixo do corte marca SMA ruim e score em alerta', () => {
    const asset = mk({ type: 'CRYPTO', score: 69, action: 'WAIT', metrics: { dy: 0 } as RankingItem['metrics'] });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(rowValue('SMA 200')).toHaveTextContent('N/A');
    expect(rowValue('SMA 200')).toHaveClass('text-red-500');
    expect(rowValue('Score Estrutural')).toHaveClass('text-yellow-400');
    expect(rowValue('Market Cap')).toHaveTextContent('-');
  });

  it('STOCK_US mostra badge do sub-tipo, quadro em inglês e Financials (USD)', () => {
    const asset = mk({
      ticker: 'O', type: 'STOCK_US', usSubType: 'REIT', currentPrice: 55, targetPrice: 60,
      metrics: {
        pl: 45, pvp: 1.2, roe: 4, netMargin: -2, revenueGrowth: 6, dy: 5, beta: 1.6, marketCap: 4.5e10,
        debtToEquity: 2.5, lpa: 2.5, vpa: 30, earningsGrowth: 12, avgLiquidity: 3e8,
      } as RankingItem['metrics'],
    });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(screen.getByText('REIT')).toBeInTheDocument();
    expect(norm(screen.getByText('Preço Teto').nextElementSibling?.textContent)).toMatch(/^US\$ 60$/);
    expect(rowValue('P/E (P/L)')).toHaveClass('text-yellow-400');
    expect(rowValue('P/VP (P/B)')).toHaveClass('text-white');
    expect(rowValue('ROE')).toHaveClass('text-red-500');
    expect(rowValue('Profit Margin')).toHaveClass('text-red-500');
    expect(rowValue('Revenue Growth')).toHaveClass('text-emerald-400');
    expect(rowValue('Dividend Yield')).toHaveClass('text-blue-400');
    expect(rowValue('Beta (vs S&P)')).toHaveClass('text-yellow-400');
    expect(screen.getByText('Financials (USD)')).toBeInTheDocument();
    expect(screen.getAllByText('$ 45.0B')).toHaveLength(2);
    expect(rowValue('Debt/Equity')).toHaveClass('text-yellow-400');
    expect(rowValue('EPS (LPA)')).toHaveTextContent('$2.50');
    expect(rowValue('Book Value')).toHaveTextContent('$30.00');
    expect(rowValue('Earnings Growth')).toHaveClass('text-emerald-400');
    expect(rowValue('Volume Médio')).toHaveTextContent('$ 300.0M');
  });

  it('STOCK_US sem métricas cai em N/A e sub-tipo desconhecido aparece cru', () => {
    const asset = mk({
      type: 'STOCK_US', usSubType: 'XYZ' as RankingItem['usSubType'], score: 60,
      metrics: { pl: 20 } as RankingItem['metrics'],
    });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(screen.getByText('XYZ')).toBeInTheDocument();
    expect(rowValue('P/E (P/L)')).toHaveClass('text-emerald-400');
    for (const label of ['P/VP (P/B)', 'Revenue Growth', 'Beta (vs S&P)', 'Debt/Equity', 'EPS (LPA)', 'Book Value', 'Earnings Growth']) {
      expect(rowValue(label)).toHaveTextContent('N/A');
    }
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('STOCK sem métricas: traços, eixos 50 padrão, Financials LTM vazio', () => {
    const asset = mk({ currentPrice: 0, targetPrice: 0, metrics: { dy: 0 } as RankingItem['metrics'] });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(screen.getAllByText('50')).toHaveLength(3);
    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.getByText('0.0%')).toHaveClass('text-red-400');
    expect(rowValue('P/L')).toHaveTextContent('-');
    expect(rowValue('Valor de Mercado')).toHaveTextContent('-');
    expect(rowValue('Lucro Líquido')).toHaveTextContent('-');
    expect(rowValue('Lucro Líquido')).toHaveClass('text-slate-500');
    expect(screen.queryByText('Detalhamento de Pontos')).not.toBeInTheDocument();
  });

  it('STOCK com Financials LTM preenchido e indicadores de dívida', () => {
    const asset = mk({
      metrics: {
        marketCap: 2e9, netDebt: 3e9, netRevenue: 5e8, netIncome: -1e6, patrimLiq: 1e9, totalAssets: 4e9,
        debtToEquity: 150, evEbitda: 7, netMargin: 12, beta: 1.3, volatility: 22,
      } as RankingItem['metrics'],
    });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(norm(rowValue('Valor de Mercado').textContent)).toBe('R$ 2.0B');
    expect(rowValue('Dívida Líquida')).toHaveClass('text-yellow-400');
    expect(norm(rowValue('Receita Líquida').textContent)).toBe('R$ 500.0M');
    expect(norm(rowValue('Lucro Líquido').textContent)).toBe('R$ -1.0M');
    expect(rowValue('Lucro Líquido')).toHaveClass('text-red-500');
    expect(rowValue('Dívida Líq/PL')).toHaveClass('text-yellow-400'); // 150 → 1,5 (escala %)
    expect(rowValue('EV/EBITDA')).toHaveClass('text-emerald-400');
    expect(rowValue('Margem Líquida')).toHaveClass('text-emerald-400');
    expect(rowValue('Beta')).toHaveClass('text-yellow-400');
    expect(rowValue('Volatilidade')).toHaveTextContent('22.00%');
  });

  it('auditoria filtra pelo perfil do ativo, descarta zero e separa ganhos de perdas', () => {
    const asset = mk({
      score: 100,
      auditLog: [
        { category: 'Qualidade', factor: 'ROE alto', points: 10, type: 'bonus' },
        { category: 'Perfil Defensivo', factor: 'Setor perene', points: 5, type: 'bonus' },
        { category: 'Perfil Arrojado', factor: 'Crescimento', points: 8, type: 'bonus' },
        { category: 'Valuation', factor: 'Neutro', points: 0, type: 'base' },
        { category: 'Outro', factor: 'Fora do mapa', points: 3, type: 'bonus' },
      ],
      bullThesis: ['Margem consistente', 'Caixa líquido'],
      bearThesis: [],
      reason: 'Tese própria do ativo.',
    });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(screen.getByText('Detalhamento de Pontos')).toBeInTheDocument();
    expect(screen.getByText('✓ ROE alto')).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
    expect(screen.getByText('✓ Setor perene')).toBeInTheDocument();
    expect(screen.queryByText('✓ Crescimento')).not.toBeInTheDocument();
    expect(screen.queryByText('✓ Neutro')).not.toBeInTheDocument();
    expect(screen.queryByText('✓ Fora do mapa')).not.toBeInTheDocument();
    // Sem penalidade e score 100: sem a nota de bônus não conquistados.
    expect(screen.getByText('Sem penalidades registradas.')).toBeInTheDocument();
    expect(screen.queryByText(/critérios bônus não conquistados/)).not.toBeInTheDocument();

    const bull = within(screen.getByText('Por que Investir?').closest('div.rounded-2xl') as HTMLElement);
    expect(bull.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Margem consistente', 'Caixa líquido']);
    expect(screen.getByText('Nenhum risco crítico detectado automaticamente.')).toBeInTheDocument();
    expect(screen.getByText('Tese própria do ativo.')).toBeInTheDocument();
  });

  it('auditoria só com perdas: ganhos vazios, perdas listadas até 12, teses negativas e texto padrão', () => {
    const losses = Array.from({ length: 14 }, (_, i) => ({ category: 'Risco', factor: `Perda ${i}`, points: -(i + 1), type: 'penalty' as const }));
    const asset = mk({ score: 65, action: 'WAIT', auditLog: losses, bearThesis: ['Alavancagem alta'] });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(screen.getByText('Sem bônus significativos.')).toBeInTheDocument();
    expect(screen.getAllByText(/^⚠️ Perda/)).toHaveLength(12);
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(screen.queryByText('⚠️ Perda 12')).not.toBeInTheDocument();
    expect(screen.getByText('Aguardando geração de tese positiva pelo algoritmo.')).toBeInTheDocument();
    expect(screen.getByText('Alavancagem alta')).toBeInTheDocument();
    expect(screen.getByText(/Análise baseada em fluxo de caixa descontado/)).toBeInTheDocument();
  });

  it('auditoria só com ganhos e score abaixo de 100 explica os bônus não conquistados', () => {
    const asset = mk({ score: 88, auditLog: [{ category: 'Confiança', factor: 'Dado fresco', points: 2, type: 'bonus' }] });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(screen.getByText('✓ Dado fresco')).toBeInTheDocument();
    expect(screen.getByText(/critérios bônus não conquistados/)).toBeInTheDocument();
  });

  it('alerta qualitativo ativo aparece com nível e racional', () => {
    const asset = mk({ riskVeto: { active: true, level: 'HIGH', rationale: 'Governança questionável.' } });
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={asset} />);
    expect(screen.getByText('Alerta qualitativo HIGH')).toBeInTheDocument();
    expect(screen.getByText('Governança questionável.')).toBeInTheDocument();
  });

  it('alerta inativo não aparece', () => {
    render(<AssetDetailModal isOpen onClose={vi.fn()} asset={mk({ riskVeto: { active: false, level: 'LOW', rationale: 'x' } })} />);
    expect(screen.queryByText(/Alerta qualitativo/)).not.toBeInTheDocument();
  });

  it('os dois botões Fechar e o fundo chamam onClose', () => {
    const onClose = vi.fn();
    const { baseElement } = render(<AssetDetailModal isOpen onClose={onClose} asset={mk({})} />);
    const buttons = screen.getAllByRole('button', { name: 'Fechar' });
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => fireEvent.click(b));
    fireEvent.click(baseElement.querySelector('[role="presentation"]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
