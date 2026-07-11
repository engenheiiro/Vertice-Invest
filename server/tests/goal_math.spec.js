import { describe, it, expect } from 'vitest';
import { annualToMonthly, fv, monthsRemaining, requiredMonthly, decomposeProgress, monthsSaved, computeStreak, resolveGoalStatus } from '../utils/goalMath.js';

describe('goalMath', () => {
  describe('annualToMonthly', () => {
    it('converte 12,68% a.a. em ~1% a.m.', () => {
      expect(annualToMonthly(12.6825)).toBeCloseTo(0.01, 4);
    });
    it('taxa zero → 0', () => {
      expect(annualToMonthly(0)).toBe(0);
    });
  });

  describe('fv', () => {
    it('sem juros é progressão linear', () => {
      expect(fv(0, 12, 1000, 100)).toBe(2200); // 1000 + 100*12
    });
    it('cresce com juros compostos sobre aportes', () => {
      // 10% a.m., 12 meses, PV 0, PMT 100 → soma de PG
      const v = fv(0.1, 12, 0, 100);
      expect(v).toBeGreaterThan(1200); // mais que a soma nominal dos aportes
    });
  });

  describe('monthsRemaining', () => {
    it('retorna 0 quando já atingiu o alvo', () => {
      expect(monthsRemaining(1_000_000, 2000, 10, 1_000_000)).toBe(0);
      expect(monthsRemaining(1_200_000, 2000, 10, 1_000_000)).toBe(0);
    });

    it('R$2k/mês a 10% a.a. chega a R$1M em ~17 anos; a ~14% (CDI) cai p/ ~15', () => {
      const at10 = monthsRemaining(0, 2000, 10, 1_000_000);
      expect(at10).toBeGreaterThan(195);
      expect(at10).toBeLessThan(210); // ~202 meses
      const at14 = monthsRemaining(0, 2000, 14, 1_000_000);
      expect(at14).toBeGreaterThan(170);
      expect(at14).toBeLessThan(190); // ~180 meses (≈15 anos, como na Calculadora)
    });

    it('sem juros usa progressão linear', () => {
      // r=0 → (1.000.000 - 0) / 2000 = 500 meses
      expect(monthsRemaining(0, 2000, 0, 1_000_000)).toBe(500);
    });

    it('aporte zero sem patrimônio inicial → Infinity', () => {
      expect(monthsRemaining(0, 0, 10, 1_000_000)).toBe(Infinity);
    });

    it('aporte zero mas patrimônio cresce só com juros', () => {
      const n = monthsRemaining(500_000, 0, 10, 1_000_000);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    });

    it('sem juros e sem aporte → Infinity', () => {
      expect(monthsRemaining(100, 0, 0, 1_000_000)).toBe(Infinity);
    });
  });

  describe('requiredMonthly', () => {
    it('prazo no passado/hoje → Infinity', () => {
      expect(requiredMonthly(0, 10, 1_000_000, 0)).toBe(Infinity);
      expect(requiredMonthly(0, 10, 1_000_000, -5)).toBe(Infinity);
    });

    it('retorna 0 se o patrimônio já alcança a meta no prazo', () => {
      expect(requiredMonthly(1_000_000, 10, 1_000_000, 12)).toBe(0);
      // PV já cresce sozinho até o alvo dentro do prazo
      expect(requiredMonthly(990_000, 10, 1_000_000, 12)).toBe(0);
    });

    it('sem juros divide o gap pelos meses', () => {
      expect(requiredMonthly(0, 0, 120_000, 12)).toBe(10_000);
    });

    it('com juros o aporte necessário é menor que o linear', () => {
      const linear = 1_000_000 / 180;
      const withRate = requiredMonthly(0, 10, 1_000_000, 180);
      expect(withRate).toBeGreaterThan(0);
      expect(withRate).toBeLessThan(linear);
    });
  });

  describe('decomposeProgress', () => {
    it('separa aporte e mercado', () => {
      const d = decomposeProgress(10_000, 13_000, 2000);
      expect(d.totalChange).toBe(3000);
      expect(d.fromContribution).toBe(2000);
      expect(d.fromMarket).toBe(1000);
    });

    it('mercado negativo quando o patrimônio cai apesar do aporte', () => {
      const d = decomposeProgress(10_000, 11_000, 2000);
      expect(d.fromMarket).toBe(-1000);
    });
  });

  describe('monthsSaved', () => {
    it('aumentar o aporte reduz os meses (> 0)', () => {
      const saved = monthsSaved(0, 2000, 10, 1_000_000, 1000);
      expect(saved).toBeGreaterThan(0);
    });

    it('delta zero não economiza nada', () => {
      expect(monthsSaved(0, 2000, 10, 1_000_000, 0)).toBe(0);
    });

    it('delta negativo (aporte menor) não retorna ganho', () => {
      expect(monthsSaved(0, 2000, 10, 1_000_000, -500)).toBe(0);
    });

    it('sai de "sem caminho" para finito → Infinity de ganho', () => {
      // pmt=0 e pv=0 → nunca chega; com delta passa a ter caminho.
      expect(monthsSaved(0, 0, 10, 1_000_000, 2000)).toBe(Infinity);
    });
  });

  describe('computeStreak', () => {
    it('todos os meses positivos contam', () => {
      expect(computeStreak([100, 200, 300])).toBe(3);
    });

    it('conta apenas a sequência final (zero no meio corta)', () => {
      expect(computeStreak([100, 0, 200, 300])).toBe(2);
    });

    it('último mês sem aporte → streak 0', () => {
      expect(computeStreak([100, 200, 0])).toBe(0);
    });

    it('lista vazia ou inválida → 0', () => {
      expect(computeStreak([])).toBe(0);
      expect(computeStreak(null)).toBe(0);
    });
  });

  describe('resolveGoalStatus', () => {
    it('ACTIVE → ACHIEVED ao cruzar o alvo (marca achievedAt)', () => {
      const d = resolveGoalStatus('ACTIVE', 100_000, 100, 100_000, 75);
      expect(d.changed).toBe(true);
      expect(d.status).toBe('ACHIEVED');
      expect(d.achievedAtAction).toBe('set');
    });

    it('ACTIVE abaixo do alvo permanece ACTIVE', () => {
      const d = resolveGoalStatus('ACTIVE', 90_000, 90, 100_000, 75);
      expect(d.changed).toBe(false);
      expect(d.status).toBe('ACTIVE');
    });

    it('ACHIEVED dentro da banda de histerese (98–100%) NÃO reverte', () => {
      // 99% do alvo — cairia se a reversão fosse exata em 100%, mas a histerese segura.
      const d = resolveGoalStatus('ACHIEVED', 99_000, 99, 100_000, 100);
      expect(d.changed).toBe(false);
      expect(d.status).toBe('ACHIEVED');
    });

    it('ACHIEVED → ACTIVE ao cair abaixo de 98% (limpa achievedAt, rebaixa marco)', () => {
      // 96% do alvo → reverte; marco 100 volta pra 75 (maior múltiplo ainda alcançado).
      const d = resolveGoalStatus('ACHIEVED', 96_000, 96, 100_000, 100);
      expect(d.changed).toBe(true);
      expect(d.status).toBe('ACTIVE');
      expect(d.achievedAtAction).toBe('clear');
      expect(d.lastCelebratedMilestone).toBe(75);
    });

    it('não rebaixa o marco quando ele já é ≤ ao maior alcançado', () => {
      // caiu forte pra 40% mas o marco salvo já era 25 → mantém (nada a rebaixar).
      const d = resolveGoalStatus('ACHIEVED', 40_000, 40, 100_000, 25);
      expect(d.status).toBe('ACTIVE');
      expect(d.lastCelebratedMilestone).toBe(null);
    });

    it('exatamente no alvo (100%) conta como conquistado', () => {
      const d = resolveGoalStatus('ACTIVE', 100_000, 100, 100_000, 0);
      expect(d.status).toBe('ACHIEVED');
    });

    it('alvo zero não promove (evita divisão/estado inválido)', () => {
      const d = resolveGoalStatus('ACTIVE', 0, 0, 0, 0);
      expect(d.changed).toBe(false);
    });
  });
});
