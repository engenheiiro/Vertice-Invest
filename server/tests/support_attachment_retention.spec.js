/**
 * Retenção do anexo de ticket.
 *
 * A regra tem uma colisão fácil de reintroduzir: a janela de reabertura é de 7
 * dias, então purgar no dia 7 apagaria as imagens de uma conversa que o usuário
 * acabou de ressuscitar — inclusive as que ele mesmo mandou. Os testes abaixo
 * fixam a distância entre as duas janelas, não só o número.
 *
 * Relógio congelado: a regra compara com `Date.now()`, e fixture com data
 * absoluta apodrece.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    find: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
}));

vi.mock('../models/SupportTicket.js', () => ({
    default: { find: mocks.find, updateMany: mocks.updateMany },
}));
vi.mock('../models/SupportAttachment.js', () => ({
    default: { deleteMany: mocks.deleteMany },
}));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));
vi.mock('../models/AlgorithmPerformance.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { purgeSupportAttachments, ATTACHMENT_RETENTION_DAYS } = await import('../services/cleanupService.js');
const { REOPEN_WINDOW_DAYS } = await import('../utils/supportRules.js');

const NOW = new Date('2026-09-12T03:00:00Z');

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockReturnValue({ select: () => ({ lean: async () => [] }) });
    mocks.deleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.updateMany.mockResolvedValue({ modifiedCount: 0 });
});

describe('janela de retenção', () => {
    it('purga bem depois de a reabertura já ter fechado', () => {
        // Se algum dia alguém baixar a retenção para 7, este teste cai — e é
        // exatamente o aviso que se quer.
        expect(ATTACHMENT_RETENTION_DAYS).toBeGreaterThan(REOPEN_WINDOW_DAYS);
    });

    it('mede o corte a partir de AGORA, com a retenção configurada', async () => {
        await purgeSupportAttachments(NOW);

        const query = mocks.find.mock.calls[0][0];
        const cutoff = query.$or[0].closedAt.$lt;
        const dias = (NOW.getTime() - cutoff.getTime()) / 86_400_000;

        expect(Math.round(dias)).toBe(ATTACHMENT_RETENTION_DAYS);
    });
});

describe('o que entra na mira', () => {
    it('só ticket em estado terminal', async () => {
        await purgeSupportAttachments(NOW);
        expect(mocks.find.mock.calls[0][0].status).toEqual({ $in: ['RESOLVIDO', 'FECHADO'] });
    });

    it('ignora o que já foi purgado — a limpeza não repassa no mesmo ticket', async () => {
        await purgeSupportAttachments(NOW);
        expect(mocks.find.mock.calls[0][0].attachmentsPurgedAt).toBeNull();
    });

    it('aceita tanto o carimbo de fechamento quanto o de resolução', async () => {
        await purgeSupportAttachments(NOW);
        const campos = mocks.find.mock.calls[0][0].$or.map((c) => Object.keys(c)[0]);
        expect(campos).toEqual(['closedAt', 'resolvedAt']);
    });

    it('exige carimbo NÃO NULO — data ausente nunca conta como antiga', async () => {
        // Sem `$ne: null`, o Mongo trataria o campo nulo como menor que o corte e
        // purgaria ticket que nunca foi encerrado.
        await purgeSupportAttachments(NOW);
        for (const clause of mocks.find.mock.calls[0][0].$or) {
            expect(Object.values(clause)[0].$ne).toBeNull();
        }
    });
});

describe('efeito', () => {
    const doisTickets = [{ _id: 't1' }, { _id: 't2' }];

    beforeEach(() => {
        mocks.find.mockReturnValue({ select: () => ({ lean: async () => doisTickets }) });
        mocks.deleteMany.mockResolvedValue({ deletedCount: 5 });
    });

    it('apaga a imagem e marca o ticket como purgado', async () => {
        const stats = await purgeSupportAttachments(NOW);

        expect(mocks.deleteMany).toHaveBeenCalledWith({ ticket: { $in: ['t1', 't2'] } });
        expect(mocks.updateMany).toHaveBeenCalledWith(
            { _id: { $in: ['t1', 't2'] } },
            { $set: { attachmentsPurgedAt: NOW } },
        );
        expect(stats).toEqual({ tickets: 2, attachments: 5 });
    });

    it('não toca no banco quando não há nada vencido', async () => {
        mocks.find.mockReturnValue({ select: () => ({ lean: async () => [] }) });

        const stats = await purgeSupportAttachments(NOW);

        expect(mocks.deleteMany).not.toHaveBeenCalled();
        expect(mocks.updateMany).not.toHaveBeenCalled();
        expect(stats).toEqual({ tickets: 0, attachments: 0 });
    });
});
