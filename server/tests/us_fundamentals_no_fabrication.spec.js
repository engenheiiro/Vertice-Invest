/**
 * Fundamentos US (quoteSummary do Yahoo → MarketAsset): só grava o que a fonte
 * trouxe. Resposta parcial não zera DY, EV não vira market cap, P/L projetado
 * não vira histórico, setor ausente não vira 'Technology', e preço/isActive
 * ficam com o passo de cotação.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { _internals } = await import('../services/usStocksFundamentalsService.js');
const { extractFundamentals, buildFundamentalsOp } = _internals;

describe('extractFundamentals', () => {
    it('módulo summaryDetail ausente → dy null (não 0)', () => {
        const f = extractFundamentals('XYZ', { financialData: { currentPrice: 10 } });
        expect(f.dy).toBeNull();
    });

    it('não-pagador declarado (trailingAnnualDividendYield 0) → dy 0', () => {
        const f = extractFundamentals('XYZ', { summaryDetail: { trailingAnnualDividendYield: 0 } });
        expect(f.dy).toBe(0);
    });

    it('marketCap ausente NÃO cai no enterpriseValue', () => {
        const f = extractFundamentals('XYZ', { defaultKeyStatistics: { enterpriseValue: 9e11 } });
        expect(f.marketCap).toBeNull();
    });

    it('P/L só trailing: forwardPE sozinho não vira P/L', () => {
        const f = extractFundamentals('XYZ', { defaultKeyStatistics: { forwardPE: 18 } });
        expect(f.pl).toBeNull();
        expect(extractFundamentals('XYZ', { summaryDetail: { trailingPE: 22 } }).pl).toBe(22);
    });
});

describe('buildFundamentalsOp', () => {
    const data = {
        summaryDetail: { marketCap: 5e10, regularMarketPrice: 123 },
        financialData: { currentPrice: 123 },
    };

    it('não grava preço nem reafirma isActive', () => {
        const op = buildFundamentalsOp('AAPL', data);
        const { $set, $setOnInsert } = op.updateOne.update;
        expect($set).not.toHaveProperty('lastPrice');
        expect($set).not.toHaveProperty('isActive');
        expect($setOnInsert).toEqual(expect.objectContaining({ isActive: true }));
        expect($set.marketCap).toBe(5e10);
    });

    it('dy desconhecido fica fora do $set (preserva o gravado)', () => {
        const op = buildFundamentalsOp('AAPL', data);
        expect(op.updateOne.update.$set).not.toHaveProperty('dy');
    });

    it('setor ausente em toda fonte não vira Technology', () => {
        const op = buildFundamentalsOp('ZZZZ_FORA_DO_UNIVERSO', {});
        const { $set, $setOnInsert } = op.updateOne.update;
        expect($set).not.toHaveProperty('sector');
        expect($set).not.toHaveProperty('name');
        // Linha nova ainda precisa de nome: a sigla, só na criação.
        expect($setOnInsert.name).toBe('ZZZZ_FORA_DO_UNIVERSO');
    });

    it('$set e $setOnInsert nunca disputam o mesmo campo', () => {
        const op = buildFundamentalsOp('AAPL', { ...data, assetProfile: { sector: 'Technology' }, price: { longName: 'Apple' } });
        const { $set, $setOnInsert } = op.updateOne.update;
        const overlap = Object.keys($setOnInsert).filter(k => k in $set);
        expect(overlap).toEqual([]);
    });
});
