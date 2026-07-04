import { describe, it, expect } from 'vitest';
import { isBrBusinessDay } from '../services/schedulerService.js';

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSÃO: Gate de dia útil do Snapshot Diário ancorado no DIA-CALENDÁRIO BR.
//
// Bug original: runDailySnapshot fazia `isBusinessDay(new Date())`. O cron dispara
// 23:59 America/Sao_Paulo, que é 02:59 UTC do DIA SEGUINTE. Como isBusinessDay lê
// o dia da semana em UTC (getDay() num servidor UTC), toda SEXTA 23:59 BRT era
// vista como SÁBADO → snapshot pulado; e todo DOMINGO 23:59 BRT como SEGUNDA →
// snapshot indevido. Confirmado no log do Render (Jul 3, sexta: "Dia não útil").
//
// A correção deriva o dia BR (YYYY-MM-DD) do instante e checa o dia da semana
// desse dia — independente do fuso do servidor.
// ─────────────────────────────────────────────────────────────────────────────

// Réplica de brDayStr (schedulerService) — dia-calendário de São Paulo de um instante.
const brDayStr = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

// Instante em que o cron de 23:59 BRT dispara, para um dia BR (em UTC é +3h → dia seguinte).
const cronInstantFor = (brDay) => new Date(`${brDay}T23:59:00.000-03:00`);

describe('isBrBusinessDay — dia útil pela string do dia BR (independe do fuso)', () => {
    it('reconhece sexta como dia útil e sábado/domingo como não úteis', () => {
        expect(isBrBusinessDay('2026-07-02')).toBe(true);  // quinta
        expect(isBrBusinessDay('2026-07-03')).toBe(true);  // sexta
        expect(isBrBusinessDay('2026-07-04')).toBe(false); // sábado
        expect(isBrBusinessDay('2026-07-05')).toBe(false); // domingo
        expect(isBrBusinessDay('2026-07-06')).toBe(true);  // segunda
    });
});

describe('Gate do Snapshot — instante do cron (23:59 BRT) mapeia para o dia BR correto', () => {
    it('SEXTA 23:59 BRT NÃO é pulada (o instante é sábado em UTC, mas o dia BR é sexta)', () => {
        const inst = cronInstantFor('2026-07-03'); // sexta 23:59 BRT
        // Sanidade: em UTC o instante já virou sábado — a origem do bug.
        expect(inst.getUTCDay()).toBe(6); // sábado (UTC)
        // Gate corrigido: deriva o dia BR (sexta) e roda.
        expect(brDayStr(inst)).toBe('2026-07-03');
        expect(isBrBusinessDay(brDayStr(inst))).toBe(true);
    });

    it('DOMINGO 23:59 BRT É pulado (antes era gravado indevidamente por ser segunda em UTC)', () => {
        const inst = cronInstantFor('2026-07-05'); // domingo 23:59 BRT
        expect(inst.getUTCDay()).toBe(1); // segunda (UTC) — a falsa positiva antiga
        expect(brDayStr(inst)).toBe('2026-07-05');
        expect(isBrBusinessDay(brDayStr(inst))).toBe(false);
    });

    it('QUINTA 23:59 BRT roda normalmente', () => {
        const inst = cronInstantFor('2026-07-02');
        expect(brDayStr(inst)).toBe('2026-07-02');
        expect(isBrBusinessDay(brDayStr(inst))).toBe(true);
    });
});
