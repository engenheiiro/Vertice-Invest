/**
 * Exclusão definitiva de ticket.
 *
 * É a única operação do módulo que destrói registro de atendimento, e ela tem
 * uma ordem que importa: o anexo sai PRIMEIRO. Invertida, uma falha no meio
 * deixaria imagens de até 900KB apontando para um ticket que não existe mais —
 * invisíveis para toda tela e para a rotina de limpeza, que varre a partir do
 * ticket. Na ordem certa, o pior caso é um ticket com imagens indisponíveis, e
 * repetir a exclusão termina o serviço.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findById: vi.fn(),
    deleteOne: vi.fn(),
    deleteMany: vi.fn(),
    ordem: [],
}));

vi.mock('../models/SupportTicket.js', () => ({
    default: { findById: mocks.findById, deleteOne: mocks.deleteOne },
}));
vi.mock('../models/SupportAttachment.js', () => ({ default: { deleteMany: mocks.deleteMany } }));
vi.mock('../models/SupportCounter.js', () => ({ default: {} }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../services/notificationService.js', () => ({ createNotification: vi.fn() }));
vi.mock('../services/emailService.js', () => ({ sendSupportReplyEmail: vi.fn() }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { deleteTicket, SupportError } = await import('../services/supportService.js');

const TICKET = { _id: 'abc123', code: 'VT-0042', subject: 'Preço errado', user: 'user-1' };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.ordem.length = 0;
    mocks.findById.mockReturnValue({ select: () => ({ lean: async () => TICKET }) });
    mocks.deleteMany.mockImplementation(async () => { mocks.ordem.push('anexos'); return { deletedCount: 2 }; });
    mocks.deleteOne.mockImplementation(async () => { mocks.ordem.push('ticket'); return { deletedCount: 1 }; });
});

describe('o que é apagado', () => {
    it('apaga as imagens do ticket e o ticket', async () => {
        const info = await deleteTicket(TICKET._id);

        expect(mocks.deleteMany).toHaveBeenCalledWith({ ticket: TICKET._id });
        expect(mocks.deleteOne).toHaveBeenCalledWith({ _id: TICKET._id });
        expect(info).toEqual({ code: 'VT-0042', attachments: 2 });
    });

    it('o anexo sai ANTES do ticket', async () => {
        await deleteTicket(TICKET._id);
        expect(mocks.ordem).toEqual(['anexos', 'ticket']);
    });

    it('ticket inexistente vira 404, e nada é apagado', async () => {
        mocks.findById.mockReturnValue({ select: () => ({ lean: async () => null }) });

        await expect(deleteTicket('sumiu')).rejects.toBeInstanceOf(SupportError);
        expect(mocks.deleteMany).not.toHaveBeenCalled();
        expect(mocks.deleteOne).not.toHaveBeenCalled();
    });

    it('o 404 é 404 mesmo — não um 500 disfarçado', async () => {
        mocks.findById.mockReturnValue({ select: () => ({ lean: async () => null }) });

        await expect(deleteTicket('sumiu')).rejects.toMatchObject({ statusCode: 404 });
    });
});
