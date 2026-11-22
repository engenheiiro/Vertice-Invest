/**
 * NTN-B a partir da série JÁ GRAVADA (TreasuryPriceHistory) — sem baixar ~14 MB.
 *
 * Num processo novo (sync:prod) o memo por hora nunca acerta, e o download do
 * CSV só para ler uma taxa custava ~30s de cada run. A taxa está no banco desde
 * a ingestão do PU (mesma coluna "Taxa Venda Manha" do mesmo arquivo).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../models/TreasuryPriceHistory.js', () => ({ default: { find: vi.fn() } }));

const TreasuryPriceHistory = (await import('../models/TreasuryPriceHistory.js')).default;
const { macroDataService } = await import('../services/macroDataService.js');

const doc = (family, maturity, date, rate) => ({ family, maturity, history: [{ date, pu: 1000, rate }] });

beforeEach(() => vi.clearAllMocks());

describe('_pickNtnbFromStoredDocs (pura)', () => {
    const pick = (docs, expected = '2026-11-19') => macroDataService._pickNtnbFromStoredDocs(docs, expected);

    it('segue a escada 2035→2060 do CSV', () => {
        expect(pick([
            doc('IPCA', '2045-05-15', '2026-11-19', 7.4),
            doc('IPCA', '2035-05-15', '2026-11-19', 7.1),
        ])).toBe(7.1);
    });

    it('ignora vencimento < 2035', () => {
        expect(pick([doc('IPCA', '2029-05-15', '2026-11-19', 7.9)])).toBeNull();
    });

    it('série atrasada (antes do pregão esperado) não vale — o chamador baixa o arquivo', () => {
        expect(pick([doc('IPCA', '2035-05-15', '2026-11-18', 7.1)])).toBeNull();
    });

    it('taxa implausível não vale', () => {
        expect(pick([doc('IPCA', '2035-05-15', '2026-11-19', 45)])).toBeNull();
    });

    it('no mesmo vencimento, prefere IPCA+ sem cupom', () => {
        expect(pick([
            doc('IPCA_JS', '2035-05-15', '2026-11-19', 7.3),
            doc('IPCA', '2035-05-15', '2026-11-19', 7.1),
        ])).toBe(7.1);
    });

    it('usa a Data Base mais recente entre os títulos', () => {
        expect(pick([
            doc('IPCA', '2035-05-15', '2026-11-19', 7.1),
            doc('IPCA', '2040-08-15', '2026-11-21', 7.25),
        ])).toBe(7.25);
    });
});

describe('_ntnbFromStoredSeries', () => {
    it('lê só a última posição da série (projeção $slice) e devolve a taxa', async () => {
        const select = vi.fn(() => ({ lean: () => Promise.resolve([doc('IPCA', '2035-05-15', '2026-11-19', 7.1)]) }));
        TreasuryPriceHistory.find.mockReturnValue({ select });
        // Domingo 22/11/2026 → pregão esperado 19/11 (20/11 feriado).
        expect(await macroDataService._ntnbFromStoredSeries('2026-11-22')).toBe(7.1);
        expect(select).toHaveBeenCalledWith(expect.objectContaining({ history: { $slice: -1 } }));
    });

    it('falha de banco devolve null (cai no download)', async () => {
        TreasuryPriceHistory.find.mockImplementation(() => { throw new Error('down'); });
        expect(await macroDataService._ntnbFromStoredSeries('2026-11-22')).toBeNull();
    });
});
