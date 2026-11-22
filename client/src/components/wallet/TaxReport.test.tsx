import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { TaxReport } from './TaxReport';
import { walletService } from '../../services/wallet';

// Relógio fixo (novembro de 2026: o ano-base pedido é 2025, o mesmo da fixture, em qualquer ano em que o teste rode).
const AGORA = new Date('2026-11-18T14:00:00-03:00');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AGORA); });
afterEach(() => { vi.useRealTimers(); });

const wallet = { privacy: false };
vi.mock('../../contexts/WalletContext', () => ({ useWallet: () => ({ isPrivacyMode: wallet.privacy }) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: () => ({ isDemoMode: false }) }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../../services/wallet', () => ({
    walletService: { getTaxReport: vi.fn(), downloadTaxReportPdf: vi.fn() },
}));

const report = {
    year: 2025,
    positionsByGroup: [{
        groupLabel: 'Ações', grupo: '03', exterior: false, totalCost: 3050,
        items: [{ ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL', quantity: 100, avgPrice: 30.5, totalCost: 3050, grupo: '03', codigo: '01', groupLabel: 'Ações', manualReview: false }],
    }],
    monthly: [{ month: '03', category: 'ACOES', sales: 40000, gain: 2000, exempt: false, compensatedLoss: 0, taxableBase: 2000, taxRate: 0.15, tax: 300, lossCarryAfter: 0 }],
    darf: [{ month: '03', competencia: '2025-03', code: '6015', dueDate: '2025-04-30', amount: 300, breakdown: [] }],
    darfCarryToNextYear: 0,
    dividends: { total: 812.34, byTicker: [{ ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', amount: 812.34 }] },
    lossCarryEndOfYear: { ACOES: 0, FII: 0, ETF: 0 },
    manualReviewItems: [],
    summary: { totalDarf: 300, totalDividends: 812.34, totalPositionCostBRL: 3050, positionsCount: 1 },
    disclaimers: [],
};

const renderReport = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaxReport />
    </QueryClientProvider>
);

beforeEach(() => {
    vi.clearAllMocks();
    wallet.privacy = false;
    vi.mocked(walletService.getTaxReport).mockResolvedValue(report);
});

describe('TaxReport', () => {
    it('busca o ano-base anterior e mostra DARF, proventos e custo', async () => {
        renderReport();
        expect(await screen.findByText('Bens e Direitos — Posição em 31/12')).toBeInTheDocument();
        expect(walletService.getTaxReport).toHaveBeenCalledWith(AGORA.getFullYear() - 1);
        expect(screen.getAllByText('R$ 812,34').length).toBeGreaterThan(0);
        expect(screen.getAllByText('R$ 300,00').length).toBeGreaterThan(0);
        expect(screen.getByText('R$ 30,50')).toBeInTheDocument();
    });

    it('modo privacidade mascara DARF, proventos, custo, preço médio e quantidade', async () => {
        wallet.privacy = true;
        renderReport();
        await screen.findByText('Bens e Direitos — Posição em 31/12');
        expect(screen.queryByText(/812,34/)).not.toBeInTheDocument();
        expect(screen.queryByText(/300,00/)).not.toBeInTheDocument();
        expect(screen.queryByText(/3\.050/)).not.toBeInTheDocument();
        expect(screen.queryByText(/30,50/)).not.toBeInTheDocument();
        expect(screen.queryByText('100')).not.toBeInTheDocument();
        expect(screen.getAllByText('••••••').length).toBeGreaterThan(5);
    });
});
