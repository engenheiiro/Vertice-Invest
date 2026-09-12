/**
 * Quem pode abrir o anexo de um ticket.
 *
 * O defeito que este arquivo trava: autorizar pelo campo `user` do ANEXO em vez
 * de pelo dono do TICKET. Pelo anexo, o print que o suporte envia numa resposta
 * pertence ao admin — e o cliente, dono da conversa, levaria 404 numa imagem
 * endereçada a ele. Nada disso quebra tipo nem teste de rota: a imagem
 * simplesmente não aparece.
 *
 * A outra metade é a inversa, e é a que importa mais: o anexo de um usuário não
 * pode abrir para outro usuário.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findById: vi.fn(),
    exists: vi.fn(),
}));

vi.mock('../models/SupportAttachment.js', () => ({
    default: { findById: mocks.findById, insertMany: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('../models/SupportTicket.js', () => ({
    default: { exists: mocks.exists, findById: vi.fn(), findOne: vi.fn(), find: vi.fn(), countDocuments: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn() },
}));
vi.mock('../models/SupportCounter.js', () => ({ default: { findOneAndUpdate: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/UserAsset.js', () => ({ default: { countDocuments: vi.fn() } }));
vi.mock('../services/notificationService.js', () => ({ createNotification: vi.fn() }));
vi.mock('../services/emailService.js', () => ({ sendSupportReplyEmail: vi.fn() }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getAttachment, SupportError } = await import('../services/supportService.js');

const DONO = '507f1f77bcf86cd799439011';
const OUTRO = '507f1f77bcf86cd799439022';
const ADMIN_UPLOADER = '507f1f77bcf86cd799439033';
const ANEXO = '507f1f77bcf86cd799439044';
const TICKET = '507f1f77bcf86cd799439055';

// O anexo foi subido pelo ADMIN (resposta do suporte) num ticket do DONO.
const anexoDoSuporte = {
    _id: ANEXO, ticket: TICKET, user: ADMIN_UPLOADER,
    mimeType: 'image/png', data: 'data:image/png;base64,AAAA',
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockReturnValue({ lean: () => Promise.resolve(anexoDoSuporte) });
});

describe('getAttachment', () => {
    it('entrega ao dono do TICKET, mesmo que o arquivo tenha sido subido pelo suporte', async () => {
        mocks.exists.mockResolvedValue({ _id: TICKET });

        const result = await getAttachment(ANEXO, { userId: DONO, isAdmin: false });

        expect(result.data).toBe('data:image/png;base64,AAAA');
        // A pergunta feita ao banco é "este ticket é seu?", não "este arquivo é seu?".
        expect(mocks.exists).toHaveBeenCalledWith({ _id: TICKET, user: DONO });
    });

    it('recusa quem não é dono do ticket', async () => {
        mocks.exists.mockResolvedValue(null);

        await expect(getAttachment(ANEXO, { userId: OUTRO, isAdmin: false }))
            .rejects.toThrow(SupportError);
    });

    it('responde 404 (não 403) para estranho — 403 já confirmaria que o anexo existe', async () => {
        mocks.exists.mockResolvedValue(null);

        await expect(getAttachment(ANEXO, { userId: OUTRO, isAdmin: false }))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('admin abre sem precisar ser dono de nada', async () => {
        const result = await getAttachment(ANEXO, { userId: ADMIN_UPLOADER, isAdmin: true });

        expect(result.data).toBeTruthy();
        expect(mocks.exists).not.toHaveBeenCalled();
    });

    it('id malformado morre antes de ir ao banco', async () => {
        await expect(getAttachment('nao-e-id', { userId: DONO, isAdmin: false }))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.findById).not.toHaveBeenCalled();
    });

    it('anexo apagado (conta excluída) é 404, não erro de servidor', async () => {
        mocks.findById.mockReturnValue({ lean: () => Promise.resolve(null) });

        await expect(getAttachment(ANEXO, { userId: DONO, isAdmin: false }))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});
