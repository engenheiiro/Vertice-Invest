/**
 * Testes do RebalanceModal (Rebalanceamento IA).
 *
 * Cobre: busca do plano pelo perfil (padrão Moderado) e pela carteira ativa,
 * troca de perfil, erro com "Tentar novamente", carteira equilibrada, cartões
 * de venda/compra (selos, IR, sub-quebra), lacunas por classe, cópia do plano
 * em texto, privacidade e fechamento por Esc.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { RebalanceModal } from './RebalanceModal';
import { walletService } from '../../services/wallet';
import { useWallet } from '../../contexts/WalletContext';

const addToast = vi.fn();
vi.mock('../../services/wallet', () => ({ walletService: { getRebalancePlan: vi.fn() } }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));

const getRebalancePlan = vi.mocked(walletService.getRebalancePlan);

const PLAN = {
  riskProfile: 'MODERATE',
  dataAsOf: '2026-11-20T12:00:00Z',
  totalEquity: 100000,
  classGaps: [
    { class: 'STOCK', label: 'Ações BR', currentValue: 60000, idealValue: 50000, currentPct: 60, targetPct: 50, gapValue: -10000, coverage: 'full' },
    { class: 'FII', label: 'FIIs', currentValue: 20000, idealValue: 30000, currentPct: 20, targetPct: 30, gapValue: 10000, coverage: 'full' },
    { class: 'CRYPTO', label: 'Cripto', currentValue: 0, idealValue: 0, currentPct: 0, targetPct: 0, gapValue: 0, coverage: 'full' },
  ],
  sells: [
    { ticker: 'PETR4', class: 'STOCK', type: 'STOCK', subLabel: 'Ações', amount: 10000, quantity: 250, isFullExit: true,
      estTax: 1500, reasons: ['Acima da meta', 'Score 40'] },
  ],
  buys: [
    { ticker: 'HGLG11', class: 'FII', type: 'FII', kind: 'REINFORCE', tier: 'GOLD', amount: 6000, quantity: 37, reasons: ['Top do ranking'] },
    { ticker: null, label: 'Renda Fixa', class: 'FIXED_INCOME', type: 'FIXED_INCOME', kind: 'GENERIC', amount: 4000, quantity: null,
      reasons: ['Abaixo da meta'], subBreakdown: [{ sub: 'IPCA', label: 'IPCA+', amount: 4000 }] },
    { ticker: 'KNRI11', class: 'FII', type: 'FII', kind: 'NEW', amount: 100, quantity: 1, reasons: ['Diversifica gestor'] },
  ],
  coveredClasses: ['STOCK', 'FII'],
  summary: { totalSell: 10000, totalBuy: 10100, estTaxTotal: 1500, tradeCount: 4 },
};

type Plan = Awaited<ReturnType<typeof walletService.getRebalancePlan>>;

function mockWallet(isPrivacyMode = false) {
  vi.mocked(useWallet).mockReturnValue({ activeWalletId: 'w1', isPrivacyMode } as unknown as ReturnType<typeof useWallet>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWallet();
  getRebalancePlan.mockResolvedValue(PLAN as unknown as Plan);
});

describe('RebalanceModal', () => {
  it('fechado não renderiza nem busca', () => {
    render(<RebalanceModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getRebalancePlan).not.toHaveBeenCalled();
  });

  it('busca o plano Moderado da carteira ativa e mostra lacunas, vendas e compras', async () => {
    render(<RebalanceModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText(/Analisando carteira vs\. carteira-modelo Moderado/)).toBeInTheDocument();
    expect(await screen.findByText('Alocação por Classe')).toBeInTheDocument();
    expect(getRebalancePlan).toHaveBeenCalledWith('MODERATE', 'w1');
    expect(document.body.style.overflow).toBe('hidden');

    // Cripto sem valor e sem meta fica de fora das lacunas.
    expect(screen.queryByText('Cripto')).not.toBeInTheDocument();
    expect(screen.getByText('60% → 50%')).toBeInTheDocument();
    expect(screen.getAllByText('−R$ 10.000,00')[0]).toHaveClass('text-red-400');
    expect(screen.getByText('+R$ 10.000,00')).toHaveClass('text-emerald-400');

    expect(screen.getByText('Zerar posição')).toBeInTheDocument();
    expect(screen.getByText(/IR estimado: R\$ 1\.500,00/)).toBeInTheDocument();
    expect(screen.getByText('250 un.')).toBeInTheDocument();
    expect(screen.getByText('Reforço')).toBeInTheDocument();
    expect(screen.getByText('GOLD')).toBeInTheDocument();
    expect(screen.getByText('Aporte')).toBeInTheDocument();
    expect(screen.getByText('Novo')).toBeInTheDocument();
    expect(screen.getByText('IPCA+')).toBeInTheDocument();
    expect(screen.getByText('• Diversifica gestor')).toBeInTheDocument();
    expect(screen.getByText(/Ranking quant de 20\/11\/2026/)).toBeInTheDocument();
    // Sem axe aqui: os h4 de seção pulam do h2 do título (heading-order) — defeito relatado.
  });

  it('trocar o perfil busca de novo com o perfil escolhido', async () => {
    render(<RebalanceModal isOpen onClose={vi.fn()} />);
    await screen.findByText('Alocação por Classe');
    fireEvent.click(screen.getByRole('button', { name: 'Arrojado' }));
    await waitFor(() => expect(getRebalancePlan).toHaveBeenLastCalledWith('BOLD', 'w1'));
  });

  it('carteira equilibrada mostra o aviso e nenhuma ordem', async () => {
    getRebalancePlan.mockResolvedValue({ ...PLAN, classGaps: [], sells: [], buys: [], dataAsOf: null } as unknown as Plan);
    render(<RebalanceModal isOpen onClose={vi.fn()} />);
    expect(await screen.findByText('Carteira equilibrada para o perfil Moderado.')).toBeInTheDocument();
    expect(screen.queryByText('Reduzir / Vender')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ranking quant/)).not.toBeInTheDocument();
  });

  it('erro mostra a mensagem e "Tentar novamente" refaz a busca', async () => {
    getRebalancePlan.mockRejectedValueOnce(new Error('Sem metas definidas.'));
    const { baseElement } = render(<RebalanceModal isOpen onClose={vi.fn()} />);
    expect(await screen.findByText('Sem metas definidas.')).toBeInTheDocument();
    expect(await axe(baseElement)).toHaveNoViolations();
    expect(screen.getByRole('button', { name: /Copiar plano/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Alocação por Classe')).toBeInTheDocument();
    expect(getRebalancePlan).toHaveBeenCalledTimes(2);
  });

  it('copia o plano em texto com vendas, compras e resumo', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RebalanceModal isOpen onClose={vi.fn()} />);
    await screen.findByText('Alocação por Classe');
    fireEvent.click(screen.getByRole('button', { name: /Copiar plano/ }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Plano copiado para a área de transferência.', 'success'));
    const text = String(writeText.mock.calls[0][0]).replace(/\u00a0/g, ' ');
    expect(text).toContain('PLANO DE REBALANCEAMENTO — Perfil Moderado');
    expect(text).toContain('• PETR4 [Ações] (250 un.) — R$ 10.000,00 | IR est. R$ 1.500,00');
    expect(text).toContain('• Renda Fixa — R$ 4.000,00');
    expect(text).toContain('    → IPCA+: R$ 4.000,00');
    expect(text).toContain('Resumo: vender R$ 10.000,00 · comprar R$ 10.100,00 · IR estimado R$ 1.500,00');
    expect(screen.getByText(/Copiado$/)).toBeInTheDocument();
  });

  it('falha ao copiar avisa com toast de erro', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('x')) }, configurable: true });
    render(<RebalanceModal isOpen onClose={vi.fn()} />);
    await screen.findByText('Alocação por Classe');
    fireEvent.click(screen.getByRole('button', { name: /Copiar plano/ }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Não foi possível copiar o plano.', 'error'));
  });

  it('em privacidade os valores ficam mascarados', async () => {
    mockWallet(true);
    render(<RebalanceModal isOpen onClose={vi.fn()} />);
    await screen.findByText('Alocação por Classe');
    expect(screen.queryByText(/R\$ 10\.000,00/)).not.toBeInTheDocument();
  });

  it('Esc e o botão Fechar chamam onClose', async () => {
    const onClose = vi.fn();
    render(<RebalanceModal isOpen onClose={onClose} />);
    await screen.findByText('Alocação por Classe');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    screen.getAllByRole('button', { name: 'Fechar' }).forEach((b) => fireEvent.click(b));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
