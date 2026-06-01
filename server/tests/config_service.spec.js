/**
 * I13 — configService (tunables operacionais).
 * Com o Mongo desconectado (readyState !== 1), o serviço NÃO consulta o banco e
 * devolve os defaults do M9 — preservando o comportamento das engines em testes.
 * Cobre também sanitização de faixa e a validação do update.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// mongoose desconectado por padrão (readyState 0) — força o caminho "defaults".
vi.mock('mongoose', () => ({ default: { connection: { readyState: 0 } } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));

const {
  getTunables,
  getTunablesSync,
  updateTunables,
  describeTunables,
  TUNABLE_DEFS,
} = await import('../services/configService.js');

describe('configService — defaults sem DB', () => {
  it('getTunablesSync devolve os defaults do M9 quando desconectado', () => {
    const t = getTunablesSync();
    expect(t.maxCryptoPerProfile).toBe(TUNABLE_DEFS.maxCryptoPerProfile.default);
    expect(t.marketCacheMinutes).toBe(TUNABLE_DEFS.marketCacheMinutes.default);
    expect(t.defaultSelicFallback).toBe(TUNABLE_DEFS.defaultSelicFallback.default);
  });

  it('getTunables (async) também resolve para os defaults', async () => {
    const t = await getTunables();
    expect(t).toMatchObject({
      maxCryptoPerProfile: TUNABLE_DEFS.maxCryptoPerProfile.default,
    });
  });

  it('describeTunables expõe valor + metadados (default/min/max/label)', async () => {
    const list = await describeTunables();
    const crypto = list.find((d) => d.key === 'maxCryptoPerProfile');
    expect(crypto).toMatchObject({
      label: expect.any(String),
      default: TUNABLE_DEFS.maxCryptoPerProfile.default,
      min: 0,
      max: 10,
    });
  });
});

describe('configService — validação do update', () => {
  it('rejeita patch sem nenhum campo válido (400)', async () => {
    await expect(updateTunables({ foo: 1, maxCryptoPerProfile: 999 }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rejeita valor fora da faixa', async () => {
    // marketCacheMinutes max 1440 → 99999 é descartado, sobra nada válido → 400
    await expect(updateTunables({ marketCacheMinutes: 99999 }))
      .rejects.toMatchObject({ status: 400 });
  });
});
