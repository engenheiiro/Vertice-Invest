import { describe, it, expect, vi } from 'vitest';

vi.mock('../models/TreasuryPriceHistory.js', () => ({ default: {} }));

const { expectedTreasuryDataBase } = await import('../services/treasuryPriceService.js');

// Só fim de semana + o feriado que cada caso nomear — o teste não depende do
// calendário carregado pelo holidayService.
const businessDay = (holidays = []) => (key) => {
    const dow = new Date(`${key}T12:00:00.000Z`).getUTCDay();
    return dow !== 0 && dow !== 6 && !holidays.includes(key);
};

// O job do PU decide entre pular e baixar comparando o banco com esta data:
// errar para TRÁS pula um dia que faltava; errar para FRENTE baixa 14,6 MB toda
// hora atrás de um pregão que não existe.
describe('expectedTreasuryDataBase', () => {
    it('numa sexta, espera a quinta', () => {
        expect(expectedTreasuryDataBase('2026-10-16', businessDay())).toBe('2026-10-15');
    });

    it('no sábado, espera a sexta', () => {
        expect(expectedTreasuryDataBase('2026-10-17', businessDay())).toBe('2026-10-16');
    });

    it('na terça, pula o fim de semana e espera a segunda', () => {
        expect(expectedTreasuryDataBase('2026-10-20', businessDay())).toBe('2026-10-19');
    });

    it('feriado na véspera recua até o pregão anterior', () => {
        // 12/10/2026 (segunda) é feriado: na terça, o último pregão é a sexta 09/10.
        expect(expectedTreasuryDataBase('2026-10-13', businessDay(['2026-10-12']))).toBe('2026-10-09');
    });
});
