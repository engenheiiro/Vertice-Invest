import { describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency } from '../utils/concurrency.js';

describe('Fase 3 — concorrência limitada', () => {
  it('nunca ultrapassa o teto e preserva a ordem do resultado', async () => {
    let active = 0;
    let peak = 0;
    const releases = [];

    const promise = mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return value * 10;
    });

    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases.splice(0, 3).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases.splice(0, 3).forEach((release) => release());

    await expect(promise).resolves.toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(3);
  });
});
