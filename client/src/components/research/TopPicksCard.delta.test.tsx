/**
 * Regra #2 (ordenação soberana com desempate estrutural, sem mutar o cache) e
 * Regra #4 (seta de delta de posição vs. o último ranking publicado).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopPicksCard } from './TopPicksCard';
import { sortPicksByScore, getPositionDelta } from './topPicksView';
import type { RankingItem } from '../../services/research';

vi.mock('../../contexts/WalletContext', () => ({
  useWallet: () => ({ assets: [], kpis: { totalEquity: 0 }, isPrivacyMode: false }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));

const mkPick = (ticker: string, score: number, composite: number, extra: Partial<RankingItem> = {}): RankingItem => ({
  position: 1,
  ticker,
  name: ticker,
  sector: 'Tech',
  type: 'STOCK',
  action: score >= 70 ? 'BUY' : 'WAIT',
  currentPrice: 10,
  targetPrice: 12,
  score,
  probability: 0,
  riskProfile: 'DEFENSIVE',
  thesis: '',
  reason: '',
  metrics: { dy: 0, structural: { quality: composite, valuation: composite, risk: composite } } as any,
  ...extra,
});

describe('sortPicksByScore', () => {
  it('ordena por score e desempata pelo composite estrutural', () => {
    const picks = [mkPick('LOW', 60, 90), mkPick('TIE_A', 75, 40), mkPick('TIE_B', 75, 80)];
    expect(sortPicksByScore(picks).map(p => p.ticker)).toEqual(['TIE_B', 'TIE_A', 'LOW']);
  });

  it('não reordena o array recebido (cache do React Query)', () => {
    const picks = [mkPick('A', 50, 50), mkPick('B', 90, 50)];
    const snapshot = picks.map(p => p.ticker);
    sortPicksByScore(picks);
    expect(picks.map(p => p.ticker)).toEqual(snapshot);
  });

  it('o render também não muta o array de picks', () => {
    const picks = [mkPick('A', 50, 50), mkPick('B', 90, 50)];
    render(<TopPicksCard picks={picks} assetClass="STOCK" />);
    expect(picks.map(p => p.ticker)).toEqual(['A', 'B']);
  });
});

describe('getPositionDelta', () => {
  it('subiu / caiu / manteve / novo / sem campo', () => {
    expect(getPositionDelta(3, 7)).toEqual({ kind: 'up', steps: 4 });
    expect(getPositionDelta(7, 3)).toEqual({ kind: 'down', steps: 4 });
    expect(getPositionDelta(5, 5)).toEqual({ kind: 'same' });
    expect(getPositionDelta(5, null)).toEqual({ kind: 'new' });
    expect(getPositionDelta(5, undefined)).toBeNull();
  });
});

describe('TopPicksCard — badge de delta', () => {
  it('renderiza subida, queda e "novo" pela posição GLOBAL', () => {
    const picks = [
      mkPick('UP3', 90, 50, { position: 2, previousPosition: 6 }),
      mkPick('DOWN3', 85, 50, { position: 5, previousPosition: 1 }),
      mkPick('NEW3', 80, 50, { position: 8, previousPosition: null }),
      mkPick('SAME3', 78, 50, { position: 9, previousPosition: 9 }),
    ];
    render(<TopPicksCard picks={picks} assetClass="STOCK" />);
    expect(screen.getByLabelText('Subiu 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Caiu 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Posição mantida')).toBeInTheDocument();
    expect(screen.getByText('novo')).toBeInTheDocument();
  });
});
