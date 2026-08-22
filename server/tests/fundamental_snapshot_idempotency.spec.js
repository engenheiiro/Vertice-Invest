/**
 * IDEMPOTÊNCIA DE appendSnapshots — pré-requisito do retry do sync.
 *
 * O append da série de fundamentos se perdeu no run de 22/08/2026 11:30 por um
 * flap de conexão de ~2min ("secureConnect timed out after 60397ms"), com o
 * banco respondendo de novo 11s depois. Por isso `syncService` passou a envolver
 * a chamada em `withMongoRetry`.
 *
 * Esse retry SÓ é seguro porque a função reescreve a leitura do mês (lê a série,
 * filtra o período e regrava o array inteiro) em vez de empilhar. Se alguém a
 * trocar por `$push`, a re-tentativa passa a duplicar a leitura do mês e
 * corromper o track record — em silêncio. É esse contrato que este teste tranca.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), bulkWrite: vi.fn() }));

vi.mock('../models/FundamentalSnapshot.js', () => ({
    default: { find: mocks.find, bulkWrite: mocks.bulkWrite },
}));

const { appendSnapshots } = await import('../services/fundamentalHistoryService.js');

/** `FundamentalSnapshot.find(...).select(...).lean()` do serviço. */
const findReturning = (docs) => ({ select: () => ({ lean: async () => docs }) });

const quando = new Date('2026-08-22T14:30:00Z'); // período 2026-08

const historyGravado = (call = 0) =>
    mocks.bulkWrite.mock.calls[call][0][0].updateOne.update.$set.history;

describe('appendSnapshots — o retry do sync depende disto', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.bulkWrite.mockResolvedValue({});
    });

    it('reescreve a leitura do mês em vez de empilhar — re-tentar não duplica', async () => {
        const priorMes = { period: '2026-07', roe: 10, netMargin: 5, payout: 0, dy: 6, revenueGrowth: 1, pl: 8 };
        // 1ª tentativa: só existe a leitura de julho.
        mocks.find.mockReturnValueOnce(findReturning([{ ticker: 'PETR4', history: [priorMes] }]));

        await appendSnapshots([{ ticker: 'PETR4', type: 'STOCK', roe: 12, dy: 7 }], quando);

        const primeira = historyGravado(0);
        expect(primeira.map(h => h.period)).toEqual(['2026-07', '2026-08']);

        // 2ª tentativa (o retry): o banco já tem o que a 1ª gravou.
        mocks.find.mockReturnValueOnce(findReturning([{ ticker: 'PETR4', history: primeira }]));

        await appendSnapshots([{ ticker: 'PETR4', type: 'STOCK', roe: 12, dy: 7 }], quando);

        const segunda = historyGravado(1);
        expect(segunda.map(h => h.period)).toEqual(['2026-07', '2026-08']); // NÃO duplicou
        expect(segunda).toEqual(primeira);
    });

    it('a operação é $set do array inteiro — nunca $push (que quebraria o retry)', async () => {
        mocks.find.mockReturnValue(findReturning([]));

        await appendSnapshots([{ ticker: 'VALE3', type: 'STOCK', roe: 20 }], quando);

        const update = mocks.bulkWrite.mock.calls[0][0][0].updateOne.update;
        expect(update.$set).toBeDefined();
        expect(update.$push).toBeUndefined();
        expect(update.$inc).toBeUndefined();
    });

    it('lista vazia não vai ao banco', async () => {
        await expect(appendSnapshots([], quando)).resolves.toEqual({ appended: 0 });
        expect(mocks.bulkWrite).not.toHaveBeenCalled();
        expect(mocks.find).not.toHaveBeenCalled();
    });
});
