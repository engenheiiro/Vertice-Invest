/**
 * NTN-B (Tesouro IPCA+) — guarda de plausibilidade da taxa REAL (jul/2026).
 *
 * Contexto do bug real que motivou a guarda: o Investidor10 passou a exibir, para
 * títulos IPCA-indexados, o retorno NOMINAL projetado (taxa real ⊕ IPCA ≈ 7,3% ⊕
 * 4,7% ≈ 12,4%) em vez da taxa REAL. O scraper capturava 12,43% e gravava em
 * macro.ntnbLong, que alimenta o Bazin e o spread vs Tesouro de ações e FIIs —
 * inflando o yield-alvo e comprimindo o spread (viés conservador que suprimia
 * bons ativos). Yields reais brasileiros vivem em ~2%–9%; a faixa rejeita o valor
 * contaminado e ancora no último dado real conhecido.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({
    captureMessage: vi.fn(),
    captureException: vi.fn(),
}));

vi.mock('../models/TreasuryBond.js', () => ({
    default: { find: vi.fn(), bulkWrite: vi.fn(() => Promise.resolve({})) },
}));

import * as Sentry from '@sentry/node';
import TreasuryBond from '../models/TreasuryBond.js';
import {
    macroDataService,
    isPlausibleNtnbRate,
    NTNB_REAL_MIN,
    NTNB_REAL_MAX,
} from '../services/macroDataService.js';

// Simula o chain find().sort().limit().lean() do Mongoose com um array fixo.
const mockFindRows = (rows) => {
    TreasuryBond.find.mockReturnValue({
        sort: () => ({ limit: () => ({ lean: () => Promise.resolve(rows) }) }),
    });
};

const bond = (title, rate) => ({ title, rate, minInvestment: 50, unitPrice: 3000, maturity: '15/05/2045' });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('isPlausibleNtnbRate — faixa de yield real', () => {
    it('aceita yields reais realistas e rejeita a contaminação nominal (~12%)', () => {
        expect(isPlausibleNtnbRate(7.25)).toBe(true);
        expect(isPlausibleNtnbRate(NTNB_REAL_MIN)).toBe(true);
        expect(isPlausibleNtnbRate(NTNB_REAL_MAX)).toBe(true);
        expect(isPlausibleNtnbRate(12.43)).toBe(false); // real ⊕ IPCA
        expect(isPlausibleNtnbRate(1.0)).toBe(false);
        expect(isPlausibleNtnbRate(0)).toBe(false);
        expect(isPlausibleNtnbRate(NaN)).toBe(false);
        expect(isPlausibleNtnbRate(undefined)).toBe(false);
    });
});

describe('getLastKnownNtnbRate — âncora no último dado real', () => {
    it('prioriza a NTN-B de vencimento mais longo entre as plausíveis', async () => {
        mockFindRows([
            { title: 'Tesouro IPCA+ 2045 Juros Semestrais', rate: 7.31 },
            { title: 'Tesouro IPCA+ 2060 Juros Semestrais', rate: 7.25 },
            { title: 'Tesouro IPCA+ 2037 Juros Semestrais', rate: 7.53 },
        ]);
        const rate = await macroDataService.getLastKnownNtnbRate();
        expect(rate).toBe(7.25); // 2060 é a mais longa
    });

    it('a query já filtra pela faixa plausível (contaminados não entram)', async () => {
        mockFindRows([]);
        const rate = await macroDataService.getLastKnownNtnbRate();
        expect(rate).toBeNull();
        // confirma que o filtro de rate usa a faixa exportada
        const filter = TreasuryBond.find.mock.calls[0][0];
        expect(filter.rate).toEqual({ $gte: NTNB_REAL_MIN, $lte: NTNB_REAL_MAX });
    });
});

describe('updateTreasuryRates — rejeição da contaminação nominal', () => {
    it('ignora 12,43% do scraping e ancora no último real conhecido (~7,25%)', async () => {
        vi.spyOn(macroDataService, 'fetchNtnbFromTesouroDireto').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'scrapeInvestidor10').mockResolvedValue([
            bond('Tesouro IPCA+ 2045 Juros Semestrais', 12.43), // contaminado (nominal)
            bond('Tesouro IPCA+ 2050', 12.08),                  // contaminado
            bond('Tesouro Educa+ 2035', 12.69),                 // não é NTN-B de referência
            bond('Tesouro Prefixado 2032', 14.6),
            bond('Tesouro Selic 2031', 14.33),
        ]);
        mockFindRows([{ title: 'Tesouro IPCA+ 2060 Juros Semestrais', rate: 7.25 }]);

        const out = await macroDataService.updateTreasuryRates();

        expect(out.ntnbLong).toBe(7.25);
        expect(out.ntnbLong).not.toBe(12.43);
        expect(out.ntnbSource).toBe('último-conhecido');
        expect(Sentry.captureMessage).toHaveBeenCalledOnce();

        macroDataService.fetchNtnbFromTesouroDireto.mockRestore();
        macroDataService.scrapeInvestidor10.mockRestore();
    });

    it('usa a taxa do scraping quando ela é um yield real plausível', async () => {
        vi.spyOn(macroDataService, 'fetchNtnbFromTesouroDireto').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'scrapeInvestidor10').mockResolvedValue([
            bond('Tesouro IPCA+ 2045 Juros Semestrais', 7.30),
            bond('Tesouro Prefixado 2032', 14.6),
            bond('Tesouro Selic 2031', 14.33),
        ]);

        const out = await macroDataService.updateTreasuryRates();

        expect(out.ntnbLong).toBe(7.30);
        expect(out.ntnbSource).toBe('Investidor10');
        expect(macroDataService.getLastKnownNtnbRate).toBeTypeOf('function');

        macroDataService.fetchNtnbFromTesouroDireto.mockRestore();
        macroDataService.scrapeInvestidor10.mockRestore();
    });

    it('a fonte oficial plausível tem prioridade sobre o scraping', async () => {
        vi.spyOn(macroDataService, 'fetchNtnbFromTesouroDireto').mockResolvedValue(7.4);
        vi.spyOn(macroDataService, 'scrapeInvestidor10').mockResolvedValue([
            bond('Tesouro IPCA+ 2045 Juros Semestrais', 12.43), // ignorado: já temos oficial
            bond('Tesouro Prefixado 2032', 14.6),
        ]);

        const out = await macroDataService.updateTreasuryRates();

        expect(out.ntnbLong).toBe(7.4);
        expect(out.ntnbSource).toBe('TesouroTransparente');

        macroDataService.fetchNtnbFromTesouroDireto.mockRestore();
        macroDataService.scrapeInvestidor10.mockRestore();
    });
});
