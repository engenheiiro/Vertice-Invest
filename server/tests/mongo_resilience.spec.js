/**
 * CLASSIFICAÇÃO DE ERRO DE CONEXÃO (utils/mongoResilience.js).
 *
 * Toda a tolerância a queda de banco das rotinas longas depende deste juízo: o
 * que é transporte (re-tenta) e o que é dado (aborta na hora). Errar para o lado
 * "tudo é transitório" faria o worker re-tentar 260 vezes um bug de schema;
 * errar para o outro lado é o que derrubou o run de 22/08/2026 em 570/1300.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { isTransientMongoError, withMongoRetry } = await import('../utils/mongoResilience.js');

const named = (name, message = 'boom') => {
    const err = new Error(message);
    err.name = name;
    return err;
};

describe('isTransientMongoError', () => {
    it('reconhece os DOIS erros reais do run de 22/08/2026', () => {
        // Handshake TLS de socket novo estourando o connectTimeoutMS.
        expect(isTransientMongoError(new Error(
            "Socket 'secureConnect' timed out after 30214ms (connectTimeoutMS: 30000)"))).toBe(true);
        // Conexão de monitoramento (SDAM) derrubada.
        expect(isTransientMongoError(new Error(
            'connection <monitor> to 89.192.9.78:27017 closed'))).toBe(true);
    });

    it('reconhece pelos nomes de erro do driver', () => {
        for (const name of ['MongoNetworkError', 'MongoNetworkTimeoutError',
            'MongoServerSelectionError', 'MongooseServerSelectionError',
            'MongoNotConnectedError', 'PoolClearedError']) {
            expect(isTransientMongoError(named(name, 'sem pista na mensagem'))).toBe(true);
        }
    });

    it('reconhece pelos rótulos oficiais do servidor', () => {
        const err = new Error('write falhou');
        err.hasErrorLabel = (label) => label === 'RetryableWriteError';
        expect(isTransientMongoError(err)).toBe(true);
    });

    it('reconhece erros de socket do SO', () => {
        expect(isTransientMongoError(new Error('read ECONNRESET'))).toBe(true);
        expect(isTransientMongoError(new Error('connect ETIMEDOUT 89.192.9.78:27017'))).toBe(true);
    });

    it('NÃO trata erro de dado como transitório — re-tentar só esconderia o defeito', () => {
        expect(isTransientMongoError(named('ValidationError', 'ticker: Path `ticker` is required'))).toBe(false);
        expect(isTransientMongoError(new Error('E11000 duplicate key error'))).toBe(false);
        expect(isTransientMongoError(new TypeError("Cannot read properties of undefined (reading 'close')"))).toBe(false);
        expect(isTransientMongoError(null)).toBe(false);
    });
});

describe('withMongoRetry', () => {
    it('re-tenta a queda transitória e devolve o resultado da tentativa boa', async () => {
        vi.useFakeTimers();
        const op = vi.fn()
            .mockRejectedValueOnce(named('MongoNetworkError'))
            .mockResolvedValue('ok');

        const promise = withMongoRetry(op, { label: 'teste' });
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toBe('ok');
        expect(op).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('erro de dado sobe na primeira tentativa, sem backoff', async () => {
        const op = vi.fn().mockRejectedValue(named('ValidationError', 'campo inválido'));
        await expect(withMongoRetry(op)).rejects.toThrow('campo inválido');
        expect(op).toHaveBeenCalledTimes(1);
    });

    it('esgotadas as tentativas, o erro original é propagado intacto', async () => {
        vi.useFakeTimers();
        const original = named('MongoNetworkTimeoutError', "Socket 'secureConnect' timed out");
        const op = vi.fn().mockRejectedValue(original);

        const promise = withMongoRetry(op, { label: 'teste' });
        const assertion = expect(promise).rejects.toBe(original);
        await vi.runAllTimersAsync();
        await assertion;

        expect(op).toHaveBeenCalledTimes(4); // 1 + 3 re-tentativas
        vi.useRealTimers();
    });
});
