import { describe, expect, it } from 'vitest';
import { buyAndHoldReason, weightedComposite } from '../services/engines/buyAndHoldVerdict.js';

const weights = { durability: 0.5, resilience: 0.35, consistency: 0.15 };
const axes = (observed, values = { durability: 80, resilience: 60, consistency: 40 }) => ({ ...values, observed });

describe('buyAndHoldVerdict — composição e motivo', () => {
  it('redistribui o peso dos eixos não observados', () => {
    const all = { durability: true, resilience: true, consistency: true };
    expect(weightedComposite(axes(all), weights)).toBe(67);
    expect(weightedComposite(axes({ ...all, consistency: false }), weights)).toBe(72);
    expect(weightedComposite(axes({}), weights)).toBe(0);
  });

  it('motivo cita o eixo mais fraco entre os observados', () => {
    const observed = { durability: true, resilience: true, consistency: false };
    expect(buyAndHoldReason('BUY', { expensive: false }, 80, axes(observed))).toBe('Âncora segura com preço justo');
    expect(buyAndHoldReason('WAIT', { expensive: true }, 70, axes(observed))).toBe('Âncora segura, porém cara — aguarde preço');
    expect(buyAndHoldReason('WAIT', { expensive: false }, 60, axes(observed)))
      .toBe('Âncora, mas convicção insuficiente (resiliência 60/100)');
    expect(buyAndHoldReason('WAIT', { expensive: true }, 60, axes({})))
      .toBe('Âncora, mas convicção e preço insuficientes');
  });
});
