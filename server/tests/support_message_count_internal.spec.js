/**
 * Regra 12 — o contador de mensagens que o dono do ticket recebe conta só o que
 * ele pode ver. O `messageCount` desnormalizado do modelo soma as notas
 * internas; espalhado pelo serializer, ele dizia quantas notas existiam.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), findOne: vi.fn(), updateOne: vi.fn() }));

vi.mock('../models/SupportTicket.js', () => ({
    default: { find: mocks.find, findOne: mocks.findOne, updateOne: mocks.updateOne },
}));
vi.mock('../models/SupportAttachment.js', () => ({ default: {} }));
vi.mock('../models/SupportCounter.js', () => ({ default: {} }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../services/notificationService.js', () => ({ createNotification: vi.fn() }));
vi.mock('../services/emailService.js', () => ({ sendSupportReplyEmail: vi.fn() }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { listUserTickets, getTicketForUser } = await import('../services/supportService.js');

const ticket = () => ({
    _id: 't1',
    code: 'VT-0001',
    subject: 'Dúvida',
    status: 'RESPONDIDO',
    user: 'u1',
    messageCount: 4, // desnormalizado: inclui as 2 notas internas
    messages: [
        { body: 'oi', authorRole: 'USER', isInternal: false },
        { body: 'nota 1', authorRole: 'ADMIN', isInternal: true },
        { body: 'nota 2', authorRole: 'ADMIN', isInternal: true },
        { body: 'resposta', authorRole: 'ADMIN', isInternal: false },
    ],
    hasUnreadForUser: false,
});

beforeEach(() => vi.clearAllMocks());

describe('messageCount entregue ao usuário', () => {
    it('lista: conta só mensagens não internas', async () => {
        mocks.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [ticket()] }) }) });
        const [row] = await listUserTickets('u1');
        expect(row.messageCount).toBe(2);
    });

    it('detalhe: sobrescreve o desnormalizado do modelo', async () => {
        mocks.findOne.mockResolvedValue(ticket());
        const view = await getTicketForUser('t1', 'u1');
        expect(view.messages).toHaveLength(2);
        expect(view.messageCount).toBe(2);
    });
});
