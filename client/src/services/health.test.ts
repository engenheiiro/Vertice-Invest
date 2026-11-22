import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { healthService } from './health';
import { authService } from './auth';

/**
 * Saúde dos dados (Admin): leitura degrada (null / lista vazia), mas o
 * recálculo e o "marcar como tratado" nunca fingem sucesso.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let apiSpy: ReturnType<typeof vi.spyOn<typeof authService, 'api'>>;

beforeEach(() => {
  apiSpy = vi.spyOn(authService, 'api');
});

afterEach(() => vi.restoreAllMocks());

describe('healthService', () => {
  it('getDataHealth devolve o relatório, ou null quando o servidor falha', async () => {
    apiSpy.mockImplementationOnce(async () => json({ report: null, history: [], jobs: [] }));
    await expect(healthService.getDataHealth()).resolves.toEqual({ report: null, history: [], jobs: [] });
    apiSpy.mockImplementationOnce(async () => json({ message: 'x' }, 500));
    await expect(healthService.getDataHealth()).resolves.toBeNull();
  });

  it('runNow devolve só o relatório recalculado', async () => {
    apiSpy.mockImplementation(async () => json({ report: { status: 'OK' }, extra: 1 }));
    await expect(healthService.runNow()).resolves.toEqual({ status: 'OK' });
    expect(apiSpy.mock.calls[0]).toEqual(['/api/research/data-health/run', { method: 'POST' }]);
  });

  it('runNow rejeita com a mensagem do servidor ou a padrão', async () => {
    apiSpy.mockImplementationOnce(async () => json({ message: 'Sentinela já em execução' }, 409));
    await expect(healthService.runNow()).rejects.toThrow('Sentinela já em execução');
    apiSpy.mockImplementationOnce(async () => new Response('x', { status: 502 }));
    await expect(healthService.runNow()).rejects.toThrow('Falha ao reavaliar a saúde dos dados.');
  });

  it('listErrors filtra pela origem codificada e degrada para lista vazia', async () => {
    apiSpy.mockImplementationOnce(async () => json({ errors: [{ _id: 'e1' }], unresolvedCount: 1 }));
    await expect(healthService.listErrors('JOB')).resolves.toEqual({ errors: [{ _id: 'e1' }], unresolvedCount: 1 });
    expect(apiSpy.mock.calls[0][0]).toBe('/api/research/errors?origin=JOB');

    apiSpy.mockImplementationOnce(async () => json({}, 500));
    await expect(healthService.listErrors()).resolves.toEqual({ errors: [], unresolvedCount: 0 });
    expect(apiSpy.mock.calls[1][0]).toBe('/api/research/errors');
  });

  it('resolveError rejeita quando o servidor recusa', async () => {
    apiSpy.mockImplementationOnce(async () => json({ ok: true }));
    await expect(healthService.resolveError('e1')).resolves.toBeUndefined();
    expect(apiSpy.mock.calls[0]).toEqual(['/api/research/errors/e1/resolve', { method: 'POST' }]);

    apiSpy.mockImplementationOnce(async () => json({ message: 'Erro não encontrado' }, 404));
    await expect(healthService.resolveError('e2')).rejects.toThrow('Erro não encontrado');
    apiSpy.mockImplementationOnce(async () => new Response('x', { status: 500 }));
    await expect(healthService.resolveError('e3')).rejects.toThrow('Falha ao marcar erro como tratado.');
  });
});
