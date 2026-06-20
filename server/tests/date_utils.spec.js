/**
 * 6.10 — Utilitário único de datas: toDateKey (chave UTC YYYY-MM-DD),
 * startOfDay (meia-noite local) e dateKeyToUtcDate (chave → Date UTC estável).
 */
import { describe, it, expect } from 'vitest';
import { toDateKey, startOfDay, dateKeyToUtcDate } from '../utils/dateUtils.js';

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

describe('dateKeyToUtcDate', () => {
  it('reconstrói meia-noite UTC da chave do dia', () => {
    const d = dateKeyToUtcDate('2026-06-17T23:59:00.000Z');
    expect(d.toISOString()).toBe('2026-06-17T00:00:00.000Z');
  });

  it('retorna null para entrada inválida', () => {
    expect(dateKeyToUtcDate(null)).toBeNull();
  });
});
