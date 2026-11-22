/**
 * Testes do TreasuryPanel (Pesquisa → Renda Fixa · Tesouro Direto).
 *
 * Cobre: carregando, erro/resposta nula com "Recarregar", vitrine sem títulos,
 * agrupamento por família na ordem fixa (vencimento crescente dentro do grupo),
 * filtro por família e a formatação pt-BR de taxa, real e diferença vs CDI.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { TreasuryPanel } from './TreasuryPanel';
import { researchService, TreasuryBondItem, FixedIncomeResponse } from '../../services/research';

vi.mock('../../services/research', () => ({ researchService: { getFixedIncomeData: vi.fn() } }));
const getData = vi.mocked(researchService.getFixedIncomeData);

const bond = (over: Partial<TreasuryBondItem>): TreasuryBondItem => ({
  title: 'T', type: 'IPCA', index: 'IPCA', rate: 6, maturityDate: '2035-05-15', minInvestment: 0, unitPrice: 1000,
  nominalEstimate: 10, realEstimate: 6, vsCdi: 1, ...over,
});

const DATA: FixedIncomeResponse = {
  macro: { ipca: 4.5, selic: 15, cdi: 14.9 },
  bonds: [
    bond({ title: 'Tesouro IPCA+ 2045', maturityDate: '2045-05-15', rate: 6.85, minInvestment: 35.5 }),
    bond({ title: 'Tesouro IPCA+ 2029', maturityDate: '2029-05-15', realEstimate: -0.5, vsCdi: -1.25 }),
    bond({ title: 'Tesouro Selic 2031', type: 'SELIC', maturityDate: null, vsCdi: null }),
    bond({ title: 'Tesouro Prefixado 2032', type: 'PREFIXADO', rate: 13.1 }),
    bond({ title: 'Tesouro Renda+ 2065', type: 'RENDAMAIS' }),
  ],
} as FixedIncomeResponse;

const renderPanel = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TreasuryPanel /></QueryClientProvider>);
};

const titles = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TreasuryPanel', () => {
  it('agrupa por família na ordem fixa e formata taxas', async () => {
    getData.mockResolvedValue(DATA);
    const { container } = renderPanel();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await screen.findByText('Renda Fixa · Tesouro Direto');

    expect(titles()).toEqual([
      'Tesouro IPCA+', 'Tesouro IPCA+ 2029', 'Tesouro IPCA+ 2045',
      'Tesouro Renda+', 'Tesouro Renda+ 2065',
      'Tesouro Selic', 'Tesouro Selic 2031',
      'Tesouro Prefixado', 'Tesouro Prefixado 2032',
    ]);
    expect(screen.getByText('4,50%')).toBeInTheDocument();
    expect(screen.getByText('6,85%')).toBeInTheDocument();
    expect(screen.getByText(/Mín\. R\$ 35,50/)).toBeInTheDocument();
    expect(screen.getByText('-0,50%')).toHaveClass('text-red-400');
    expect(screen.getByText('-1,25 pp')).toHaveClass('text-yellow-400');
    expect(screen.getAllByText('+1,00 pp')[0]).toHaveClass('text-emerald-400');
    expect(screen.getByText('-')).toHaveClass('text-slate-500');
    expect(screen.getByText(/Vence em —/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('filtro mostra só a família escolhida', async () => {
    getData.mockResolvedValue(DATA);
    renderPanel();
    await screen.findByText('Renda Fixa · Tesouro Direto');
    fireEvent.click(screen.getByRole('button', { name: 'Tesouro Selic' }));
    expect(titles()).toEqual(['Tesouro Selic', 'Tesouro Selic 2031']);
    fireEvent.click(screen.getByRole('button', { name: 'Tesouro Educa+' }));
    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    expect(titles()).toHaveLength(9);
  });

  it('sem títulos mostra o aviso de sincronização', async () => {
    getData.mockResolvedValue({ ...DATA, bonds: [] });
    renderPanel();
    expect(await screen.findByText('Sem títulos cadastrados')).toBeInTheDocument();
  });

  it('resposta nula mostra indisponível e "Recarregar" busca de novo', async () => {
    getData.mockResolvedValueOnce(null).mockResolvedValueOnce(DATA);
    renderPanel();
    expect(await screen.findByText('Renda Fixa indisponível')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Recarregar/ }));
    expect(await screen.findByText('Renda Fixa · Tesouro Direto')).toBeInTheDocument();
    expect(getData).toHaveBeenCalledTimes(2);
  });

  it('botão Atualizar refaz a busca', async () => {
    getData.mockResolvedValue(DATA);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Atualizar Renda Fixa' }));
    await waitFor(() => expect(getData).toHaveBeenCalledTimes(2));
  });
});
