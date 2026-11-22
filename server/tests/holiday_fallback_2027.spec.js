/**
 * A reserva local de feriados terminava em 2026: com a BrasilAPI fora em 2027,
 * Carnaval, Sexta-Santa e Corpus Christi virariam dia útil para todo o sistema.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn().mockRejectedValue(new Error('fora do ar')) } }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { holidayService } = await import('../services/holidayService.js');

describe('holidayService — reserva local', () => {
    it('cobre os feriados móveis de 2027 (Páscoa em 28/03)', () => {
        for (const d of ['2027-02-08', '2027-02-09', '2027-03-26', '2027-05-27']) {
            expect(holidayService.isHoliday(d), d).toBe(true);
        }
    });

    it('sync() informa a falha (false) em vez de engolir', async () => {
        expect(await holidayService.sync()).toBe(false);
    });
});
