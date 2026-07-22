/**
 * computeEtfAvgLiquidity — liquidez média (R$/dia) de ETF a partir dos candles.
 * Substitui o snapshot de volume de 1 dia (Brapi), que subconta a liquidez real de
 * tickers .SA. Validado contra dados vivos (ex.: SMAL11 ~52M no snapshot vs ~250M aqui).
 */
import { describe, it, expect } from 'vitest';
import { computeEtfAvgLiquidity, ETF_LIQUIDITY_WINDOW } from '../services/workers/timeSeriesWorker.js';

// Gera candles newest-first com volume e close constantes.
const candles = (n, volume, close = 100) =>
    Array.from({ length: n }, (_, i) => ({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, close, volume }));

describe('computeEtfAvgLiquidity', () => {
    it('turnover médio = volume × close quando constante', () => {
        // 30 candles de 1.000 cotas × R$100 = R$100.000/dia
        expect(computeEtfAvgLiquidity(candles(30, 1000, 100))).toBe(100000);
    });

    it('dias sem negócio (volume=0) puxam a média p/ baixo (iliquidez real)', () => {
        // 60 candles: metade com volume 2.000, metade zerados → média = 1.000 × close
        const half = [...candles(30, 2000, 50), ...candles(30, 0, 50)];
        // (30 × 2000 × 50 + 30 × 0) / 60 = 50.000
        expect(computeEtfAvgLiquidity(half)).toBe(50000);
    });

    it('usa apenas a janela de ~3 meses (60 candles), ignora o excedente', () => {
        // 100 candles: os 60 mais recentes têm volume 1.000; os 40 antigos, 9.999 (ignorados)
        const recent = candles(60, 1000, 10);
        const old = candles(40, 9999, 10);
        expect(computeEtfAvgLiquidity([...recent, ...old])).toBe(10000);
    });

    it('janela insuficiente (<20 candles) → null (mantém bootstrap do sync)', () => {
        expect(computeEtfAvgLiquidity(candles(19, 1000, 100))).toBeNull();
    });

    it('sem volume em nenhum candle → null (não grava liquidez 0)', () => {
        expect(computeEtfAvgLiquidity(candles(60, 0, 100))).toBeNull();
    });

    it('entrada inválida → null (defensivo)', () => {
        expect(computeEtfAvgLiquidity(null)).toBeNull();
        expect(computeEtfAvgLiquidity(undefined)).toBeNull();
        expect(computeEtfAvgLiquidity([])).toBeNull();
    });

    it('janela padrão é 60', () => {
        expect(ETF_LIQUIDITY_WINDOW).toBe(60);
    });
});
