import { describe, it, expect, vi, afterEach } from 'vitest';
import { macroDataService } from '../services/macroDataService.js';

// Guard de autoridade da Selic: só o BCB (meta COPOM) move a taxa; uma fonte
// secundária (BrasilAPI) atrasada durante uma queda do BCB é CONGELADA no último
// valor bom, em vez de propagar Selic velha para toda a renda fixa/carteira.
// Reproduz exatamente o incidente observado (reserva rendeu R$7,50 vs R$7,88).

describe('_reconcileSelic (guard puro)', () => {
    it('BCB é autoritativa → sempre aceita e move a taxa', () => {
        const r = macroDataService._reconcileSelic(14.25, 'BCB', 13.50);
        expect(r).toEqual({ selic: 14.25, frozen: false });
    });

    it('fallback hardcoded (source vazia) → aceita (comportamento legado)', () => {
        const r = macroDataService._reconcileSelic(14.25, null, 13.50);
        expect(r).toEqual({ selic: 14.25, frozen: false });
    });

    it('sem âncora anterior → aceita a secundária (bootstrap)', () => {
        expect(macroDataService._reconcileSelic(14.25, 'BrasilAPI', null)).toEqual({ selic: 14.25, frozen: false });
        expect(macroDataService._reconcileSelic(14.25, 'BrasilAPI', 0)).toEqual({ selic: 14.25, frozen: false });
    });

    it('secundária CONFIRMA o último valor bom → aceita (não congela)', () => {
        const r = macroDataService._reconcileSelic(14.25, 'BrasilAPI', 14.25);
        expect(r).toEqual({ selic: 14.25, frozen: false });
    });

    it('secundária DIVERGE do último valor bom → CONGELA no valor bom', () => {
        // Cenário real: BCB caiu, BrasilAPI ainda com Selic pré-alta (13,50) vs cache bom 14,25.
        const r = macroDataService._reconcileSelic(13.50, 'BrasilAPI', 14.25);
        expect(r.frozen).toBe(true);
        expect(r.selic).toBe(14.25); // mantém o valor bom, NÃO o atrasado
        expect(r.rejectedValue).toBe(13.50);
        expect(r.rejectedSource).toBe('BrasilAPI');
    });

    it('tolerância de igualdade absorve ruído de arredondamento (≤ 0,001)', () => {
        expect(macroDataService._reconcileSelic(14.2505, 'BrasilAPI', 14.25).frozen).toBe(false);
        expect(macroDataService._reconcileSelic(14.26, 'BrasilAPI', 14.25).frozen).toBe(true);
    });
});

describe('updateOfficialRates (guard integrado, fontes mockadas)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('BCB no ar → move a Selic normalmente (sem congelar)', async () => {
        vi.spyOn(macroDataService, '_fetchBcbSeries').mockImplementation(async (_serie, label) => label === 'SELIC' ? 14.25 : 4.72);
        const brasil = vi.spyOn(macroDataService, 'fetchRatesFromBrasilApi');
        const out = await macroDataService.updateOfficialRates(13.50);
        expect(out.selic).toBe(14.25);
        expect(out.selicFrozen).toBe(false);
        expect(out.cdi).toBeCloseTo(14.15, 10);
        expect(out.sources.selic).toBe('BCB');
        expect(brasil).not.toHaveBeenCalled(); // BCB resolveu, nem toca na secundária
    });

    it('BCB caído + BrasilAPI atrasada divergente → CONGELA no último valor bom', async () => {
        vi.spyOn(macroDataService, '_fetchBcbSeries').mockResolvedValue(null); // BCB fora
        vi.spyOn(macroDataService, 'fetchRatesFromBrasilApi').mockResolvedValue({ selic: 13.50, ipca: 4.72 });
        const out = await macroDataService.updateOfficialRates(14.25);
        expect(out.selicFrozen).toBe(true);
        expect(out.selic).toBe(14.25);           // não propaga a Selic velha
        expect(out.cdi).toBeCloseTo(14.15, 10);   // CDI segue coerente com o valor bom
        expect(out.sources.selic).toBe('frozen');
        expect(out.isFallback).toBe(false);       // não é fallback hardcoded, é congelamento
    });

    it('BCB caído + BrasilAPI concordando → aceita (sem congelar)', async () => {
        vi.spyOn(macroDataService, '_fetchBcbSeries').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'fetchRatesFromBrasilApi').mockResolvedValue({ selic: 14.25, ipca: 4.72 });
        const out = await macroDataService.updateOfficialRates(14.25);
        expect(out.selicFrozen).toBe(false);
        expect(out.selic).toBe(14.25);
        expect(out.sources.selic).toBe('BrasilAPI');
    });

    it('bootstrap: sem valor bom anterior → aceita a secundária mesmo divergente', async () => {
        vi.spyOn(macroDataService, '_fetchBcbSeries').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'fetchRatesFromBrasilApi').mockResolvedValue({ selic: 13.50, ipca: 4.72 });
        const out = await macroDataService.updateOfficialRates(null);
        expect(out.selicFrozen).toBe(false);
        expect(out.selic).toBe(13.50);
        expect(out.sources.selic).toBe('BrasilAPI');
    });

    it('tudo fora → fallback hardcoded (não congela; marca fallback)', async () => {
        vi.spyOn(macroDataService, '_fetchBcbSeries').mockResolvedValue(null);
        vi.spyOn(macroDataService, 'fetchRatesFromBrasilApi').mockResolvedValue({ selic: null, ipca: null });
        vi.spyOn(macroDataService, 'fetchIpcaFromIbge').mockResolvedValue(null);
        const out = await macroDataService.updateOfficialRates(14.25);
        expect(out.isFallback).toBe(true);
        expect(out.selicFrozen).toBe(false);
        expect(out.selic).toBeGreaterThan(0);
    });
});
