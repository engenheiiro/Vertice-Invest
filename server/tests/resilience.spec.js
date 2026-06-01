/**
 * I4 — resiliência (withRetry + CircuitBreaker).
 * Tempos curtos para rodar rápido; valida re-tentativa, shouldRetry, abertura do
 * circuito após o limiar, fast-fail durante o cooldown e recuperação via HALF_OPEN.
 */
import { describe, it, expect, vi } from 'vitest';
import { withRetry, CircuitBreaker, createCircuitBreaker } from '../utils/resilience.js';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('withRetry', () => {
  it('retorna no primeiro sucesso sem re-tentar', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const r = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-tenta até suceder', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('y'))
      .mockResolvedValue('ok');
    const r = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('propaga o último erro após esgotar as tentativas', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('não re-tenta quando shouldRetry retorna false', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('4xx'), { status: 400 }));
    const shouldRetry = (e) => e.status >= 500;
    await expect(withRetry(fn, { retries: 5, baseDelayMs: 1, shouldRetry })).rejects.toThrow('4xx');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('CircuitBreaker', () => {
  it('abre após atingir o limiar e faz fast-fail (sem chamar fn)', async () => {
    const cb = new CircuitBreaker({ name: 't', failureThreshold: 3, cooldownMs: 1000 });
    const failing = vi.fn().mockRejectedValue(new Error('down'));

    // 3 falhas → abre
    for (let i = 0; i < 3; i++) {
      await expect(cb.exec(failing)).rejects.toThrow('down');
    }
    expect(cb.state).toBe('OPEN');

    // 4ª chamada: circuito aberto → não chama fn, lança ERR_CIRCUIT_OPEN
    failing.mockClear();
    await expect(cb.exec(failing)).rejects.toMatchObject({ code: 'ERR_CIRCUIT_OPEN' });
    expect(failing).not.toHaveBeenCalled();
  });

  it('usa fallback em vez de lançar quando aberto', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    await cb.exec(() => Promise.reject(new Error('x')), null); // abre (fallback null)
    expect(cb.state).toBe('OPEN');
    const r = await cb.exec(() => Promise.resolve('nunca'), 'fb');
    expect(r).toBe('fb');
  });

  it('HALF_OPEN após cooldown: sucesso fecha o circuito', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 30 });
    await expect(cb.exec(() => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(cb.state).toBe('OPEN');

    await sleep(45); // passa o cooldown
    const r = await cb.exec(() => Promise.resolve('ok')); // HALF_OPEN → sucesso
    expect(r).toBe('ok');
    expect(cb.state).toBe('CLOSED');
    expect(cb.failures).toBe(0);
  });

  it('HALF_OPEN com nova falha reabre o circuito', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 30 });
    await expect(cb.exec(() => Promise.reject(new Error('x')))).rejects.toThrow();
    await sleep(45);
    await expect(cb.exec(() => Promise.reject(new Error('y')))).rejects.toThrow('y');
    expect(cb.state).toBe('OPEN');
  });

  it('sucesso reseta o contador de falhas (não acumula até abrir)', async () => {
    const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    await expect(cb.exec(() => Promise.reject(new Error('1')))).rejects.toThrow();
    await expect(cb.exec(() => Promise.reject(new Error('2')))).rejects.toThrow();
    await cb.exec(() => Promise.resolve('ok')); // reseta
    expect(cb.failures).toBe(0);
    await expect(cb.exec(() => Promise.reject(new Error('3')))).rejects.toThrow();
    expect(cb.state).toBe('CLOSED'); // só 1 falha após o reset
  });
});
