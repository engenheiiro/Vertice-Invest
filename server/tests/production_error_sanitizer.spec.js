import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildErrorResponse } from '../middleware/errorHandler.js';
import { productionErrorSanitizer } from '../middleware/productionErrorSanitizer.js';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => { process.env.NODE_ENV = originalNodeEnv; });

describe('sanitização de erros internos em produção', () => {
  it('não devolve a mensagem original no errorHandler', () => {
    process.env.NODE_ENV = 'production';
    const { status, body } = buildErrorResponse(new Error('Mongo connection string leaked'), 'request-1');

    expect(status).toBe(500);
    expect(body.message).toBe('Erro interno no servidor.');
    expect(body.error.message).toBe('Erro interno no servidor.');
    expect(JSON.stringify(body)).not.toContain('Mongo connection string leaked');
  });

  it('sanitiza respostas 5xx diretas de controllers legados', () => {
    process.env.NODE_ENV = 'production';
    const req = { requestId: 'request-2' };
    const json = vi.fn();
    const res = { statusCode: 500, json };

    productionErrorSanitizer(req, res, () => {});
    res.json({ message: 'falha SMTP: senha exposta', error: 'senha exposta' });

    expect(json).toHaveBeenCalledWith({
      message: 'Erro interno no servidor.',
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno no servidor.', requestId: 'request-2' },
    });
  });
});
