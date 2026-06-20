/**
 * (6.1) Tratador de erros estruturado.
 * Verifica a montagem da resposta { message, error: { code, message, details,
 * requestId } } a partir de erros variados: AppError, status/httpStatus legado,
 * erros nativos do Mongoose/JWT e erro genérico (fallback 500). Também cobre o
 * middleware errorHandler escrevendo status + body.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildErrorResponse, errorHandler } from '../middleware/errorHandler.js';
import AppError from '../utils/AppError.js';

describe('buildErrorResponse', () => {
  it('mapeia um AppError (status + code + details)', () => {
    const err = AppError.badRequest('Dados incompletos.', { fields: ['ticker'] });
    const { status, body } = buildErrorResponse(err, 'req-1');
    expect(status).toBe(400);
    expect(body.message).toBe('Dados incompletos.');
    expect(body.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Dados incompletos.',
      details: { fields: ['ticker'] },
      requestId: 'req-1',
    });
  });

  it('honra o legado err.httpStatus (txError)', () => {
    const err = Object.assign(new Error('Ativo não encontrado'), { httpStatus: 404 });
    const { status, body } = buildErrorResponse(err);
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeUndefined();
  });

  it('infere 409 DUPLICATE_KEY do erro de chave duplicada do Mongo', () => {
    const err = Object.assign(new Error('E11000 dup key'), { code: 11000, keyValue: { email: 'a@b.com' } });
    const { status, body } = buildErrorResponse(err);
    expect(status).toBe(409);
    expect(body.error.code).toBe('DUPLICATE_KEY');
    expect(body.error.details).toEqual({ fields: ['email'] });
  });

  it('mapeia ValidationError do Mongoose com detalhes por campo', () => {
    const err = Object.assign(new Error('Validation failed'), {
      name: 'ValidationError',
      errors: { quantity: { path: 'quantity', message: 'obrigatório' } },
    });
    const { status, body } = buildErrorResponse(err);
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([{ field: 'quantity', message: 'obrigatório' }]);
  });

  it('mapeia token JWT inválido para 401', () => {
    const err = Object.assign(new Error('jwt malformed'), { name: 'JsonWebTokenError' });
    const { status, body } = buildErrorResponse(err);
    expect(status).toBe(401);
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  it('cai para 500 INTERNAL_ERROR em erro genérico', () => {
    const { status, body } = buildErrorResponse(new Error('boom'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('boom');
  });

  it('usa mensagem padrão quando o erro não tem message', () => {
    const { body } = buildErrorResponse({});
    expect(body.message).toBe('Erro interno no servidor.');
  });
});

describe('errorHandler (middleware)', () => {
  it('escreve status e body na resposta', () => {
    const err = AppError.notFound('Sumiu');
    const req = { requestId: 'rid-9' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    errorHandler(err, req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Sumiu',
      error: expect.objectContaining({ code: 'NOT_FOUND', requestId: 'rid-9' }),
    }));
  });
});
