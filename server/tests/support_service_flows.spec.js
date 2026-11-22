/**
 * Fluxos do serviço de atendimento: abrir, responder (usuário e admin), editar,
 * fila do Admin e anonimização por exclusão de conta.
 *
 * As regras puras (`utils/supportRules.js`) são as reais; só o I/O é falso. O
 * modelo SupportTicket é uma classe mínima com `messages[]` e `save()`, para o
 * teste enxergar exatamente o que seria gravado. Notificação e e-mail são
 * falsos — nada sai daqui.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    userFindById: vi.fn(),
    countDocuments: vi.fn(),
    exists: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    find: vi.fn(),
    aggregate: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn(),
    counter: vi.fn(),
    insertMany: vi.fn(),
    attDeleteMany: vi.fn(),
    assetCount: vi.fn(),
    notify: vi.fn(),
    email: vi.fn(),
    saveImpl: null,
    created: [],
}));

vi.mock('../models/SupportTicket.js', () => {
    class FakeTicket {
        constructor(data) {
            Object.assign(this, { _id: 'tk-new', messages: [] }, data);
            m.created.push(this);
        }
        async save() { return m.saveImpl ? m.saveImpl(this) : this; }
        toObject() { return { ...this }; }
    }
    Object.assign(FakeTicket, {
        countDocuments: m.countDocuments, exists: m.exists, findOne: m.findOne, findById: m.findById,
        find: m.find, aggregate: m.aggregate, updateOne: m.updateOne, updateMany: m.updateMany,
    });
    return { default: FakeTicket };
});
vi.mock('../models/SupportAttachment.js', () => ({ default: { insertMany: m.insertMany, deleteMany: m.attDeleteMany } }));
vi.mock('../models/SupportCounter.js', () => ({ default: { findOneAndUpdate: m.counter } }));
vi.mock('../models/User.js', () => ({ default: { findById: m.userFindById } }));
vi.mock('../models/UserAsset.js', () => ({ default: { countDocuments: m.assetCount } }));
vi.mock('../services/notificationService.js', () => ({ createNotification: m.notify }));
vi.mock('../services/emailService.js', () => ({ sendSupportReplyEmail: m.email }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const svc = await import('../services/supportService.js');
const { SupportError } = svc;

const USER_ID = '64b7f0c2a1b2c3d4e5f60718';
const OTHER_TICKET = '64b7f0c2a1b2c3d4e5f60799';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const NOW = new Date('2026-11-22T12:00:00Z');

const chain = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });

const fakeTicket = (data) => ({
    _id: 'tk-1', code: 'VT-0007', user: USER_ID, userName: 'Ana', userEmail: 'ana@example.test', subject: 'Preço',
    messages: [], save: vi.fn(async () => {}), ...data,
});

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    Object.values(m).forEach((v) => v?.mockReset?.());
    m.saveImpl = null;
    m.created.length = 0;
    m.userFindById.mockReturnValue(chain({ name: 'Ana', email: 'ana@example.test', plan: 'ELITE' }));
    m.countDocuments.mockResolvedValue(0);
    m.counter.mockResolvedValue({ seq: 42 });
    m.insertMany.mockImplementation(async (docs) => docs.map((_, i) => ({ _id: `att-${i}` })));
    m.attDeleteMany.mockResolvedValue({ deletedCount: 0 });
    m.notify.mockResolvedValue({});
    m.email.mockResolvedValue({});
});

afterEach(() => {
    vi.useRealTimers();
});

describe('createTicket', () => {
    const abrir = (extra = {}) => svc.createTicket({
        userId: USER_ID, category: 'BUG', subject: 'Preço errado', body: 'Veja', ...extra,
    });

    it('gera código sequencial, prioridade pelo plano e congela o plano da abertura', async () => {
        const view = await abrir();
        expect(view.code).toBe('VT-0042');
        expect(view.priority).toBe('ALTA');
        expect(view.planAtOpen).toBe('ELITE');
        expect(view.status).toBe('ABERTO');
        expect(view.messageCount).toBe(1);
        expect(view.messages[0]).toMatchObject({ authorRole: 'USER', authorName: 'Ana', body: 'Veja' });
        expect(view.context).toBeUndefined();
    });

    it('usuário inexistente é 404', async () => {
        m.userFindById.mockReturnValue(chain(null));
        await expect(abrir()).rejects.toMatchObject({ statusCode: 404 });
    });

    it('teto de tickets abertos devolve 429', async () => {
        m.countDocuments.mockResolvedValue(3);
        const err = await abrir().catch((e) => e);
        expect(err).toBeInstanceOf(SupportError);
        expect(err.statusCode).toBe(429);
    });

    it('anexo em formato inválido é recusado antes de gravar qualquer coisa', async () => {
        await expect(abrir({ attachments: ['data:text/html;base64,AAA='] })).rejects.toMatchObject({ statusCode: 400 });
        expect(m.insertMany).not.toHaveBeenCalled();
    });

    it('grava anexos com MIME e tamanho, e a mensagem aponta para os ids', async () => {
        await abrir({ attachments: [PNG] });
        const [docs] = m.insertMany.mock.calls[0];
        expect(docs[0]).toMatchObject({ ticket: 'tk-new', user: USER_ID, mimeType: 'image/png', size: PNG.length });
        expect(m.created[0].messages[0].attachments).toEqual(['att-0']);
    });

    it('falha ao salvar o ticket apaga os anexos já gravados e propaga o erro', async () => {
        m.saveImpl = async () => { throw new Error('validação'); };
        await expect(abrir({ attachments: [PNG] })).rejects.toThrow('validação');
        expect(m.attDeleteMany).toHaveBeenCalledWith({ _id: { $in: ['att-0'] } });
    });

    it('vínculo com ticket anterior só vale se o anterior for do mesmo usuário', async () => {
        m.exists.mockResolvedValueOnce({ _id: OTHER_TICKET });
        await abrir({ relatedTicket: OTHER_TICKET });
        expect(m.exists).toHaveBeenCalledWith({ _id: OTHER_TICKET, user: USER_ID });
        expect(m.created[0].relatedTicket).toBe(OTHER_TICKET);

        m.exists.mockResolvedValueOnce(null);
        await abrir({ relatedTicket: OTHER_TICKET });
        expect(m.created[1].relatedTicket).toBeNull();

        await abrir({ relatedTicket: 'nao-e-objectid' });
        expect(m.exists).toHaveBeenCalledTimes(2);
        expect(m.created[2].relatedTicket).toBeNull();
    });

    it('contexto do navegador entra cortado e com no máximo 3 erros', async () => {
        const erros = Array.from({ length: 5 }, (_, i) => ({ at: '2026-11-20T10:00:00Z', status: '500', path: `/p${i}`, message: 'x' }));
        await abrir({ context: { route: 'r'.repeat(500), userAgent: null, recentErrors: [...erros, { status: 'abc' }] } });
        const ctx = m.created[0].context;
        expect(ctx.route).toHaveLength(200);
        expect(ctx.userAgent).toBe('');
        expect(ctx.recentErrors).toHaveLength(3);
        expect(ctx.recentErrors[0]).toEqual({ at: new Date('2026-11-20T10:00:00Z'), status: 500, path: '/p0', message: 'x' });
    });

    it('erro do contador que não é corrida de upsert propaga; E11000 tenta de novo', async () => {
        m.counter.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 })).mockResolvedValueOnce({ seq: 1 });
        expect((await abrir()).code).toBe('VT-0001');

        m.counter.mockRejectedValueOnce(new Error('rede'));
        await expect(abrir()).rejects.toThrow('rede');
    });
});

describe('replyAsUser', () => {
    it('resposta numa thread aberta devolve a bola ao suporte', async () => {
        const t = fakeTicket({ status: 'RESPONDIDO' });
        m.findOne.mockResolvedValue(t);
        const r = await svc.replyAsUser({ ticketId: 'tk-1', userId: USER_ID, body: 'Ainda não' });
        expect(r.reopened).toBe(false);
        expect(t.status).toBe('ABERTO');
        expect(t.lastUserMessageAt).toEqual(NOW);
        expect(t.messages.at(-1)).toMatchObject({ authorRole: 'USER', authorName: 'Ana', body: 'Ainda não' });
    });

    it('RESOLVIDO dentro da janela reabre e limpa resolvedAt', async () => {
        const t = fakeTicket({ status: 'RESOLVIDO', resolvedAt: new Date('2026-11-20T12:00:00Z') });
        m.findOne.mockResolvedValue(t);
        const r = await svc.replyAsUser({ ticketId: 'tk-1', userId: USER_ID, body: 'Voltou' });
        expect(r.reopened).toBe(true);
        expect(t.status).toBe('ABERTO');
        expect(t.resolvedAt).toBeNull();
    });

    it('FECHADO ou fora da janela pede ticket novo e não grava nada', async () => {
        const t = fakeTicket({ status: 'RESOLVIDO', resolvedAt: new Date('2026-11-01T12:00:00Z') });
        m.findOne.mockResolvedValue(t);
        const r = await svc.replyAsUser({ ticketId: 'tk-1', userId: USER_ID, body: 'oi' });
        expect(r.needsNewTicket).toBe(true);
        expect(t.save).not.toHaveBeenCalled();
    });

    it('ticket de outro usuário é 404; teto de anexos por ticket conta a thread inteira', async () => {
        m.findOne.mockResolvedValueOnce(null);
        await expect(svc.replyAsUser({ ticketId: 'x', userId: USER_ID, body: 'a' })).rejects.toMatchObject({ statusCode: 404 });

        const cheio = fakeTicket({ status: 'ABERTO', messages: [{ attachments: [1, 2, 3] }, { attachments: [4, 5, 6, 7] }] });
        m.findOne.mockResolvedValueOnce(cheio);
        await expect(svc.replyAsUser({ ticketId: 'tk-1', userId: USER_ID, body: 'a', attachments: [PNG, PNG] }))
            .rejects.toThrow(/limite de 8 imagens/);
    });
});

describe('replyAsAdmin', () => {
    it('resposta normal marca RESPONDIDO, não lido para o usuário, e avisa por sino e e-mail', async () => {
        const t = fakeTicket({ status: 'ABERTO' });
        m.findById.mockResolvedValue(t);
        await svc.replyAsAdmin({ ticketId: 'tk-1', adminId: 'adm', adminName: 'Bia', body: 'Corrigido' });
        await vi.waitFor(() => expect(m.email).toHaveBeenCalled());

        expect(t.status).toBe('RESPONDIDO');
        expect(t.hasUnreadForUser).toBe(true);
        expect(t.lastAdminMessageAt).toEqual(NOW);
        expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
            user: USER_ID, type: 'SUPPORT_REPLY', link: '/suporte?ticket=VT-0007',
        }));
        expect(m.email).toHaveBeenCalledWith({ to: 'ana@example.test', name: 'Ana', code: 'VT-0007', subject: 'Preço', body: 'Corrigido' });
    });

    it('nota interna não muda status nem avisa ninguém', async () => {
        const t = fakeTicket({ status: 'ABERTO' });
        m.findById.mockResolvedValue(t);
        await svc.replyAsAdmin({ ticketId: 'tk-1', adminId: 'adm', adminName: 'Bia', body: 'rascunho', isInternal: true, newStatus: 'FECHADO' });
        expect(t.status).toBe('ABERTO');
        expect(t.hasUnreadForUser).toBeUndefined();
        expect(t.messages[0].isInternal).toBe(true);
        expect(m.notify).not.toHaveBeenCalled();
    });

    it('transição inválida é recusada ANTES de subir a imagem', async () => {
        m.findById.mockResolvedValue(fakeTicket({ status: 'FECHADO' }));
        await expect(svc.replyAsAdmin({ ticketId: 'tk-1', adminId: 'a', body: 'x', newStatus: 'RESPONDIDO', attachments: [PNG] }))
            .rejects.toThrow('Não é possível ir de FECHADO para RESPONDIDO.');
        expect(m.insertMany).not.toHaveBeenCalled();
    });

    it('resolver carimba resolvedAt; sem e-mail só notifica; falha no aviso não derruba a resposta', async () => {
        const t = fakeTicket({ status: 'ABERTO', userEmail: '' });
        m.findById.mockResolvedValue(t);
        m.notify.mockRejectedValue(new Error('push fora'));
        const r = await svc.replyAsAdmin({ ticketId: 'tk-1', adminId: 'a', body: 'ok', newStatus: 'RESOLVIDO' });
        expect(r).toBe(t);
        expect(t.resolvedAt).toEqual(NOW);
        await vi.waitFor(() => expect(m.notify).toHaveBeenCalled());
        expect(m.email).not.toHaveBeenCalled();
    });

    it('ticket de conta excluída (user nulo) responde sem avisar; inexistente é 404', async () => {
        m.findById.mockResolvedValueOnce(fakeTicket({ status: 'RESOLVIDO', user: null }));
        const r = await svc.replyAsAdmin({ ticketId: 'tk-1', adminId: 'a', body: 'ok' });
        expect(r.status).toBe('RESOLVIDO');
        expect(m.notify).not.toHaveBeenCalled();

        m.findById.mockResolvedValueOnce(null);
        await expect(svc.replyAsAdmin({ ticketId: 'x', adminId: 'a', body: 'ok' })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('updateTicket', () => {
    it('aplica status com carimbo, prioridade, categoria e no máximo 10 etiquetas', async () => {
        const t = fakeTicket({ status: 'RESPONDIDO' });
        m.findById.mockResolvedValue(t);
        await svc.updateTicket({ ticketId: 'tk-1', status: 'FECHADO', priority: 'MEDIA', category: 'DUVIDA', internalTags: Array(12).fill('t') });
        expect(t).toMatchObject({ status: 'FECHADO', closedAt: NOW, priority: 'MEDIA', category: 'DUVIDA' });
        expect(t.internalTags).toHaveLength(10);
        expect(t.save).toHaveBeenCalled();
    });

    it('voltar para a mesa limpa resolvedAt; transição proibida é 400', async () => {
        const t = fakeTicket({ status: 'RESOLVIDO', resolvedAt: NOW });
        m.findById.mockResolvedValue(t);
        await svc.updateTicket({ ticketId: 'tk-1', status: 'EM_ANALISE' });
        expect(t.resolvedAt).toBeNull();

        m.findById.mockResolvedValue(fakeTicket({ status: 'FECHADO' }));
        await expect(svc.updateTicket({ ticketId: 'tk-1', status: 'ABERTO' })).rejects.toMatchObject({ statusCode: 400 });
        m.findById.mockResolvedValue(null);
        await expect(svc.updateTicket({ ticketId: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('leitura', () => {
    it('getTicketForUser zera o "não lido" com updateOne (sem mexer no updatedAt)', async () => {
        const t = fakeTicket({ status: 'RESOLVIDO', hasUnreadForUser: true, messages: [{ authorRole: 'ADMIN', isInternal: true, body: 'x' }] });
        m.findOne.mockResolvedValue(t);
        const v = await svc.getTicketForUser('tk-1', USER_ID);
        expect(m.updateOne).toHaveBeenCalledWith({ _id: 'tk-1' }, { $set: { hasUnreadForUser: false } });
        expect(t.save).not.toHaveBeenCalled();
        expect(v).toMatchObject({ hasUnreadForUser: false, canReopen: true, messageCount: 0 });

        m.findOne.mockResolvedValue(null);
        await expect(svc.getTicketForUser('x', USER_ID)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('adminSummary soma abertos e "na sua vez" a partir do agrupamento', async () => {
        m.aggregate.mockResolvedValue([{ _id: 'ABERTO', count: 2 }, { _id: 'RESPONDIDO', count: 5 }, { _id: 'FECHADO', count: 9 }]);
        m.countDocuments.mockResolvedValue(1);
        expect(await svc.adminSummary()).toEqual({
            open: 7, waiting: 2, highPriority: 1, byStatus: { ABERTO: 2, RESPONDIDO: 5, FECHADO: 9 },
        });
    });

    it('listAdminTickets monta o filtro, escapa a busca e não baixa as mensagens', async () => {
        const q = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), select: vi.fn(), lean: vi.fn() };
        Object.keys(q).forEach((k) => q[k].mockReturnValue(q));
        q.lean.mockResolvedValue([{ _id: 't', code: 'VT-1', subject: 's', priority: 'ALTA', messages: ['nunca'] }]);
        m.find.mockReturnValue(q);
        m.countDocuments.mockResolvedValue(1);

        const r = await svc.listAdminTickets({ status: 'OPEN', category: 'BUG', priority: 'ALL', search: 'a(b', from: '2026-11-01', limit: 999 });

        const [filtro] = m.find.mock.calls[0];
        expect(filtro.status).toEqual({ $in: ['ABERTO', 'EM_ANALISE', 'RESPONDIDO'] });
        expect(filtro.category).toBe('BUG');
        expect(filtro.priority).toBeUndefined();
        expect(filtro.createdAt).toEqual({ $gte: new Date('2026-11-01') });
        expect(filtro.$or[0].code.test('xa(by')).toBe(true);
        expect(q.limit).toHaveBeenCalledWith(200);
        expect(q.select).toHaveBeenCalledWith('-messages -context');
        expect(r).toEqual({ total: 1, tickets: [expect.objectContaining({ code: 'VT-1', messageCount: 0 })] });
        expect(r.tickets[0].messages).toBeUndefined();

        await svc.listAdminTickets({ status: 'FECHADO', to: '2026-11-30' });
        expect(m.find.mock.calls[1][0]).toEqual({ status: 'FECHADO', createdAt: { $lte: new Date('2026-11-30') } });
    });

    it('getTicketForAdmin junta a ficha atual do usuário e as transições permitidas', async () => {
        m.findById.mockReturnValue(chain({ _id: 'tk-1', status: 'RESPONDIDO', user: USER_ID }));
        m.userFindById.mockReturnValue(chain({ name: 'Ana', plan: 'PRO' }));
        m.assetCount.mockResolvedValue(12);
        const r = await svc.getTicketForAdmin('tk-1');
        expect(r.profile).toEqual({ name: 'Ana', plan: 'PRO', assetCount: 12 });
        expect(r.allowedTransitions).toEqual(['EM_ANALISE', 'RESOLVIDO', 'FECHADO']);

        m.findById.mockReturnValue(chain({ _id: 'tk-2', status: 'FECHADO', user: null }));
        expect((await svc.getTicketForAdmin('tk-2')).profile).toBeNull();

        m.findById.mockReturnValue(chain(null));
        await expect(svc.getTicketForAdmin('x')).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('anonymizeUserTickets (LGPD)', () => {
    it('desliga os tickets da pessoa e apaga os anexos dela, dentro da sessão', async () => {
        m.updateMany.mockResolvedValue({ modifiedCount: 3 });
        const session = { id: 's' };
        expect(await svc.anonymizeUserTickets(USER_ID, { session })).toBe(3);
        const [filtro, update, opts] = m.updateMany.mock.calls[0];
        expect(filtro).toEqual({ user: USER_ID });
        expect(update.$set).toMatchObject({ user: null, userEmail: '', userName: 'Conta excluída' });
        expect(opts).toEqual({ session });
        expect(m.attDeleteMany).toHaveBeenCalledWith({ user: USER_ID }, { session });
    });

    it('sem tickets devolve 0', async () => {
        m.updateMany.mockResolvedValue({});
        expect(await svc.anonymizeUserTickets(USER_ID)).toBe(0);
    });
});
