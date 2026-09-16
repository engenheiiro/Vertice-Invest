/**
 * Execuções órfãs — a linha que ficou aberta num processo que já morreu.
 *
 * Quem abre um JobRun é quem o fecha; deploy/reinício no meio do job não deixa
 * ninguém para fechar. Em 16/09/2026 havia 29 dessas, e a mais recente de
 * 'daily-morning' fazia o painel afirmar que uma execução estava "segurando
 * memória do processo" — de um processo que tinha reiniciado horas antes.
 *
 * O que estes testes trancam: fecha o que é de processo morto, NÃO fecha o que é
 * meu nem o que ainda cabe no teto do job, e não inventa duração.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';

const mocks = vi.hoisted(() => ({
    find: vi.fn(),
    updateMany: vi.fn(),
    readyState: { value: 1 },
}));

vi.mock('../models/JobRun.js', () => ({
    default: {
        find: mocks.find,
        updateMany: mocks.updateMany,
        create: vi.fn(),
        updateOne: vi.fn(),
    },
}));
vi.mock('mongoose', () => ({
    default: { get connection() { return { readyState: mocks.readyState.value }; } },
}));
vi.mock('../services/errorLogService.js', () => ({ recordJobError: vi.fn() }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { closeOrphanRuns, ORPHAN_ERROR } = await import('../utils/jobRun.js');

const EU = `${os.hostname()}#${process.pid}`;
const AGORA = new Date('2026-09-16T05:00:00.000Z');
const atras = (horas) => new Date(AGORA.getTime() - horas * 3600_000);

const comAbertas = (linhas) => {
    mocks.find.mockReturnValue({ select: () => ({ lean: async () => linhas }) });
};

describe('closeOrphanRuns', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readyState.value = 1;
        mocks.updateMany.mockResolvedValue({ modifiedCount: 1 });
    });

    it('fecha a execução aberta por um processo que não existe mais', async () => {
        comAbertas([
            { _id: 'a1', jobId: 'daily-morning', startedAt: atras(17), instance: 'pod-velho#64' },
        ]);

        const r = await closeOrphanRuns(AGORA);

        expect(r.closed).toBe(1);
        const [filtro, patch] = mocks.updateMany.mock.calls[0];
        expect(filtro).toEqual({ _id: { $in: ['a1'] } });
        expect(patch.$set.status).toBe('FAILED');
        expect(patch.$set.error).toBe(ORPHAN_ERROR);
    });

    it('não inventa duração: `durationMs` fica nulo', async () => {
        // A hora em que o processo morreu não é conhecida. "Agora menos o começo"
        // gravaria uma duração de dias e envenenaria a medição que calibra os tetos.
        comAbertas([{ _id: 'a1', jobId: 'daily-morning', startedAt: atras(17), instance: 'pod-velho#64' }]);
        await closeOrphanRuns(AGORA);
        expect(mocks.updateMany.mock.calls[0][1].$set.durationMs).toBeNull();
        expect(mocks.updateMany.mock.calls[0][1].$set.finishedAt).toBe(AGORA);
    });

    it('nunca fecha execução DESTA instância — a consulta já a exclui', async () => {
        comAbertas([]);
        await closeOrphanRuns(AGORA);
        expect(mocks.find).toHaveBeenCalledWith({ status: 'RUNNING', instance: { $ne: EU } });
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it('poupa execução de outra instância que ainda cabe no teto do job', async () => {
        // O banco é compartilhado: Render Cron Job e `sync:prod` rodam em processos
        // próprios. Enquanto a execução deles está dentro do próprio teto, o
        // watchdog de lá é quem manda — não este boot.
        comAbertas([
            { _id: 'viva', jobId: 'daily-evening', startedAt: atras(0.2), instance: 'cron-job#7' },
            { _id: 'morta', jobId: 'daily-evening', startedAt: atras(9), instance: 'cron-job#7' },
        ]);

        const r = await closeOrphanRuns(AGORA);

        expect(r.closed).toBe(1);
        expect(mocks.updateMany.mock.calls[0][0]).toEqual({ _id: { $in: ['morta'] } });
    });

    it('job de teto curto ainda ganha a folga mínima de 30 min', async () => {
        // 'data-health' roda em 1s e tem teto padrão, mas fechar uma execução de
        // poucos minutos de outra instância seria chute, não conclusão.
        comAbertas([
            { _id: 'recente', jobId: 'data-health', startedAt: atras(0.2), instance: 'outro#9' },
        ]);
        expect((await closeOrphanRuns(AGORA)).closed).toBe(0);
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it('sem banco, não faz nada (o boot não pode quebrar por isto)', async () => {
        mocks.readyState.value = 0;
        expect((await closeOrphanRuns(AGORA)).closed).toBe(0);
        expect(mocks.find).not.toHaveBeenCalled();
    });

    it('falha na varredura não propaga para o boot', async () => {
        mocks.find.mockImplementation(() => { throw new Error('Mongo fora'); });
        await expect(closeOrphanRuns(AGORA)).resolves.toEqual({ closed: 0 });
    });
});
