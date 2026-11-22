/**
 * Testes do AiRadar (Radar Alfa do Dashboard) e, por ele, do ScanStatus
 * (contagem até a próxima varredura e ponto de frescor).
 *
 * Cobre: esqueleto, paywall sem acesso (só 3 cartões, mensagem oculta),
 * selo de atraso do ESSENTIAL, ordenação urgência → score, filtros por
 * classe, estado vazio, selos de RSI/Graham/perfil, navegação para o
 * deep-dive (clique e teclado) e para o histórico.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AiRadar } from './AiRadar';
import type { AiSignal, RadarMeta } from '../../hooks/useDashboardData';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));

const NOW = new Date('2026-11-20T15:00:00Z');

const signal = (over: Partial<AiSignal>): AiSignal => ({
  id: over.ticker ?? 'X', ticker: 'X', type: 'OPPORTUNITY', assetType: 'STOCK', message: 'msg', time: '14:55',
  impact: 'HIGH', source: 'ALGO', score: 70, urgencyLevel: 'MEDIUM', ...over,
});

const SIGNALS: AiSignal[] = [
  signal({ ticker: 'PETR4', score: 90, urgencyLevel: 'MEDIUM', message: 'RSI baixo: papel sobrevendido', signalType: 'RSI_OVERSOLD', value: 18.4 }),
  signal({ ticker: 'HGLG11', assetType: 'FII', score: 65, urgencyLevel: 'CRITICAL', riskProfile: 'DEFENSIVE' }),
  signal({ ticker: 'AAPL', assetType: 'STOCK_US', score: 50, urgencyLevel: 'HIGH', riskProfile: 'BOLD',
    signalType: 'DEEP_VALUE', value: 31.5 }),
  signal({ ticker: 'VALE3', score: 85, urgencyLevel: 'HIGH', riskProfile: 'MODERATE' }),
];

const META: RadarMeta = {
  lastScanAt: '2026-11-20T14:55:00Z', nextScanAt: '2026-11-20T15:10:05Z', assetsScanned: 412,
  assetsWithHistory: 400, activeSignalsTotal: 4, scanIntervalMinutes: 15,
};

const tickers = () => screen.getAllByRole('button').map((b) => b.querySelector('.font-black.text-sm')?.textContent).filter(Boolean);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AiRadar', () => {
  it('carregando mostra o esqueleto sem cartões', () => {
    render(<AiRadar signals={SIGNALS} isLoading />);
    expect(screen.getByText('Radar Alfa')).toBeInTheDocument();
    expect(screen.queryByText('PETR4')).not.toBeInTheDocument();
  });

  it('sem acesso mostra o paywall, 3 cartões e mensagem oculta', () => {
    render(<AiRadar signals={SIGNALS} access={{ tier: 'NONE', delayMinutes: null }} />);
    expect(screen.getByText('Scanner Quantitativo')).toBeInTheDocument();
    expect(screen.getAllByText('Sinal quantitativo oculto.')).toHaveLength(3);
    expect(screen.queryByText('VALE3')).not.toBeInTheDocument();
    expect(screen.getByText('aguardando varredura...')).toBeInTheDocument();

    fireEvent.click(screen.getByText('PETR4'));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Desbloquear Radar/ }));
    expect(navigate).toHaveBeenCalledWith('/pricing');
  });

  it('com acesso ordena por urgência e depois score, com selos e status do scan', async () => {
    const { container } = render(<AiRadar signals={SIGNALS} meta={META} access={{ tier: 'REALTIME', delayMinutes: null }} />);
    expect(tickers()).toEqual(['HGLG11', 'VALE3', 'AAPL', 'PETR4']);

    expect(screen.getByText('CRÍTICO')).toBeInTheDocument();
    expect(screen.getAllByText('ALTO')).toHaveLength(2);
    expect(screen.getByText('RSI 18')).toBeInTheDocument();
    expect(screen.getByText('Graham R$31.50')).toBeInTheDocument();
    expect(screen.getByText('Defensivo')).toBeInTheDocument();
    expect(screen.getByText('Arrojado')).toBeInTheDocument();
    expect(screen.getByText('RSI baixo:')).toHaveClass('font-extrabold');
    expect(screen.getByText('90')).toHaveClass('text-emerald-400');
    expect(screen.getByText('65')).toHaveClass('text-yellow-400');
    expect(screen.getByText('50')).toHaveClass('text-red-400');

    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText(/última há 5 min/)).toBeInTheDocument();
    expect(screen.getByText('10:05')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('filtros por classe restringem os cartões e o vazio mostra a próxima varredura', () => {
    render(<AiRadar signals={SIGNALS} meta={META} access={{ tier: 'REALTIME', delayMinutes: null }} />);
    fireEvent.click(screen.getByRole('button', { name: 'FII' }));
    expect(tickers()).toEqual(['HGLG11']);
    fireEvent.click(screen.getByRole('button', { name: 'EXT' }));
    expect(tickers()).toEqual(['AAPL']);
    fireEvent.click(screen.getByRole('button', { name: 'BR' }));
    expect(tickers()).toEqual(['VALE3', 'PETR4']);
    fireEvent.click(screen.getByRole('button', { name: 'TUDO' }));
    expect(tickers()).toHaveLength(4);
  });

  it('sem sinais mostra o vazio; varredura vencida mostra "atualizando..."', () => {
    const meta = { ...META, lastScanAt: NOW.toISOString(), nextScanAt: '2026-11-20T14:00:00Z' };
    render(<AiRadar signals={[]} meta={meta} access={{ tier: 'REALTIME', delayMinutes: null }} />);
    expect(screen.getByText('Nenhuma anomalia GOLD detectada no momento.')).toBeInTheDocument();
    expect(screen.getAllByText('atualizando...')).toHaveLength(2);
    expect(screen.getByText(/última agora/)).toBeInTheDocument();
  });

  it('ESSENTIAL mostra o selo de atraso', () => {
    render(<AiRadar signals={SIGNALS} access={{ tier: 'DELAYED', delayMinutes: 60 }} />);
    expect(screen.getByText(/Atraso 60min/)).toHaveAttribute('title', expect.stringContaining('atraso de 60 minutos'));
  });

  it('clique e Enter no cartão abrem o deep-dive; rodapé abre o histórico', () => {
    render(<AiRadar signals={SIGNALS} access={{ tier: 'REALTIME', delayMinutes: null }} />);
    fireEvent.click(screen.getByText('VALE3'));
    expect(navigate).toHaveBeenCalledWith('/research', { state: { openTicker: 'VALE3' } });

    const card = screen.getByText('AAPL').closest('[role="button"]') as HTMLElement;
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/research', { state: { openTicker: 'AAPL' } });

    fireEvent.click(screen.getByRole('button', { name: /Histórico & Performance/ }));
    expect(navigate).toHaveBeenCalledWith('/radar');
  });
});
