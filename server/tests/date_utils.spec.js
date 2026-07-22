/**
 * 6.10 — Utilitário único de datas: toDateKey (chave UTC YYYY-MM-DD),
 * startOfDay (meia-noite local) e dateKeyToUtcDate (chave → Date UTC estável).
 */
import { describe, it, expect } from 'vitest';
import { toDateKey, startOfDay, dateKeyToUtcDate, parseCalendarDate, isBusinessDay, countBusinessDays } from '../utils/dateUtils.js';

describe('toDateKey', () => {
  it('gera chave YYYY-MM-DD a partir de Date/string/number', () => {
    expect(toDateKey('2026-06-17T13:45:00.000Z')).toBe('2026-06-17');
    expect(toDateKey(new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02');
    expect(toDateKey(Date.UTC(2026, 11, 31))).toBe('2026-12-31');
  });

  it('é equivalente ao padrão antigo toISOString().split("T")[0]', () => {
    const d = new Date('2026-03-10T22:10:00.000Z');
    expect(toDateKey(d)).toBe(d.toISOString().split('T')[0]);
  });

  it('retorna null para entrada vazia/inválida (sem lançar)', () => {
    expect(toDateKey(null)).toBeNull();
    expect(toDateKey(undefined)).toBeNull();
    expect(toDateKey('')).toBeNull();
    expect(toDateKey('não-é-data')).toBeNull();
  });
});

describe('startOfDay', () => {
  it('zera horas/min/seg/ms no fuso local e devolve novo Date', () => {
    const original = new Date('2026-06-17T15:30:45.123');
    const result = startOfDay(original);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
    // não muta o original
    expect(original.getHours()).toBe(15);
  });
});

// Regressão: dev (BRT, UTC-3) contava 1 dia útil a MAIS que prod (UTC) porque
// isBusinessDay usava getDay() e countBusinessDays usava setHours/getDate (LOCAL).
// A meia-noite UTC ("dia puro") virava 21h do dia anterior em BRT → renda fixa
// "rendia" no sábado no dev. Ancorado em UTC, dev e prod dão o MESMO resultado.
describe('isBusinessDay / countBusinessDays — ancorados em UTC (independem do fuso)', () => {
  it('dia da semana pela data UTC pura (sexta útil, sáb/dom não)', () => {
    expect(isBusinessDay(new Date('2026-07-03T00:00:00.000Z'))).toBe(true);  // sexta
    expect(isBusinessDay(new Date('2026-07-04T00:00:00.000Z'))).toBe(false); // sábado
    expect(isBusinessDay(new Date('2026-07-05T00:00:00.000Z'))).toBe(false); // domingo
    expect(isBusinessDay(new Date('2026-07-06T00:00:00.000Z'))).toBe(true);  // segunda
  });

  it('sábado NÃO adiciona dia útil sobre a sexta (reserva não rende no fim de semana)', () => {
    const lote = new Date('2026-06-30T00:00:00.000Z'); // terça
    expect(countBusinessDays(lote, new Date('2026-07-03T00:00:00.000Z'))).toBe(3); // sexta
    expect(countBusinessDays(lote, new Date('2026-07-04T00:00:00.000Z'))).toBe(3); // sábado = sexta
    expect(countBusinessDays(lote, new Date('2026-07-05T00:00:00.000Z'))).toBe(3); // domingo = sexta
    expect(countBusinessDays(lote, new Date('2026-07-06T00:00:00.000Z'))).toBe(4); // segunda
  });
});

describe('dateKeyToUtcDate', () => {
  it('reconstrói meia-noite UTC da chave do dia', () => {
    const d = dateKeyToUtcDate('2026-06-17T23:59:00.000Z');
    expect(d.toISOString()).toBe('2026-06-17T00:00:00.000Z');
  });

  it('retorna null para entrada inválida', () => {
    expect(dateKeyToUtcDate(null)).toBeNull();
  });
});

describe('parseCalendarDate', () => {
  it('preserva o dia civil de um input YYYY-MM-DD no Brasil', () => {
    const d = parseCalendarDate('2026-07-21');
    expect(d.toISOString()).toBe('2026-07-21T12:00:00.000Z');
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)).toBe('2026-07-21');
  });

  it('preserva Date e ISO completos sem reinterpretar o instante', () => {
    const source = new Date('2026-07-21T18:30:00.000Z');
    expect(parseCalendarDate(source).toISOString()).toBe(source.toISOString());
    expect(parseCalendarDate(source)).not.toBe(source);
    expect(parseCalendarDate('2026-07-21T18:30:00.000Z').toISOString()).toBe(source.toISOString());
  });

  it('rejeita dias inexistentes e entradas inválidas', () => {
    expect(parseCalendarDate('2026-02-30')).toBeNull();
    expect(parseCalendarDate('não-é-data')).toBeNull();
  });
});
