/**
 * (7.11) Integração do motor de IR — taxReportService.computeReport.
 * Mocka apenas os models (fonte de dados) e a identidade de dedupe de proventos;
 * a matemática fiscal, o agrupamento de Bens e Direitos e a reconstrução de
 * proventos rodam de verdade.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/AssetTransaction.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../services/financialService.js', () => ({
    financialService: {
        // Identidade canônica simplificada (ticker|YYYY-MM-DD|type) — suficiente
        // para exercitar o dedupe no teste.
        dividendIdentity: (t, d, ty = 'DIVIDEND') =>
            `${String(t).toUpperCase()}|${new Date(d).toISOString().slice(0, 10)}|${ty || 'DIVIDEND'}`,
    },
}));

const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const DividendEvent = (await import('../models/DividendEvent.js')).default;
const { taxReportService } = await import('../services/taxReportService.js');

const d = (iso) => new Date(`${iso}T12:00:00Z`);
const mockTxs = (txs) => AssetTransaction.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(txs) }) });
const mockAssets = (assets) => UserAsset.find.mockReturnValue({ lean: () => Promise.resolve(assets) });
const mockDividends = (evs) => DividendEvent.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(evs) }) });

beforeEach(() => vi.clearAllMocks());

describe('taxReportService.computeReport — cenário completo', () => {
    const USER_ASSETS = [
        { ticker: 'PETR4', type: 'STOCK', currency: 'BRL', name: 'Petrobras PN' },
        { ticker: 'HGLG11', type: 'FII', currency: 'BRL', name: 'CSHG Logística' },
        { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', name: 'Apple Inc' },
    ];
    const TXS = [
        { ticker: 'PETR4', type: 'BUY', quantity: 2000, price: 30, date: d('2025-01-05') }, // custo 60000
        { ticker: 'PETR4', type: 'SELL', quantity: 1000, price: 60, date: d('2025-03-10') }, // vendas 60000, ganho 30000 → 4500
        { ticker: 'HGLG11', type: 'BUY', quantity: 100, price: 100, date: d('2025-02-01') },
        { ticker: 'HGLG11', type: 'SELL', quantity: 50, price: 300, date: d('2025-05-10') }, // vendas 15000, ganho 10000 → 2000
        { ticker: 'AAPL', type: 'BUY', quantity: 10, price: 150, date: d('2025-04-01') },
        { ticker: 'AAPL', type: 'SELL', quantity: 5, price: 200, date: d('2025-08-01') }, // exterior: ganho 250
    ];
    const EVENTS = [
        { ticker: 'PETR4', type: 'DIVIDEND', amount: 2, date: d('2025-06-02'), paymentDate: d('2025-06-20') }, // 1000 cotas → 2000
        { ticker: 'PETR4', type: 'DIVIDEND', amount: 2, date: d('2025-06-02'), paymentDate: d('2025-06-20') }, // duplicata → ignorada
        { ticker: 'HGLG11', type: 'DIVIDEND', amount: 1.1, date: d('2025-07-31'), paymentDate: d('2025-08-08') }, // 50 cotas → 55
        { ticker: 'PETR4', type: 'DIVIDEND', amount: 5, date: d('2024-06-02'), paymentDate: d('2024-06-20') }, // ano anterior → fora
    ];

    it('reconstrói posição, DARF, proventos e conferência manual', async () => {
        mockTxs(TXS); mockAssets(USER_ASSETS); mockDividends(EVENTS);
        const r = await taxReportService.computeReport('user1', 2025);

        // Posição em 31/12 (residual, preço médio).
        const pos = Object.fromEntries(r.positions.map(p => [p.ticker, p]));
        expect(pos.PETR4.quantity).toBeCloseTo(1000, 6);
        expect(pos.PETR4.avgPrice).toBeCloseTo(30, 2);
        expect(pos.PETR4.totalCost).toBeCloseTo(30000, 2);
        expect(pos.HGLG11.totalCost).toBeCloseTo(5000, 2);
        expect(pos.AAPL.totalCost).toBeCloseTo(750, 2);
        expect(pos.AAPL.manualReview).toBe(true); // exterior

        // Bens e Direitos: 3 grupos (Ações, FII, Exterior).
        expect(r.positionsByGroup).toHaveLength(3);
        // Custo total declarável exclui exterior (AAPL).
        expect(r.summary.totalPositionCostBRL).toBeCloseTo(35000, 2);
        expect(r.summary.positionsCount).toBe(3);

        // DARF: março (4500) e maio (2000).
        expect(r.darf).toHaveLength(2);
        expect(r.summary.totalDarf).toBeCloseTo(6500, 2);
        const darfByMonth = Object.fromEntries(r.darf.map(x => [x.month, x.amount]));
        expect(darfByMonth['03']).toBeCloseTo(4500, 2);
        expect(darfByMonth['05']).toBeCloseTo(2000, 2);
        expect(r.summary.totalTaxByCategory.ACOES).toBeCloseTo(4500, 2);
        expect(r.summary.totalTaxByCategory.FII).toBeCloseTo(2000, 2);

        // Vencimentos: abril e junho de 2025.
        const marchDarf = r.darf.find(x => x.month === '03');
        expect(new Date(marchDarf.dueDate).getUTCMonth()).toBe(3); // abril

        // Proventos: PETR4 2000 (dedup aplicado) + HGLG11 55, ano anterior fora.
        expect(r.dividends.total).toBeCloseTo(2055, 2);
        const divByTicker = Object.fromEntries(r.dividends.byTicker.map(x => [x.ticker, x.amount]));
        expect(divByTicker.PETR4).toBeCloseTo(2000, 2);
        expect(divByTicker.HGLG11).toBeCloseTo(55, 2);
        // byTicker ordenado por valor desc.
        expect(r.dividends.byTicker[0].ticker).toBe('PETR4');

        // Conferência manual: exterior com ganho 250, vendas 1000.
        const ext = r.manualReviewItems.find(m => m.category === 'EXTERIOR');
        expect(ext.realizedGain).toBeCloseTo(250, 2);
        expect(ext.sales).toBeCloseTo(1000, 2);

        // Metadados fixos.
        expect(r.year).toBe(2025);
        expect(r.disclaimers.length).toBeGreaterThanOrEqual(5);
    });

    it('carteira vazia gera relatório coerente e zerado', async () => {
        mockTxs([]); mockAssets([]); mockDividends([]);
        const r = await taxReportService.computeReport('user1', 2025);
        expect(r.positions).toHaveLength(0);
        expect(r.positionsByGroup).toHaveLength(0);
        expect(r.darf).toHaveLength(0);
        expect(r.summary.totalDarf).toBe(0);
        expect(r.dividends.total).toBe(0);
        expect(r.manualReviewItems).toHaveLength(0);
    });

    it('posição totalmente vendida não aparece em Bens e Direitos', async () => {
        mockTxs([
            { ticker: 'PETR4', type: 'BUY', quantity: 100, price: 10, date: d('2025-01-05') },
            { ticker: 'PETR4', type: 'SELL', quantity: 100, price: 12, date: d('2025-03-10') },
        ]);
        mockAssets([{ ticker: 'PETR4', type: 'STOCK', currency: 'BRL', name: 'Petrobras' }]);
        mockDividends([]);
        const r = await taxReportService.computeReport('user1', 2025);
        expect(r.positions).toHaveLength(0);
    });
});
