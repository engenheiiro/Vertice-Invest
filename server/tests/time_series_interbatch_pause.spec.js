/**
 * Pausa entre lotes do timeSeriesWorker: proporcional às buscas no Yahoo.
 * Era 1s fixo para qualquer lote que tivesse buscado UMA série — o throttle
 * custava mais que o trabalho num run morno. O run frio mantém o 1s cheio.
 */
import { describe, it, expect } from 'vitest';
import {
    interBatchPauseMs,
    TIME_SERIES_BATCH_SIZE,
    TIME_SERIES_MAX_PAUSE_MS,
} from '../services/workers/timeSeriesWorker.js';

describe('interBatchPauseMs', () => {
    it('sem busca, ou com até 2, não dorme', () => {
        expect(interBatchPauseMs(0)).toBe(0);
        expect(interBatchPauseMs(1)).toBe(0);
        expect(interBatchPauseMs(2)).toBe(0);
    });

    it('lote inteiro buscado (run frio) mantém o 1s cheio', () => {
        expect(interBatchPauseMs(TIME_SERIES_BATCH_SIZE)).toBe(TIME_SERIES_MAX_PAUSE_MS);
        expect(TIME_SERIES_MAX_PAUSE_MS).toBe(1000);
    });

    it('cresce linear com a fração do lote buscada', () => {
        expect(interBatchPauseMs(10, 20)).toBe(500);
        expect(interBatchPauseMs(5, 20)).toBe(250);
        expect(interBatchPauseMs(3, 20)).toBe(150);
    });

    it('último lote parcial é medido pelo próprio tamanho, sem passar de 1s', () => {
        expect(interBatchPauseMs(5, 5)).toBe(1000);
        expect(interBatchPauseMs(40, 20)).toBe(1000);
    });

    it('entrada inválida não dorme', () => {
        expect(interBatchPauseMs(undefined)).toBe(0);
        expect(interBatchPauseMs(NaN)).toBe(0);
    });
});
