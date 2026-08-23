/**
 * Achado 3 — a permanência precisa APARECER na linha do ativo.
 *
 * O rastro (`item.retention`) já vinha do backend e já sobrevivia ao Mongoose,
 * mas nada o renderizava: o assinante via um AGUARDAR no MEIO do ranking, acima
 * de ativos em COMPRAR, sem nada dizendo que aquele ativo está ali por
 * continuidade. Só as SAÍDAS apareciam (via ExitList); a permanência, não.
 *
 * O selo NÃO fala de ação — COMPRAR/AGUARDAR continua derivado só do score.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopPicksCard } from './TopPicksCard';
import type { RankingItem } from '../../services/research';

vi.mock('../../contexts/WalletContext', () => ({
  useWallet: () => ({ assets: [], kpis: { totalEquity: 0 }, isPrivacyMode: false }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));

const pick = (over: Partial<RankingItem>): RankingItem => ({
  position: 1,
  ticker: 'COGN3',
  name: 'Cogna',
  sector: 'Educação',
  type: 'STOCK',
  score: 67,
  action: 'WAIT',
  riskProfile: 'DEFENSIVE',
  tier: 'GOLD',
  currentPrice: 2.5,
  targetPrice: 3.1,
  thesis: '',
  reason: '',
  metrics: { dy: 1.2, structural: { quality: 60, valuation: 55, risk: 50 } },
  ...over,
} as unknown as RankingItem);

const retention = {
  retained: true,
  holdScore: 62,
  previousPosition: 7,
  previousScore: 73,
  previousProfile: 'DEFENSIVE' as const,
  displaced: null,
  reason: 'Na lista desde a apuração anterior: score 67 segue acima do mínimo para manter a vaga (62)',
};

describe('TopPicksCard — marcador de permanência', () => {
  it('item retido carrega o selo, com o motivo legível no tooltip', () => {
    render(<TopPicksCard picks={[pick({ retention })]} assetClass="STOCK" />);
    const selo = screen.getByText('Já estava');
    expect(selo).toBeInTheDocument();
    expect(selo.getAttribute('title')).toContain('Na lista desde a apuração anterior');
    expect(selo.getAttribute('title')).toContain('era 73 na posição 7');
  });

  it('o selo não substitui o semáforo: um retido abaixo de 70 segue AGUARDAR', () => {
    render(<TopPicksCard picks={[pick({ retention })]} assetClass="STOCK" />);
    expect(screen.getByText('AGUARDAR')).toBeInTheDocument();
    expect(screen.queryByText('COMPRAR')).not.toBeInTheDocument();
  });

  it('item que entrou pelo draft normal não ganha selo nenhum', () => {
    render(<TopPicksCard picks={[pick({ ticker: 'ITUB4', score: 84, action: 'BUY' })]} assetClass="STOCK" />);
    expect(screen.queryByText('Já estava')).not.toBeInTheDocument();
  });

  it('relatório antigo, sem o campo, não quebra a lista', () => {
    render(<TopPicksCard picks={[pick({ retention: undefined })]} assetClass="STOCK" />);
    expect(screen.getByText('COGN3')).toBeInTheDocument();
  });
});
