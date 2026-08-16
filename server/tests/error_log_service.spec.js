/**
 * Log de erros do painel + instrumentação de jobs.
 *
 * Duas propriedades importam mais que o armazenamento em si:
 *  - agrupar ocorrências do MESMO defeito (senão o painel vira scroll infinito);
 *  - nunca alterar o comportamento de quem instrumenta (registrar erro não pode
 *    causar erro, e envelopar um job não pode engolir a exceção dele).
 *
 * Os testes rodam SEM conexão com o Mongo de propósito: é o cenário em que a
 * instrumentação mais pode causar dano (buffer do Mongoose pendurando a request),
 * e o contrato é o mesmo — falha em silêncio, não atrapalha.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildFingerprint, normalizeMessage, recordError } from '../services/errorLogService.js';
import { trackJob, trackJobSafe } from '../utils/jobRun.js';

describe('normalização de mensagem', () => {
    it('colapsa ids, uuids e números que variam a cada ocorrência', () => {
        const a = normalizeMessage('Wallet 507f1f77bcf86cd799439011 falhou após 3 tentativas');
        const b = normalizeMessage('Wallet 507f191e810c19729de860ea falhou após 47 tentativas');
        expect(a).toBe(b);
    });

    it('preserva o que distingue o defeito', () => {
        const a = normalizeMessage('Timeout no Yahoo');
        const b = normalizeMessage('Timeout no Fundamentus');
        expect(a).not.toBe(b);
    });

    it('normaliza espaçamento e corta mensagem gigante', () => {
        expect(normalizeMessage('erro    com   espaços')).toBe('erro com espaços');
        expect(normalizeMessage('x'.repeat(5000)).length).toBeLessThanOrEqual(500);
    });
});

describe('fingerprint', () => {
    it('agrupa ocorrências do mesmo erro na mesma origem', () => {
        const base = { origin: 'JOB', source: 'quotes-sync', code: 'ETIMEDOUT' };
        expect(buildFingerprint({ ...base, message: 'timeout após 30s' }))
            .toBe(buildFingerprint({ ...base, message: 'timeout após 90s' }));
    });

    it('separa o mesmo erro vindo de origens diferentes', () => {
        const msg = { code: 'ETIMEDOUT', message: 'timeout' };
        expect(buildFingerprint({ ...msg, origin: 'JOB', source: 'quotes-sync' }))
            .not.toBe(buildFingerprint({ ...msg, origin: 'JOB', source: 'macro-sync' }));
    });

    it('é estável entre execuções (mesma entrada, mesmo hash)', () => {
        const input = { origin: 'HTTP', source: 'GET /api/wallet', code: 'INTERNAL_ERROR', message: 'boom' };
        expect(buildFingerprint(input)).toBe(buildFingerprint(input));
    });
});

describe('recordError sem banco', () => {
    it('desiste em silêncio em vez de pendurar o chamador', async () => {
        await expect(recordError({ origin: 'HTTP', message: 'qualquer' })).resolves.toBe(false);
    });
});

describe('trackJob', () => {
    it('devolve o resultado do job sem alterá-lo', async () => {
        const result = await trackJob('full-sync', async () => ({ success: true, count: 7 }));
        expect(result).toEqual({ success: true, count: 7 });
    });

    it('relança a exceção original — instrumentar não pode mascarar falha', async () => {
        const boom = new Error('Fundamentus 403');
        await expect(trackJob('full-sync', async () => { throw boom; })).rejects.toThrow('Fundamentus 403');
    });

    it('trackJobSafe contém a falha para não derrubar o tick do scheduler', async () => {
        const fn = vi.fn(async () => { throw new Error('quebrou'); });
        await expect(trackJobSafe('quotes-sync', fn)).resolves.toBeNull();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('executa o job exatamente uma vez', async () => {
        const fn = vi.fn(async () => 'ok');
        await trackJob('macro-sync', fn);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('resultado { success: false } chega intacto ao chamador', async () => {
        // O syncService resolve com { success:false } em vez de lançar; o registro
        // precisa enxergar isso como falha SEM alterar o contrato de retorno.
        const result = await trackJob('full-sync', async () => ({
            success: false,
            error: 'Nenhum ativo válido encontrado.',
        }));
        expect(result).toEqual({ success: false, error: 'Nenhum ativo válido encontrado.' });
    });
});
