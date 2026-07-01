/**
 * (7.11) Controller de IR — validação de ano-base, resposta JSON e geração do
 * PDF (pdf-lib roda de verdade, garantindo que buildTaxPdf percorre todas as
 * seções sem erro e produz um PDF válido).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/taxReportService.js', () => ({
    taxReportService: { computeReport: vi.fn() },
}));
vi.mock('../models/User.js', () => ({
    default: { findById: vi.fn(() => ({ select: () => ({ lean: () => Promise.resolve({ name: 'Investidor Teste', email: 't@t.com' }) }) })) },
}));

const { taxReportService } = await import('../services/taxReportService.js');
const UserModel = (await import('../models/User.js')).default;
const { getTaxReport, getTaxReportPdf } = await import('../controllers/taxController.js');

const makeRes = () => {
    const res = { statusCode: 200, body: null, headers: {}, sent: null };
    res.status = vi.fn((c) => { res.statusCode = c; return res; });
    res.json = vi.fn((b) => { res.body = b; return res; });
    res.setHeader = vi.fn((k, v) => { res.headers[k] = v; });
    res.send = vi.fn((b) => { res.sent = b; return res; });
    return res;
};

// Relatório rico o bastante para exercitar todas as seções do PDF.
const FULL_REPORT = {
    year: 2025,
    generatedAt: new Date('2026-04-10T12:00:00Z'),
    positions: [],
    positionsByGroup: [
        { groupLabel: 'Ações (mercado à vista)', grupo: '03', totalCost: 30000, exterior: false,
          items: [{ ticker: 'PETR4', quantity: 1000, avgPrice: 30, totalCost: 30000, manualReview: false }] },
        { groupLabel: 'Bens no Exterior (Ações/ETF/REIT)', grupo: '03', totalCost: 750, exterior: true,
          items: [{ ticker: 'AAPL', quantity: 5, avgPrice: 150, totalCost: 750, manualReview: true }] },
    ],
    monthly: [
        { month: '02', category: 'ACOES', sales: 1000, gain: 200, exempt: true, compensatedLoss: 0, taxableBase: 0, taxRate: 0.15, tax: 0, lossCarryAfter: 0 },
        { month: '03', category: 'ACOES', sales: 60000, gain: 30000, exempt: false, compensatedLoss: 0, taxableBase: 30000, taxRate: 0.15, tax: 4500, lossCarryAfter: 0 },
        { month: '05', category: 'FII', sales: 15000, gain: -2000, exempt: false, compensatedLoss: 0, taxableBase: 0, taxRate: 0.20, tax: 0, lossCarryAfter: 2000 },
    ],
    darf: [
        { month: '03', competencia: '2025-03', code: '6015', dueDate: new Date('2025-04-30T00:00:00Z'), amount: 4500, breakdown: [{ category: 'ACOES', tax: 4500 }] },
    ],
    darfCarryToNextYear: 5,
    dividends: { total: 2055, byTicker: [
        { ticker: 'PETR4', name: 'Petrobras PN', type: 'STOCK', amount: 2000 },
        { ticker: 'HGLG11', name: 'CSHG Logística', type: 'FII', amount: 55 },
    ] },
    lossCarryEndOfYear: { ACOES: 0, FII: 2000, ETF: 0 },
    manualReviewItems: [{ category: 'EXTERIOR', realizedGain: 250, sales: 1000 }],
    summary: { totalDarf: 4500, totalTaxByCategory: { ACOES: 4500, FII: 0, ETF: 0 }, totalDividends: 2055, totalPositionCostBRL: 30000, positionsCount: 2 },
    disclaimers: ['Aviso 1', 'Aviso 2', 'Aviso 3', 'Aviso 4', 'Aviso 5', 'Aviso 6'],
};

beforeEach(() => vi.clearAllMocks());

describe('getTaxReport — validação e JSON', () => {
    it('rejeita ano fora do intervalo (2014) com 400', async () => {
        const res = makeRes();
        await getTaxReport({ params: { year: '2014' }, user: { id: 'u1' } }, res, vi.fn());
        expect(res.statusCode).toBe(400);
        expect(taxReportService.computeReport).not.toHaveBeenCalled();
    });

    it('rejeita ano futuro com 400', async () => {
        const res = makeRes();
        const future = String(new Date().getFullYear() + 1);
        await getTaxReport({ params: { year: future }, user: { id: 'u1' } }, res, vi.fn());
        expect(res.statusCode).toBe(400);
    });

    it('rejeita ano não numérico com 400', async () => {
        const res = makeRes();
        await getTaxReport({ params: { year: 'abc' }, user: { id: 'u1' } }, res, vi.fn());
        expect(res.statusCode).toBe(400);
    });

    it('ano válido chama o serviço e devolve o relatório', async () => {
        taxReportService.computeReport.mockResolvedValue(FULL_REPORT);
        const res = makeRes();
        await getTaxReport({ params: { year: '2025' }, user: { id: 'u1' } }, res, vi.fn());
        expect(taxReportService.computeReport).toHaveBeenCalledWith('u1', 2025);
        expect(res.body.year).toBe(2025);
    });

    it('encaminha erro do serviço para o next (error handler)', async () => {
        taxReportService.computeReport.mockRejectedValue(new Error('boom'));
        const res = makeRes();
        const next = vi.fn();
        await getTaxReport({ params: { year: '2025' }, user: { id: 'u1' } }, res, next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
});

describe('getTaxReportPdf — geração do PDF', () => {
    it('gera um PDF válido com headers de download', async () => {
        taxReportService.computeReport.mockResolvedValue(FULL_REPORT);
        const res = makeRes();
        await getTaxReportPdf({ params: { year: '2025' }, user: { id: 'u1' } }, res, vi.fn());

        expect(res.headers['Content-Type']).toBe('application/pdf');
        expect(res.headers['Content-Disposition']).toContain('vertice-ir-2025.pdf');
        expect(Buffer.isBuffer(res.sent)).toBe(true);
        // Assinatura de arquivo PDF.
        expect(res.sent.slice(0, 5).toString('latin1')).toBe('%PDF-');
        expect(res.sent.length).toBeGreaterThan(1000);
    });

    it('não quebra com caracteres fora do WinAnsi (nomes de usuário/ativo, ≤)', async () => {
        // Nome de ativo com símbolos que a fonte StandardFont não codifica.
        const tricky = {
            ...FULL_REPORT,
            positionsByGroup: [{
                groupLabel: 'Ações (mercado à vista)', grupo: '03', totalCost: 100, exterior: false,
                items: [{ ticker: 'ΩXYZ🚀', quantity: 1, avgPrice: 100, totalCost: 100, manualReview: false }],
            }],
            dividends: { total: 10, byTicker: [{ ticker: 'ΩX', name: 'Fundo ≤ Teste 你好', type: 'FII', amount: 10 }] },
            disclaimers: ['Isenção de vendas ≤ R$20.000/mês — atenção às regras.'],
        };
        UserModel.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ name: 'Usuário 你好 ≤', email: 'x@x.com' }) }) });
        taxReportService.computeReport.mockResolvedValue(tricky);
        const res = makeRes();
        await getTaxReportPdf({ params: { year: '2025' }, user: { id: 'u1' } }, res, vi.fn());
        expect(res.sent.slice(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('ano inválido não gera PDF (400)', async () => {
        const res = makeRes();
        await getTaxReportPdf({ params: { year: '1999' }, user: { id: 'u1' } }, res, vi.fn());
        expect(res.statusCode).toBe(400);
        expect(taxReportService.computeReport).not.toHaveBeenCalled();
    });
});
