/**
 * Composição e veredito do score Buy-and-Hold (`scoreBuyAndHold` em
 * buyAndHoldEngine.js): média ponderada só dos eixos observados e o texto do
 * motivo publicado. Puras, sem I/O.
 */

import { BUY_THRESHOLD } from '../../config/financialConstants.js';

const AXIS_LABELS = Object.freeze({ durability: 'durabilidade', resilience: 'resiliência', consistency: 'consistência' });

/** Peso dos eixos não observados é redistribuído; nenhum observado => 0. */
export const weightedComposite = (axes, weights) => {
  const activeWeight = (axes.observed.durability ? weights.durability : 0)
    + (axes.observed.resilience ? weights.resilience : 0)
    + (axes.observed.consistency ? weights.consistency : 0);

  const weightedSum = (axes.observed.durability ? axes.durability * weights.durability : 0)
    + (axes.observed.resilience ? axes.resilience * weights.resilience : 0)
    + (axes.observed.consistency ? axes.consistency * weights.consistency : 0);

  return activeWeight > 0 ? Math.round(weightedSum / activeWeight) : 0;
};

// Limitante é o eixo mais fraco — considerando só os eixos efetivamente medidos.
const weakestAxisSuffix = axes => {
  const weakest = ['durability', 'resilience', 'consistency']
    .filter(key => axes.observed[key])
    .map(key => [AXIS_LABELS[key], axes[key]])
    .sort((a, b) => a[1] - b[1])[0];
  return weakest ? ` (${weakest[0]} ${weakest[1]}/100)` : '';
};

export const buyAndHoldReason = (action, entry, composite, axes) => {
  if (action === 'BUY') return 'Âncora segura com preço justo';
  // Convição de negócio suficiente; só o preço segura o BUY.
  if (entry.expensive && composite >= BUY_THRESHOLD) return 'Âncora segura, porém cara — aguarde preço';
  const suffix = weakestAxisSuffix(axes);
  return entry.expensive
    ? `Âncora, mas convicção e preço insuficientes${suffix}`
    : `Âncora, mas convicção insuficiente${suffix}`;
};
