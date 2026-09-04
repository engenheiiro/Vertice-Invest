import { describe, it, expect, afterEach, vi } from 'vitest';
import { brNow, minutesUntilNextRun, nextRunLabel, cadenceLabel } from '../utils/sourceSchedule.js';

// "Tem muito card cinza — que horas eles rodam?" Cinza sem previsão é
// indistinguível de cinza abandonado. Estas contas são o que dá previsão.

const emBrasilia = (isoUtc) => vi.setSystemTime(new Date(isoUtc));

const MACRO = { kind: 'minutes', at: [5, 20, 35, 50] };
const DIARIO = { kind: 'dailyTimes', at: ['09:00', '18:30'] };
const RESERVA = { kind: 'onFailure' };

describe('sourceSchedule', () => {
    afterEach(() => vi.useRealTimers());

    it('lê a hora de SÃO PAULO, não a do relógio do servidor', () => {
        vi.useFakeTimers();
        emBrasilia('2026-09-04T20:11:00.000Z'); // 17:11 em Brasília
        expect(brNow()).toEqual({ hour: 17, minute: 11 });
    });

    it('acha o próximo minuto agendado dentro da hora', () => {
        vi.useFakeTimers();
        emBrasilia('2026-09-04T20:11:00.000Z'); // minuto 11 → próximo é 20
        expect(minutesUntilNextRun(MACRO)).toBe(9);
        expect(nextRunLabel(MACRO)).toBe('em 9 min');
    });

    it('vira a hora quando já passou do último minuto agendado', () => {
        vi.useFakeTimers();
        emBrasilia('2026-09-04T20:55:00.000Z'); // minuto 55 → próximo é o 5 da hora seguinte
        expect(minutesUntilNextRun(MACRO)).toBe(10);
    });

    it('no minuto exato, aponta o disparo seguinte (não o de agora)', () => {
        vi.useFakeTimers();
        emBrasilia('2026-09-04T20:20:00.000Z'); // minuto 20 → 35
        expect(minutesUntilNextRun(MACRO)).toBe(15);
    });

    // Para o que roda de 15 em 15 min a distância diz mais que o horário; para o
    // que roda 1-2× por dia, o horário diz mais que "em 4h12".
    it('rotina diária mostra o HORÁRIO, não a distância', () => {
        vi.useFakeTimers();
        emBrasilia('2026-09-04T17:00:00.000Z'); // 14:00 BRT → hoje às 18:30
        expect(nextRunLabel(DIARIO)).toBe('hoje às 18:30');
    });

    it('depois do último horário do dia, aponta o primeiro de amanhã', () => {
        vi.useFakeTimers();
        emBrasilia('2026-09-04T23:00:00.000Z'); // 20:00 BRT, já passou de 18:30
        expect(nextRunLabel(DIARIO)).toBe('amanhã às 09:00');
    });

    // Reserva não tem hora: ela entra quando a anterior falha. Inventar um horário
    // aqui seria mentir sobre o funcionamento da cadeia.
    it('fonte de reserva não tem próximo disparo', () => {
        expect(minutesUntilNextRun(RESERVA)).toBeNull();
        expect(nextRunLabel(RESERVA)).toBeNull();
        expect(cadenceLabel(RESERVA)).toContain('quando a fonte anterior');
    });

    it('a periodicidade sai em português', () => {
        expect(cadenceLabel(MACRO)).toBe('A cada 15 minutos');
        expect(cadenceLabel(DIARIO)).toBe('Todo dia às 09:00 e 18:30');
        expect(cadenceLabel({ kind: 'dailyTimes', at: ['18:30'] })).toBe('Todo dia às 18:30');
    });

    it('agendamento ausente é tratado como reserva, sem quebrar', () => {
        expect(minutesUntilNextRun(null)).toBeNull();
        expect(nextRunLabel(undefined)).toBeNull();
    });
});
