/**
 * 6.6 — Logs estruturados: o logger expõe um transport JSON pesquisável e aceita
 * metadados como 2º argumento (logger.info(msg, { ...campos })) sem quebrar os
 * call sites antigos que passam só a string.
 */
import { describe, it, expect } from 'vitest';
import logger from '../config/logger.js';

describe('logger estruturado', () => {
  it('expõe um transport de arquivo JSON (combined.json.log)', () => {
    const files = logger.transports.filter((t) => t.filename).map((t) => t.filename);
    expect(files).toContain('combined.json.log');
  });

  it('aceita metadados como 2º argumento sem lançar', () => {
    expect(() => logger.info('teste estruturado', { source: 'spec', count: 1 })).not.toThrow();
  });

  it('mantém compatibilidade com chamadas só de string', () => {
    expect(() => logger.warn('mensagem simples')).not.toThrow();
  });
});
