/**
 * Watchdog de execução de job.
 *
 * Regressão de 13–15/09/2026: 'daily-morning' abriu execução às 09:00 em três
 * dias seguidos e nunca fechou, presa numa chamada ao Yahoo sem teto de tempo.
 * Nada alarmou e a memória de cada execução ficou retida no processo.
 *
 * O que estes testes travam: execução que passa do teto é DERRUBADA (para o
 * JobRun fechar como FAILED e o lease ser liberado), execução normal não é
 * tocada, e o teto sai do catálogo quando ninguém passa um.
 */
import { describe, it, expect, vi } from 'vitest';
import { withJobWatchdog, JobTimeoutError } from '../utils/jobWatchdog.js';
import { getJobMaxRuntimeMs, DEFAULT_MAX_RUNTIME_MINUTES } from '../config/jobCatalog.js';

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const nuncaAssenta = () => new Promise(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('withJobWatchdog', () => {
    it('devolve o resultado de quem termina dentro do teto', async () => {
        const fn = vi.fn().mockResolvedValue({ ok: true });
        await expect(withJobWatchdog('data-health', fn, { timeoutMs: 50 })).resolves.toEqual({ ok: true });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('derruba a execução que passa do teto', async () => {
        await expect(withJobWatchdog('daily-morning', nuncaAssenta, { timeoutMs: 20 }))
            .rejects.toBeInstanceOf(JobTimeoutError);
    });

    it('o erro diz qual job e qual teto — é o que vai para o JobRun', async () => {
        const erro = await withJobWatchdog('daily-morning', nuncaAssenta, { timeoutMs: 20 })
            .catch((e) => e);
        expect(erro.jobId).toBe('daily-morning');
        expect(erro.timeoutMs).toBe(20);
        // A mensagem é o texto que o painel de Erros mostra: precisa nomear o job
        // e o teto em minutos, na unidade em que o catálogo foi escrito.
        expect(new JobTimeoutError('daily-morning', 20 * 60_000).message)
            .toContain("Execução de 'daily-morning' passou do teto de 20 min");
    });

    it('preserva o erro do próprio job, sem embrulhar em timeout', async () => {
        const falha = new Error('Fundamentus 403');
        await expect(withJobWatchdog('daily-morning', () => Promise.reject(falha), { timeoutMs: 50 }))
            .rejects.toThrow('Fundamentus 403');
    });

    it('não segura o processo: o timer é liberado quando o job termina antes', async () => {
        // Teto enorme + job rápido. Se o timer ficasse pendurado (sem clearTimeout),
        // o vitest acusaria handle aberto ao fechar o arquivo.
        await expect(withJobWatchdog('data-health', async () => 'pronto', { timeoutMs: 600_000 }))
            .resolves.toBe('pronto');
    });

    it('a execução presa NÃO vira unhandledRejection quando falha depois', async () => {
        // Promise.race trata as duas pontas: a chamada derrubada pode falhar
        // sozinha minutos depois sem derrubar o processo.
        const espia = vi.fn();
        process.on('unhandledRejection', espia);
        const lenta = () => new Promise((_, reject) => setTimeout(() => reject(new Error('socket caiu')), 30));
        await expect(withJobWatchdog('daily-morning', lenta, { timeoutMs: 10 }))
            .rejects.toBeInstanceOf(JobTimeoutError);
        await sleep(60);
        process.off('unhandledRejection', espia);
        expect(espia).not.toHaveBeenCalled();
    });

    it('sem teto explícito, usa o do catálogo', () => {
        // 'daily-evening' é a rotina mais longa da grade e declara o próprio teto;
        // 'storage-cleanup' não declara e cai no padrão.
        expect(getJobMaxRuntimeMs('daily-evening')).toBe(40 * 60 * 1000);
        expect(getJobMaxRuntimeMs('storage-cleanup')).toBe(DEFAULT_MAX_RUNTIME_MINUTES * 60 * 1000);
        // Job fora do catálogo não pode ficar sem relógio.
        expect(getJobMaxRuntimeMs('inexistente')).toBe(DEFAULT_MAX_RUNTIME_MINUTES * 60 * 1000);
    });

    it('o teto do catálogo é sempre maior que o pior caso medido do job', () => {
        // Medições de 30 dias em produção (JobRun, status SUCCESS), em segundos.
        const piorCasoMedido = {
            'quotes-sync': 838,
            'daily-evening': 596,
            'daily-morning': 296,
            'macro-sync': 209,
            'weekly-autopublish': 11,
            'treasury-prices': 46,
            'data-health': 2,
            'storage-cleanup': 2,
        };
        for (const [jobId, segundos] of Object.entries(piorCasoMedido)) {
            expect(getJobMaxRuntimeMs(jobId)).toBeGreaterThan(segundos * 1000);
        }
    });
});
