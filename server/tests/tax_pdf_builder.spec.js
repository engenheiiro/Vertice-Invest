import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildTaxPdf } from '../services/taxPdfBuilder.js';

// Construtor do PDF de IR com o pdf-lib de verdade: documento válido, quebra de
// página quando a tabela não cabe, e texto fora do WinAnsi não derruba a geração.

const baseReport = (over = {}) => ({
    year: 2025,
    generatedAt: new Date('2026-04-10T12:00:00Z'),
    summary: { totalDarf: 0, totalDividends: 0, totalPositionCostBRL: 0, positionsCount: 0 },
    positionsByGroup: [], monthly: [], darf: [], darfCarryToNextYear: 0,
    lossCarryEndOfYear: { ACOES: 0, FII: 0, ETF: 0 }, dividends: { total: 0, byTicker: [] },
    manualReviewItems: [], disclaimers: [],
    ...over,
});

const pageCount = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();

describe('buildTaxPdf', () => {
    it('relatório vazio cabe numa página só', async () => {
        const bytes = await buildTaxPdf(baseReport(), null);
        expect(Buffer.from(bytes).subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(await pageCount(bytes)).toBe(1);
    });

    it('lista longa de proventos abre páginas novas', async () => {
        const byTicker = Array.from({ length: 120 }, (_, i) => ({ ticker: `TICK${i}`, name: 'Fundo', amount: i }));
        const bytes = await buildTaxPdf(baseReport({ dividends: { total: 1, byTicker } }), { name: 'A' });
        expect(await pageCount(bytes)).toBeGreaterThan(2);
    });

    it('texto fora do WinAnsi (≤, emoji, CJK) não derruba a geração', async () => {
        const report = baseReport({
            dividends: { total: 10, byTicker: [{ ticker: 'ΩX🚀', name: 'Fundo ≤ 你好', amount: 10 }] },
            disclaimers: ['Vendas ≤ R$20.000 → isentas × regras.'],
        });
        await expect(buildTaxPdf(report, { name: 'Usuário 你好' })).resolves.toBeInstanceOf(Uint8Array);
    });
});
