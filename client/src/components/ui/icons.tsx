import { createLucideIcon } from 'lucide-react';

/**
 * Ícones do mockup que não têm equivalente exato na lucide.
 *
 * São construídos com a FÁBRICA da própria lucide (`createLucideIcon`), não como
 * SVG solto: mesma viewBox 24, mesma espessura/terminação de traço e a mesma API
 * de props (`size`, `strokeWidth`, `className`) do resto do app. Assim o desenho
 * vem do mockup sem sair do sistema de ícones que o projeto adota.
 */

/**
 * Pizza FECHADA dividida em fatias — aba "Visão Geral" da Carteira.
 *
 * A `PieChart` da lucide desenha um arco ABERTO com uma fatia destacada para
 * fora; o mockup usa o círculo inteiro cortado por dois raios, que lê como
 * "distribuição completa" em vez de "uma fatia". Os raios param antes da
 * circunferência de propósito (é o traçado do mockup): a folga evita que os
 * três traços se encontrem num nó preto em 16px.
 */
export const PieSlices = createLucideIcon('PieSlices', [
    ['circle', { cx: '12', cy: '12', r: '9', key: 'pie-slices-ring' }],
    ['path', { d: 'M12 12V4', key: 'pie-slices-radius-up' }],
    ['path', { d: 'M12 12l6 4', key: 'pie-slices-radius-down' }],
]);
