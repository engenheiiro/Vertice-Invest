/**
 * RETORNO 12M DE ÍNDICE NUNCA É INVENTADO.
 *
 * `getSpx12mReturn`/`getIbov12mReturn` devolviam 32,50% e 15,50% fixos quando o
 * Yahoo falhava, devolvia série curta ou valor anômalo — e o macro-sync gravava
 * esse número em `SystemConfig` como se fosse medido. Falha agora devolve null;
 * o macro-sync só grava valor finito, então o último retorno REAL fica.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const yahoo = vi.hoisted(() => ({ chart: vi.fn() }));

vi.mock('yahoo-finance2', () => ({
    default: class {
        chart(...args) { return yahoo.chart(...args); }
    },
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/errorLogService.js', () => ({ recordIngestionError: vi.fn() }));

const { externalMarketService } = await import('../services/externalMarketService.js');

const DAY = 24 * 60 * 60 * 1000;
/** Série diária de `dias` pregões terminando hoje, preço linear de `de` a `ate`. */
const serie = (dias, de, ate) => {
    const now = Date.now();
    return Array.from({ length: dias }, (_, i) => ({
        date: new Date(now - (dias - 1 - i) * DAY),
        close: de + ((ate - de) * i) / (dias - 1),
    }));
};

beforeEach(() => vi.clearAllMocks());

describe.each([
    ['getSpx12mReturn'],
    ['getIbov12mReturn'],
])('%s', (fn) => {
    it('falha do Yahoo devolve null, não um número fixo', async () => {
        yahoo.chart.mockRejectedValue(new Error('timeout'));
        expect(await externalMarketService[fn]()).toBeNull();
    });

    it('série insuficiente devolve null', async () => {
        yahoo.chart.mockResolvedValue({ quotes: serie(5, 100, 110) });
        expect(await externalMarketService[fn]()).toBeNull();
    });

    it('série curta (< 300 dias) devolve null', async () => {
        yahoo.chart.mockResolvedValue({ quotes: serie(120, 100, 110) });
        expect(await externalMarketService[fn]()).toBeNull();
    });

    it('série completa devolve o retorno medido', async () => {
        yahoo.chart.mockResolvedValue({ quotes: serie(380, 100, 120) });
        const r = await externalMarketService[fn]();
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThan(25);
    });
});

describe('getSpx12mReturn — valor anômalo', () => {
    it('retorno fora de [-60%, +100%] devolve null', async () => {
        yahoo.chart.mockResolvedValue({ quotes: serie(380, 100, 300) });
        expect(await externalMarketService.getSpx12mReturn()).toBeNull();
    });
});
