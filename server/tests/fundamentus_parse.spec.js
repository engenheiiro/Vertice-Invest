/**
 * T5 — fundamentusService: parsing de números no formato brasileiro.
 * parseBrFloat normaliza os valores raspados do Fundamentus (milhar com ponto,
 * decimal com vírgula, sufixo %, traço como "sem dado") para Number seguro.
 */
import { describe, it, expect } from 'vitest';
import { parseBrFloat } from '../services/fundamentusService.js';

describe('parseBrFloat — formato brasileiro', () => {
  it('converte milhar (ponto) + decimal (vírgula)', () => {
    expect(parseBrFloat('1.234,56')).toBe(1234.56);
    expect(parseBrFloat('12.500.000,00')).toBe(12500000);
  });

  it('converte percentual removendo o símbolo %', () => {
    expect(parseBrFloat('12,50%')).toBe(12.5);
    expect(parseBrFloat('110,00%')).toBe(110);
  });

  it('trata traço "-" e vazio como 0 (sem dado)', () => {
    expect(parseBrFloat('-')).toBe(0);
    expect(parseBrFloat('  -  ')).toBe(0);
    expect(parseBrFloat('')).toBe(0);
    expect(parseBrFloat(null)).toBe(0);
    expect(parseBrFloat(undefined)).toBe(0);
  });

  it('lida com negativos e decimal simples', () => {
    expect(parseBrFloat('-5,25')).toBe(-5.25);
    expect(parseBrFloat('0,00')).toBe(0);
    expect(parseBrFloat('38,5')).toBe(38.5);
  });

  it('retorna 0 para texto não numérico (não NaN)', () => {
    expect(parseBrFloat('N/A')).toBe(0);
    expect(parseBrFloat('abc')).toBe(0);
  });
});
