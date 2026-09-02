import { describe, expect, it, vi } from 'vitest';
import { logAiConfiguration, startApplication } from '../utils/serverStartup.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('startApplication — ordem segura de boot', () => {
  it('com Mongo lento, não abre HTTP nem scheduler antes de cada dependência ficar pronta', async () => {
    const mongo = deferred();
    const http = deferred();
    const server = { on: vi.fn() };
    const connectDB = vi.fn(() => mongo.promise);
    const listen = vi.fn(() => http.promise);
    const initScheduler = vi.fn();

    const boot = startApplication({ connectDB, listen, initScheduler });

    expect(connectDB).toHaveBeenCalledOnce();
    expect(listen).not.toHaveBeenCalled();
    expect(initScheduler).not.toHaveBeenCalled();

    mongo.resolve();
    await vi.waitFor(() => expect(listen).toHaveBeenCalledOnce());
    expect(initScheduler).not.toHaveBeenCalled();

    http.resolve(server);
    await expect(boot).resolves.toBe(server);
    expect(initScheduler).toHaveBeenCalledOnce();
    expect(connectDB.mock.invocationCallOrder[0]).toBeLessThan(listen.mock.invocationCallOrder[0]);
    expect(listen.mock.invocationCallOrder[0]).toBeLessThan(initScheduler.mock.invocationCallOrder[0]);
  });

  it('não inicia scheduler se Mongo ou HTTP falhar', async () => {
    const initScheduler = vi.fn();
    const listen = vi.fn();
    await expect(startApplication({
      connectDB: vi.fn().mockRejectedValue(new Error('Mongo offline')),
      listen,
      initScheduler,
    })).rejects.toThrow('Mongo offline');
    expect(listen).not.toHaveBeenCalled();

    await expect(startApplication({
      connectDB: vi.fn().mockResolvedValue(),
      listen: vi.fn().mockRejectedValue(new Error('HTTP indisponível')),
      initScheduler,
    })).rejects.toThrow('HTTP indisponível');
    expect(initScheduler).not.toHaveBeenCalled();
  });
});

describe('logAiConfiguration — segredo não aparece em logs', () => {
  it('informa somente configurada sem expor prefixo ou chave completa', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const secret = 'ABCD-segredo-que-nao-pode-vazar';

    expect(logAiConfiguration(logger, secret)).toEqual({ configured: true });

    const serializedLogs = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
    expect(serializedLogs).not.toContain(secret);
    expect(serializedLogs).not.toContain('ABCD');
    expect(serializedLogs).toContain('configurada');
  });

  it('avisa quando não configurada', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };

    expect(logAiConfiguration(logger, '')).toEqual({ configured: false });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('não configurada'));
    expect(logger.info).not.toHaveBeenCalled();
  });
});
