/**
 * 6.6 — Logs estruturados: o logger expõe um transport JSON pesquisável e aceita
 * metadados como 2º argumento (logger.info(msg, { ...campos })) sem quebrar os
 * call sites antigos que passam só a string.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import logger from '../config/logger.js';

// Reimporta o logger com o ambiente alterado (o nível é resolvido na carga).
const loadLogger = async (env) => {
  vi.resetModules();
  Object.assign(process.env, env);
  const mod = await import('../config/logger.js');
  return mod.default;
};

const consoleTransport = (instance) => instance.transports.find((t) => !t.filename);

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

describe('nível configurável por .env', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env.LOG_LEVEL = original.LOG_LEVEL;
    process.env.CONSOLE_LOG_LEVEL = original.CONSOLE_LOG_LEVEL;
    process.env.NODE_ENV = original.NODE_ENV;
    if (original.LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
    if (original.CONSOLE_LOG_LEVEL === undefined) delete process.env.CONSOLE_LOG_LEVEL;
  });

  it('LOG_LEVEL sobrepõe o padrão em todos os transports', async () => {
    const fresh = await loadLogger({ LOG_LEVEL: 'info', CONSOLE_LOG_LEVEL: '' });
    expect(fresh.level).toBe('info'); // `http` (access log) deixa de passar
    expect(consoleTransport(fresh).level).toBe('info');
  });

  it('CONSOLE_LOG_LEVEL limpa só o terminal — os arquivos seguem no nível cheio', async () => {
    const fresh = await loadLogger({ LOG_LEVEL: 'debug', CONSOLE_LOG_LEVEL: 'info' });
    expect(fresh.level).toBe('debug'); // combined.log continua com o access log
    expect(consoleTransport(fresh).level).toBe('info');
  });

  it('nível inválido cai no padrão — não pode apagar log de erro em produção', async () => {
    const fresh = await loadLogger({ LOG_LEVEL: 'silencioso', CONSOLE_LOG_LEVEL: '', NODE_ENV: 'production' });
    expect(fresh.level).toBe('info');
  });
});
