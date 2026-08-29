import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatPercent,
  formatCompact,
  formatCalendarDate,
  formatQuantity,
  formatTreasuryUnits,
  formatSharpe,
  describeSharpe,
  PRIVACY_MASK,
  PRIVACY_MASK_SHORT,
} from './format';

// Intl pt-BR usa NBSP (U+00A0) entre símbolo e número; \s casa NBSP e espaço,
// então normalizamos para um espaço comum antes de comparar.
const norm = (s: string) => s.replace(/\s/g, ' ');

describe('formatCurrency', () => {
  it('formata BRL por padrão', () => {
    expect(norm(formatCurrency(4253))).toBe('R$ 4.253,00');
  });
  it('formata USD quando pedido', () => {
    expect(norm(formatCurrency(28, 'USD'))).toBe('US$ 28,00');
  });
  it('trata null/undefined/NaN como 0', () => {
    expect(norm(formatCurrency(null))).toBe('R$ 0,00');
    expect(norm(formatCurrency(undefined))).toBe('R$ 0,00');
    expect(norm(formatCurrency(NaN))).toBe('R$ 0,00');
  });
  it('mascara no modo privacidade', () => {
    expect(formatCurrency(4253, 'BRL', { privacy: true })).toBe(PRIVACY_MASK);
  });
});

describe('formatPercent', () => {
  it('formata com 2 casas em pt-BR', () => {
    expect(formatPercent(6.333)).toBe('6,33%');
  });
  it('prefixa + em positivos com sign', () => {
    expect(formatPercent(6.33, { sign: true })).toBe('+6,33%');
    expect(formatPercent(-6.33, { sign: true })).toBe('-6,33%');
    expect(formatPercent(0, { sign: true })).toBe('0,00%');
  });
  it('respeita decimals custom', () => {
    expect(formatPercent(6.3, { decimals: 1 })).toBe('6,3%');
  });
  it('mascara no modo privacidade', () => {
    expect(formatPercent(6.33, { privacy: true })).toBe(PRIVACY_MASK_SHORT);
  });
});

describe('formatCompact', () => {
  it('compacta milhões em pt-BR', () => {
    expect(norm(formatCompact(1234567))).toBe('R$ 1,2 mi');
  });
  it('suprime símbolo com currency null', () => {
    expect(formatCompact(12345, null)).toMatch(/mil/);
  });
  it('mascara no modo privacidade', () => {
    expect(formatCompact(1234567, 'BRL', { privacy: true })).toBe(PRIVACY_MASK);
  });
});

describe('formatQuantity', () => {
  it('preserva até 8 casas de cripto sem zeros à direita', () => {
    expect(formatQuantity(0.0000028)).toBe('0,0000028');
  });
  it('inteiros sem casas decimais', () => {
    expect(formatQuantity(100)).toBe('100');
  });
  it('mascara no modo privacidade', () => {
    expect(formatQuantity(0.0000028, { privacy: true })).toBe(PRIVACY_MASK_SHORT);
  });
});

describe('formatTreasuryUnits', () => {
  it('corta a fração derivada na granularidade real do Tesouro (0,01 título)', () => {
    expect(formatTreasuryUnits(0.25013766)).toBe('0,25');
    expect(formatTreasuryUnits(0.18349659)).toBe('0,18');
  });
  it('não força casas em quantidade redonda', () => {
    expect(formatTreasuryUnits(2)).toBe('2');
  });
  it('afrouxa a régua abaixo do mínimo negociável em vez de exibir "0"', () => {
    expect(formatTreasuryUnits(0.004)).toBe('0,004');
  });
  it('mascara no modo privacidade', () => {
    expect(formatTreasuryUnits(0.25013766, { privacy: true })).toBe(PRIVACY_MASK_SHORT);
  });
});

describe('formatCalendarDate', () => {
  it('não desloca para o dia anterior um registro legado à meia-noite UTC', () => {
    expect(formatCalendarDate('2026-07-21T00:00:00.000Z')).toBe('21/07/2026');
  });

  it('formata também a nova âncora ao meio-dia UTC e trata inválidos', () => {
    expect(formatCalendarDate('2026-07-21T12:00:00.000Z')).toBe('21/07/2026');
    expect(formatCalendarDate('não-é-data')).toBe('-');
    expect(formatCalendarDate(null)).toBe('-');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('formatCurrency — edge cases', () => {
  it('trata Infinity como 0', () => {
    expect(norm(formatCurrency(Infinity))).toBe('R$ 0,00');
  });
  it('formata valores negativos corretamente', () => {
    expect(norm(formatCurrency(-500))).toBe('-R$ 500,00');
  });
  it('formata zero explícito sem sinal', () => {
    expect(norm(formatCurrency(0))).toBe('R$ 0,00');
  });
});

describe('formatPercent — edge cases', () => {
  it('trata Infinity como 0%', () => {
    expect(formatPercent(Infinity)).toBe('0,00%');
  });
  it('formata percentual negativo', () => {
    expect(formatPercent(-33.33)).toBe('-33,33%');
  });
  it('sign: true com zero não adiciona prefixo +', () => {
    expect(formatPercent(0, { sign: true })).toBe('0,00%');
  });
  it('sign: true com negativo mantém o sinal correto', () => {
    expect(formatPercent(-5, { sign: true })).toBe('-5,00%');
  });
});

describe('formatCompact — edge cases', () => {
  // notation:'compact' com maximumFractionDigits:1 não força casas em inteiros pequenos
  it('valor abaixo de 1.000 não recebe decimais desnecessários', () => {
    expect(norm(formatCompact(999))).toBe('R$ 999');
  });
  it('trata Infinity como 0 (sem decimais em compacto)', () => {
    expect(norm(formatCompact(Infinity))).toBe('R$ 0');
  });
});

describe('formatSharpe', () => {
  it('duas casas — um Sharpe pequeno continua legível como número', () => {
    // Regressão: com toFixed(1) este valor virava "-0.0" e parecia defeito.
    expect(formatSharpe(-0.0168)).toBe('-0,02');
  });
  it('normaliza o zero negativo (nunca exibe "-0,00")', () => {
    expect(formatSharpe(-0.001)).toBe('0,00');
  });
  it('zero é EXIBIDO — carteira que rende o CDI tem Sharpe neutro, não ausente', () => {
    expect(formatSharpe(0)).toBe('0,00');
  });
  it('valor típico mantém as duas casas', () => {
    expect(formatSharpe(1.8)).toBe('1,80');
  });
  it('null/undefined → null (o chamador esconde o badge)', () => {
    expect(formatSharpe(null)).toBeNull();
    expect(formatSharpe(undefined)).toBeNull();
  });
  it('valores não finitos não viram "NaN" na tela', () => {
    expect(formatSharpe(NaN)).toBeNull();
    expect(formatSharpe(Infinity)).toBeNull();
  });
  it('amostra fraca ganha "~" para não passar precisão que não existe', () => {
    expect(formatSharpe(0.58, { confidence: 'LOW' })).toBe('~0,58');
  });
  it('amostra sólida não recebe prefixo', () => {
    expect(formatSharpe(0.58, { confidence: 'HIGH' })).toBe('0,58');
    expect(formatSharpe(0.58, { confidence: 'MODERATE' })).toBe('0,58');
  });
});

describe('describeSharpe', () => {
  it('informa o tamanho da amostra e a margem de erro', () => {
    const texto = describeSharpe({ sample: 79, standardError: 1.79, confidence: 'LOW' });
    expect(texto).toContain('79 pregões');
    expect(texto).toContain('±1,79');
  });
  it('avisa explicitamente quando a amostra é curta', () => {
    expect(describeSharpe({ confidence: 'LOW' })).toContain('indicativo');
  });
  it('sinaliza amostra parcial em confiança média', () => {
    expect(describeSharpe({ confidence: 'MODERATE' })).toContain('menos de 1 ano');
  });
  it('amostra sólida não recebe ressalva', () => {
    const texto = describeSharpe({ sample: 252, standardError: 1.0, confidence: 'HIGH' });
    expect(texto).not.toContain('indicativo');
    expect(texto).not.toContain('menos de 1 ano');
  });
  it('sem dados devolve só a definição, sem inventar números', () => {
    const texto = describeSharpe();
    expect(texto).toContain('Índice de Sharpe');
    expect(texto).not.toContain('±');
    expect(texto).not.toContain('pregões');
  });
});

describe('formatQuantity — edge cases', () => {
  it('trata zero explícito', () => {
    expect(formatQuantity(0)).toBe('0');
  });
  it('respeita maxDecimals personalizado', () => {
    expect(formatQuantity(1.23456789, { maxDecimals: 2 })).toBe('1,23');
  });
  it('trata Infinity como 0', () => {
    expect(formatQuantity(Infinity)).toBe('0');
  });
});
