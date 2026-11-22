import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { supportService, SupportRequestError } from './support';
import { authService } from './auth';
import { collectSupportContext } from '../utils/supportContext';

/**
 * Suporte: a mensagem de regra do servidor chega intacta ao usuário (com
 * `needsNewTicket` e status), o contexto técnico é montado no serviço, falha
 * de fila do Admin NÃO vira lista vazia, e anexo/CSV vão com o token.
 */

vi.mock('../utils/supportContext', () => ({
  collectSupportContext: vi.fn(() => ({ route: '/carteira', recentErrors: [] })),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let apiSpy: ReturnType<typeof vi.spyOn<typeof authService, 'api'>>;

const lastCall = () => {
  const [url, options = {}] = apiSpy.mock.calls.at(-1) ?? ['', {}];
  return { url, method: options.method ?? 'GET', body: options.body ? JSON.parse(String(options.body)) : undefined };
};

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
const createObjectURL = vi.fn((_blob: Blob) => 'blob:obj');
const revokeObjectURL = vi.fn((_url: string) => undefined);

beforeEach(() => {
  apiSpy = vi.spyOn(authService, 'api');
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

describe('supportService — contrato de erro', () => {
  it('a mensagem de regra do servidor chega intacta, com needsNewTicket e status', async () => {
    apiSpy.mockImplementation(async () => json({ message: 'Este ticket foi encerrado. Abra um novo.', needsNewTicket: true }, 409));

    const err = await supportService.reply('t1', 'oi').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SupportRequestError);
    expect(err).toMatchObject({ message: 'Este ticket foi encerrado. Abra um novo.', needsNewTicket: true, status: 409 });
  });

  it('corpo ilegível vira mensagem genérica, sem needsNewTicket', async () => {
    apiSpy.mockImplementation(async () => new Response('<html>', { status: 502 }));
    await expect(supportService.getTicket('t1')).rejects.toMatchObject({
      name: 'SupportRequestError',
      message: 'Não foi possível completar a operação.',
      needsNewTicket: false,
      status: 502,
    });
  });

  it('falha da fila do Admin rejeita — "nenhum ticket" nunca é inventado', async () => {
    apiSpy.mockImplementation(async () => json({}, 500));
    await expect(supportService.adminList()).rejects.toBeInstanceOf(SupportRequestError);
    await expect(supportService.adminSummary()).rejects.toBeInstanceOf(SupportRequestError);
  });
});

describe('supportService — usuário', () => {
  it('listMyTickets tolera resposta sem a chave tickets', async () => {
    apiSpy.mockImplementationOnce(async () => json({ tickets: [{ code: 'VT-0001' }] }));
    await expect(supportService.listMyTickets()).resolves.toEqual([{ code: 'VT-0001' }]);
    apiSpy.mockImplementationOnce(async () => json({}));
    await expect(supportService.listMyTickets()).resolves.toEqual([]);
  });

  it('createTicket anexa o contexto técnico montado aqui, não pela tela', async () => {
    apiSpy.mockImplementation(async () => json({ code: 'VT-0042' }));

    await supportService.createTicket({ category: 'BUG', subject: 'Erro', body: 'Quebrou', relatedTicket: 't0' });

    expect(collectSupportContext).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual({
      url: '/api/support/tickets',
      method: 'POST',
      body: {
        category: 'BUG', subject: 'Erro', body: 'Quebrou', relatedTicket: 't0',
        context: { route: '/carteira', recentErrors: [] },
      },
    });
  });

  it('reply manda corpo e anexos (lista vazia por padrão)', async () => {
    apiSpy.mockImplementation(async () => json({ ticket: {}, reopened: false }));
    await supportService.reply('t1', 'mais detalhes');
    expect(lastCall()).toEqual({ url: '/api/support/tickets/t1/reply', method: 'POST', body: { body: 'mais detalhes', attachments: [] } });
  });
});

describe('supportService — anexos', () => {
  it('baixa com o token uma vez e reaproveita o object URL', async () => {
    apiSpy.mockImplementation(async () => new Response('png', { status: 200 }));

    const first = await supportService.loadAttachment('att-cache');
    const second = await supportService.loadAttachment('att-cache');

    expect(first).toBe('blob:obj');
    expect(second).toBe('blob:obj');
    expect(apiSpy).toHaveBeenCalledTimes(1);
    expect(lastCall().url).toBe('/api/support/attachments/att-cache');
  });

  it('anexo apagado pela retenção devolve o 404 para a tela distinguir de falha de rede', async () => {
    apiSpy.mockImplementation(async () => json({}, 404));
    await expect(supportService.loadAttachment('att-404')).rejects.toMatchObject({ message: 'Anexo indisponível.', status: 404 });
    // Falha não entra no cache: a próxima tentativa vai ao servidor de novo.
    await expect(supportService.loadAttachment('att-404')).rejects.toBeInstanceOf(SupportRequestError);
    expect(apiSpy).toHaveBeenCalledTimes(2);
  });
});

describe('supportService — Admin', () => {
  it('filtros vazios, undefined e ALL não vão para a query', async () => {
    apiSpy.mockImplementation(async () => json({ total: 0, tickets: [] }));

    await supportService.adminList({ status: 'ALL', category: 'BUG', priority: '', search: 'pix', limit: 20, skip: undefined });
    expect(lastCall().url).toBe('/api/support/admin/tickets?category=BUG&search=pix&limit=20');

    await supportService.adminList();
    expect(lastCall().url).toBe('/api/support/admin/tickets');
  });

  it.each([
    ['adminGet', () => supportService.adminGet('t1'), { url: '/api/support/admin/tickets/t1', method: 'GET', body: undefined }],
    ['adminReply (nota interna)', () => supportService.adminReply('t1', { body: 'ver log', isInternal: true, newStatus: 'EM_ANALISE' }), {
      url: '/api/support/admin/tickets/t1/reply', method: 'POST', body: { body: 'ver log', isInternal: true, newStatus: 'EM_ANALISE' },
    }],
    ['adminUpdate', () => supportService.adminUpdate('t1', { priority: 'ALTA', internalTags: ['pix'] }), {
      url: '/api/support/admin/tickets/t1', method: 'PUT', body: { priority: 'ALTA', internalTags: ['pix'] },
    }],
    ['adminDelete', () => supportService.adminDelete('t1'), { url: '/api/support/admin/tickets/t1', method: 'DELETE', body: undefined }],
  ] as const)('%s', async (_n, call, expected) => {
    apiSpy.mockImplementation(async () => json({ ok: true }));
    await expect(call()).resolves.toEqual({ ok: true });
    expect(lastCall()).toEqual(expected);
  });

  it('CSV sai com o filtro corrente e nome datado do dia', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T15:00:00Z'));
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    apiSpy.mockImplementation(async () => new Response('code;subject', { status: 200 }));

    await supportService.adminDownloadCsv({ status: 'ABERTO', category: 'ALL' });

    expect(lastCall().url).toBe('/api/support/admin/export.csv?status=ABERTO');
    expect(names).toEqual(['tickets-2026-11-22.csv']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:obj');
  });

  it('CSV com falha não baixa arquivo de erro', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    apiSpy.mockImplementation(async () => json({}, 500));
    await expect(supportService.adminDownloadCsv()).rejects.toThrow('Não foi possível gerar o CSV.');
    expect(click).not.toHaveBeenCalled();
  });
});
