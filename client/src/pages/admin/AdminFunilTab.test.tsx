import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

import { AdminFunilTab } from './AdminFunilTab';
import type { FunnelReport } from '../../services/funnel';

/**
 * Aba "Funil" do Admin.
 *
 * O que estes testes protegem não é o layout: é a honestidade dos números.
 * Uma coorte que ainda não fechou 30 dias mostrada como se tivesse fechado, ou
 * um churn de 33% calculado sobre três vencimentos, levam a mexer no preço pelo
 * motivo errado — e nada disso quebra um tipo.
 */

const mocks = vi.hoisted(() => ({ getFunnel: vi.fn(), addToast: vi.fn() }));

vi.mock('../../services/funnel', () => ({ funnelService: { getFunnel: mocks.getFunnel } }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));

const relatorio = (override: Partial<FunnelReport> = {}): FunnelReport => ({
    generatedAt: '2026-08-30T12:00:00.000Z',
    windowMonths: 12,
    conversionWindowDays: 30,
    cohorts: [
        { monthKey: '2026-06', signups: 40, activated: 20, paid30d: 2, paidEver: 3, activationRate: 0.5, conversionRate: 0.05, matureFor30d: true },
        { monthKey: '2026-08', signups: 10, activated: 1, paid30d: 0, paidEver: 0, activationRate: 0.1, conversionRate: 0, matureFor30d: false },
    ],
    averages: { cohorts: 1, signups: 40, activationRate: 0.5, conversionRate: 0.05 },
    acquisition: [
        { source: 'youtube', signups: 30, activated: 15, paid: 2, activationRate: 0.5, conversionRate: 0.066 },
        { source: 'direto', signups: 20, activated: 6, paid: 0, activationRate: 0.3, conversionRate: 0 },
    ],
    revenue: { subscribers: 3, mrr: 189.7, arpu: 63.23, byPlan: { PRO: { subscribers: 2, mrr: 119.8 }, ESSENTIAL: { subscribers: 1, mrr: 69.9 } } },
    retention: { activeNow: 3, dueInWindow: 12, renewed: 10, lost: 2, churnRate: 0.1667, significant: true },
    totals: { signupsInWindow: 50, adminsInWindow: 1, allTimeSignups: 87 },
    ...override,
});

const linhaDoMes = async (texto: string) => {
    const celula = await screen.findByText(texto, { exact: false });
    return within(celula.closest('tr') as HTMLElement);
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFunnel.mockResolvedValue(relatorio());
});

/** O cartão de KPI, isolado das tabelas — que repetem as mesmas taxas. */
const kpi = async (label: string) => within(await screen.findByRole('group', { name: label }));

describe('Números do topo', () => {
    it('mostra cadastro, ativação, conversão e MRR', async () => {
        render(<AdminFunilTab />);

        expect((await kpi('Cadastros')).getByText('50')).toBeInTheDocument();
        expect((await kpi('Ativação')).getByText('50,0%')).toBeInTheDocument();
        expect((await kpi('Conversão 30d')).getByText('5,0%')).toBeInTheDocument();
        expect((await kpi('MRR')).getByText(/189,70/)).toBeInTheDocument();
    });

    it('abre nos últimos 12 meses', async () => {
        render(<AdminFunilTab />);

        await waitFor(() => expect(mocks.getFunnel).toHaveBeenCalledWith(12));
    });
});

describe('Coortes', () => {
    it('marca o mês que ainda está dentro da janela', async () => {
        // Sem a marca, agosto (0%) parece um colapso da conversão ao lado de
        // junho (5%) — quando na verdade nem teve tempo de converter.
        render(<AdminFunilTab />);

        const agosto = await linhaDoMes('ago/2026');
        expect(agosto.getByText(/em curso/i)).toBeInTheDocument();

        const junho = await linhaDoMes('jun/2026');
        expect(junho.queryByText(/em curso/i)).not.toBeInTheDocument();
    });

    it('avisa quando nenhuma coorte fechou a janela', async () => {
        mocks.getFunnel.mockResolvedValue(relatorio({
            averages: { cohorts: 0, signups: 0, activationRate: null, conversionRate: null },
        }));
        render(<AdminFunilTab />);

        expect(await screen.findByText(/não servem para decidir preço/i)).toBeInTheDocument();
    });

    it('mostra "—" onde não há base, não 0%', async () => {
        // "Ninguém se cadastrou" e "ninguém converteu" pedem ações opostas.
        mocks.getFunnel.mockResolvedValue(relatorio({
            averages: { cohorts: 0, signups: 0, activationRate: null, conversionRate: null },
        }));
        render(<AdminFunilTab />);

        expect(await screen.findAllByText('—')).not.toHaveLength(0);
    });
});

describe('Retenção', () => {
    it('avisa quando a base de churn é pequena demais', async () => {
        mocks.getFunnel.mockResolvedValue(relatorio({
            retention: { activeNow: 3, dueInWindow: 3, renewed: 2, lost: 1, churnRate: 0.3333, significant: false },
        }));
        render(<AdminFunilTab />);

        expect(await screen.findByText(/base pequena demais/i)).toBeInTheDocument();
    });

    it('não avisa quando a base já sustenta o número', async () => {
        render(<AdminFunilTab />);

        await screen.findByText('16,7%');
        expect(screen.queryByText(/base pequena demais/i)).not.toBeInTheDocument();
    });
});

describe('Origem', () => {
    it('lista os canais com a conversão de cada um', async () => {
        render(<AdminFunilTab />);

        const youtube = await linhaDoMes('youtube');
        expect(youtube.getByText('30')).toBeInTheDocument();
        expect(await screen.findByText('direto')).toBeInTheDocument();
    });
});

describe('Falha', () => {
    it('avisa em vez de mostrar painel vazio como se fosse zero', async () => {
        mocks.getFunnel.mockRejectedValue(new Error('sem banco'));
        render(<AdminFunilTab />);

        await waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith(expect.stringMatching(/sem banco|funil/i), 'error'));
        expect(screen.queryByText('MRR')).not.toBeInTheDocument();
    });
});
