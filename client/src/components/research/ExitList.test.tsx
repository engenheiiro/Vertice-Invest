/**
 * "Saíram da lista" no ranking semanal — o outro lado da retenção de assento.
 *
 * A lista passou a manter quem já estava; a contrapartida é que quem sai
 * precisa sair explicado. Estes testes usam os motivos reais que o backend
 * produz (`describeRetentionExit` em server/utils/weeklyRetention.js).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResearchViewer } from './ResearchViewer';
import { ExitList } from './ExitList';
import type { ResearchReport, RetentionExit } from '../../services/research';

vi.mock('../../contexts/WalletContext', () => ({
  useWallet: () => ({ assets: [], kpis: { totalEquity: 0 }, isPrivacyMode: false }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));

const exits: RetentionExit[] = [
  {
    ticker: 'PINE4',
    name: 'Banco Pine',
    reason: 'Saiu da lista: score caiu para 60, abaixo do piso de permanência (62)',
    outcome: 'BELOW_HOLD',
    score: 60,
    previousScore: 74,
  },
  {
    ticker: 'SUMIU3',
    name: null,
    reason: 'Saiu da lista: não apareceu entre os ativos avaliados nesta apuração',
    outcome: 'LEFT_UNIVERSE',
    score: null,
    previousScore: 80,
  },
];

const report = (retentionExits?: RetentionExit[]): ResearchReport => ({
  _id: 'a1',
  date: '2026-08-23T00:00:00.000Z',
  assetClass: 'STOCK',
  strategy: 'BUY_HOLD',
  isRankingPublished: true,
  isMorningCallPublished: false,
  retentionExits,
  content: { morningCall: '', ranking: [] },
});

describe('ExitList', () => {
  it('mostra o motivo escrito de cada saída, com o score de antes e de agora', () => {
    render(<ExitList exits={exits} />);
    expect(screen.getByText('PINE4')).toBeInTheDocument();
    expect(screen.getByText(/score caiu para 60, abaixo do piso de permanência \(62\)/)).toBeInTheDocument();
    expect(screen.getByText('74 → 60')).toBeInTheDocument();
  });

  it('quem sumiu do universo não inventa score novo', () => {
    render(<ExitList exits={exits} />);
    expect(screen.getByText('80 → fora do universo')).toBeInTheDocument();
  });

  it('só mostra o selo "não aparece mais no ranking" quando a estratégia o informa', () => {
    // Semanal não manda `stillListed` — quem sai da retenção sai da lista inteira,
    // e repetir o selo em toda linha seria ruído.
    const { rerender } = render(<ExitList exits={exits} />);
    expect(screen.queryByText('não aparece mais no ranking')).not.toBeInTheDocument();

    // Âncora manda: lá um ativo pode perder o COMPRAR e seguir no ranking.
    rerender(<ExitList exits={[{ ...exits[0], stillListed: false }]} />);
    expect(screen.getByText('não aparece mais no ranking')).toBeInTheDocument();
  });
});

describe('ResearchViewer — ranking com retenção de assento', () => {
  it('renderiza a seção de saídas abaixo do ranking', () => {
    render(<ResearchViewer report={report(exits)} view="RANKING" />);
    expect(screen.getByText('Saíram da lista nesta apuração')).toBeInTheDocument();
    expect(screen.getByText('PINE4')).toBeInTheDocument();
  });

  it('sem saídas, a seção não aparece (nem como cabeçalho vazio)', () => {
    render(<ResearchViewer report={report([])} view="RANKING" />);
    expect(screen.queryByText('Saíram da lista nesta apuração')).not.toBeInTheDocument();
  });

  it('relatório antigo, sem o campo, não quebra a página', () => {
    render(<ResearchViewer report={report(undefined)} view="RANKING" />);
    expect(screen.queryByText('Saíram da lista nesta apuração')).not.toBeInTheDocument();
  });
});
