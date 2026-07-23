/**
 * Regressão: 404 "ticker não encontrado" da brapi NÃO pode abrir o circuit breaker.
 *
 * Contexto: tickers B3 mortos (EURP11, BDRX11…) retornam HTTP 404 na brapi. Antes,
 * cada 404 virava recordFailure() e ≥5 mortos no lote ABRIAM o breaker, starvando os
 * vivos que vinham depois (BPAN4/CPLE5/JPSA3 ficavam presos inativos por meses). O fix
 * usa validateStatus p/ o 404 RESOLVER em vez de lançar — condição de dado, não de
 * saúde do serviço. 429/5xx/timeout continuam lançando e protegendo o breaker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { externalMarketService } from '../services/externalMarketService.js';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchFromBrapi — breaker vs 404', () => {
  it('N 404s seguidos não abrem o breaker (todos alcançam o axios)', async () => {
    // brapi devolve 404 (validateStatus deixa resolver, não lança).
    axios.get.mockResolvedValue({ status: 404, data: { error: true, message: 'not found' } });

    const N = 8; // > failureThreshold(5): se 404 contasse como falha, o 6º curto-circuitaria
    const out = [];
    for (let i = 0; i < N; i++) {
      out.push(await externalMarketService.fetchFromBrapi('DEAD11.SA'));
    }

    // 404 = sem recuperação → null em todas.
    expect(out.every((r) => r === null)).toBe(true);
    // Prova de que o breaker permaneceu FECHADO: axios foi chamado nas N vezes.
    expect(axios.get).toHaveBeenCalledTimes(N);
  });

  it('200 com preço válido é recuperação normal', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { results: [{ regularMarketPrice: 12.75, regularMarketChangePercent: 1.2, regularMarketVolume: 1000, longName: 'Banco Pan' }] },
    });

    const r = await externalMarketService.fetchFromBrapi('BPAN4.SA');
    expect(r).toMatchObject({ ticker: 'BPAN4', price: 12.75, source: 'BRAPI_FALLBACK' });
  });
});
