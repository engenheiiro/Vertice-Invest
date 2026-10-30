/**
 * Erro superado sai do painel sozinho.
 *
 * Out/2026: o Fundamentus caiu no TLS do `www` (consertado em 16/10) e o CSV do
 * Tesouro foi barrado (reserva em 25/10). Dias depois a aba Saúde ainda listava
 * as cinco falhas como se doessem: o ErrorLog só baixava pelo clique do admin ou
 * pelo TTL de 14 dias, e o job voltar a rodar bem não contava.
 *
 * O que estes testes trancam: execução SUCCESS baixa as falhas ANTERIORES do
 * mesmo job; SKIPPED e FAILED não baixam nada; erro visto durante a própria
 * execução continua aberto; e baixar nunca lança nem pendura sem banco.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateMany: vi.fn(),
    readyState: { value: 1 },
}));

vi.mock('../models/ErrorLog.js', () => ({ default: { updateMany: mocks.updateMany, updateOne: vi.fn() } }));
vi.mock('mongoose', () => ({
    default: { get connection() { return { readyState: mocks.readyState.value }; } },
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveErrors, resolveJobErrors, resolveIngestionErrors } = await import('../services/errorLogService.js');

describe('resolveErrors', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readyState.value = 1;
        mocks.updateMany.mockResolvedValue({ modifiedCount: 2 });
    });

    it('baixa só o que está aberto e foi visto ANTES da execução bem-sucedida', async () => {
        const before = new Date('2026-10-30T15:30:00.000Z');

        await expect(resolveJobErrors('treasury-prices', before)).resolves.toBe(2);

        const [filter, update] = mocks.updateMany.mock.calls[0];
        expect(filter).toEqual({
            origin: 'JOB', source: 'treasury-prices', resolvedAt: null, lastSeenAt: { $lt: before },
        });
        expect(update.$set.resolvedAt).toBeInstanceOf(Date);
    });

    it('fonte externa baixa pela própria origem, sem tocar em outra classe da mesma fonte', async () => {
        await resolveIngestionErrors('fundamentus/STOCK', new Date());
        expect(mocks.updateMany.mock.calls[0][0]).toMatchObject({ origin: 'INGESTION', source: 'fundamentus/STOCK' });
    });

    it('sem origem ou sem fonte não baixa nada (nunca um updateMany aberto)', async () => {
        await expect(resolveErrors({ origin: 'JOB' })).resolves.toBe(0);
        await expect(resolveErrors({ source: 'full-sync' })).resolves.toBe(0);
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it('sem banco desiste em silêncio', async () => {
        mocks.readyState.value = 0;
        await expect(resolveJobErrors('full-sync', new Date())).resolves.toBe(0);
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it('falha de escrita não sobe para o job', async () => {
        mocks.updateMany.mockRejectedValue(new Error('primary stepped down'));
        await expect(resolveJobErrors('full-sync', new Date())).resolves.toBe(0);
    });
});

describe('trackJob baixa as falhas antigas do job', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readyState.value = 1;
        mocks.updateMany.mockResolvedValue({ modifiedCount: 1 });
    });

    // O trackJob de verdade, com JobRun e errorLogService isolados num módulo
    // próprio, para ver exatamente quem ele chama.
    const loadTrackJob = async () => {
        vi.resetModules();
        const recordJobError = vi.fn();
        const resolveJobErrorsMock = vi.fn();
        vi.doMock('../models/JobRun.js', () => ({
            default: { create: vi.fn(async (d) => ({ _id: 'run1', ...d })), updateOne: vi.fn(async () => ({})) },
        }));
        vi.doMock('../services/errorLogService.js', () => ({ recordJobError, resolveJobErrors: resolveJobErrorsMock }));
        const { trackJob } = await import('../utils/jobRun.js');
        return { trackJob, recordJobError, resolveJobErrors: resolveJobErrorsMock };
    };

    it('SUCCESS baixa o que veio antes do início desta execução', async () => {
        const { trackJob, resolveJobErrors: resolve } = await loadTrackJob();
        const antes = Date.now();

        await trackJob('treasury-prices', async () => ({ success: true }));

        expect(resolve).toHaveBeenCalledOnce();
        const [jobId, startedAt] = resolve.mock.calls[0];
        expect(jobId).toBe('treasury-prices');
        expect(startedAt.getTime()).toBeGreaterThanOrEqual(antes);
    });

    it('SKIPPED não prova que o job voltou — nada é baixado', async () => {
        const { trackJob, resolveJobErrors: resolve } = await loadTrackJob();
        await trackJob('treasury-prices', async () => ({ skipped: true, reason: 'ALREADY_INGESTED' }));
        expect(resolve).not.toHaveBeenCalled();
    });

    it('falha reportada registra e não baixa', async () => {
        const { trackJob, recordJobError, resolveJobErrors: resolve } = await loadTrackJob();
        await trackJob('full-sync', async () => ({ success: false, error: 'Scraping blocked.' }));
        expect(recordJobError).toHaveBeenCalledOnce();
        expect(resolve).not.toHaveBeenCalled();
    });

    it('exceção registra, relança e não baixa', async () => {
        const { trackJob, resolveJobErrors: resolve } = await loadTrackJob();
        await expect(trackJob('full-sync', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(resolve).not.toHaveBeenCalled();
    });
});
