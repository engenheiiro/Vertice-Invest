/**
 * (D12) Access log: a linha de request concluída não pode carregar a query string
 * crua — é entrada do cliente e o log vai para console e arquivo em disco.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import logger from '../config/logger.js';
import { accessLog } from '../middleware/accessLog.js';

// Dispara o middleware e devolve os argumentos com que logger.http foi chamado
// (ou null se a request foi ignorada).
const runRequest = (req, statusCode = 200) => {
  const spy = vi.spyOn(logger, 'http').mockImplementation(() => logger);
  const res = new EventEmitter();
  res.statusCode = statusCode;
  const next = vi.fn();

  accessLog(req, res, next);
  expect(next).toHaveBeenCalled();
  res.emit('finish');

  return spy.mock.calls[0] || null;
};

afterEach(() => vi.restoreAllMocks());

describe('accessLog', () => {
  it('loga método, rota e status — sem a query string', () => {
    const call = runRequest({
      method: 'GET',
      path: '/api/wallet',
      originalUrl: '/api/wallet?walletId=6a4b7191492b10e777d5be52&token=segredo',
      query: { walletId: '6a4b7191492b10e777d5be52', token: 'segredo' },
    });

    expect(call).not.toBeNull();
    const [message] = call;
    expect(message).toBe('GET /api/wallet 200');
    expect(message).not.toContain('?');
    expect(message).not.toContain('segredo');
  });

  it('leva duração e carteira RESOLVIDA como metadados estruturados', () => {
    const [, meta] = runRequest({
      method: 'GET',
      path: '/api/wallet',
      query: { walletId: 'ignorado\ninjeção de linha falsa' },
      walletId: '6a4b7191492b10e777d5be52', // resolvido por resolveWallet
    });

    expect(typeof meta.ms).toBe('number');
    expect(meta.walletId).toBe('6a4b7191492b10e777d5be52');
  });

  it('omite walletId em rotas fora do escopo de carteira', () => {
    const [message, meta] = runRequest({ method: 'POST', path: '/api/login', query: {} }, 401);
    expect(message).toBe('POST /api/login 401');
    expect(meta).not.toHaveProperty('walletId');
  });

  it('ignora health check e docs', () => {
    expect(runRequest({ method: 'GET', path: '/api/health', query: {} })).toBeNull();
    expect(runRequest({ method: 'GET', path: '/api/docs.json', query: {} })).toBeNull();
  });
});
