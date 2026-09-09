/**
 * O backfill de datas de pagamento como JOB.
 *
 * Antes ele era o corpo de um POST que levava minutos: a tela ficava com um
 * spinner mudo (progresso nenhum atravessa uma resposta que não terminou) e sair
 * da página abortava o fetch, dando a impressão de que o trabalho tinha parado —
 * quando ele seguia no servidor sem ninguém para receber o resultado.
 *
 * O que se cobra aqui: o disparo devolve na hora, o progresso fica legível
 * enquanto corre, dois disparos não viram duas varreduras, e um erro no meio não
 * deixa o job preso em "rodando" para sempre.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { startBackfill, getBackfillState, isBackfillRunning, __resetBackfillState } = await import('../services/dividendPaymentBackfillJob.js');

const resumir = (resumo) => ({ message: `${resumo.preenchidos} data(s)`, stats: resumo });
const espera = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => __resetBackfillState());

describe('dividendPaymentBackfillJob', () => {
    it('devolve na hora e deixa a varredura correndo', async () => {
        let concluir;
        const executar = () => new Promise((r) => { concluir = r; });

        const { iniciado } = startBackfill(executar, resumir);
        expect(iniciado).toBe(true);
        expect(getBackfillState().status).toBe('RUNNING');

        concluir({ ativos: 3, preenchidos: 2, tentados: 9, falhas: [] });
        await espera();
        expect(getBackfillState().status).toBe('DONE');
        expect(getBackfillState().stats.preenchidos).toBe(2);
    });

    it('publica o progresso ativo a ativo', async () => {
        let onProgress;
        const executar = (opcoes) => { onProgress = opcoes.onProgress; return new Promise(() => {}); };
        startBackfill(executar, resumir);

        onProgress({ i: 7, total: 120, ticker: 'KNCR11', resumo: { preenchidos: 3 } });
        const estado = getBackfillState();
        expect(estado).toMatchObject({ feitos: 7, total: 120, ticker: 'KNCR11', preenchidos: 3 });
    });

    it('não dispara uma segunda varredura por cima da primeira', () => {
        const executar = vi.fn(() => new Promise(() => {}));
        startBackfill(executar, resumir);

        const segundo = startBackfill(executar, resumir);
        expect(segundo.iniciado).toBe(false);
        expect(executar).toHaveBeenCalledTimes(1);
        expect(isBackfillRunning()).toBe(true);
    });

    it('erro no meio da varredura vira estado de erro, não job preso', async () => {
        startBackfill(() => Promise.reject(new Error('fonte fora do ar')), resumir);
        await espera();

        expect(getBackfillState().status).toBe('ERROR');
        expect(getBackfillState().erro).toBe('fonte fora do ar');
        expect(isBackfillRunning()).toBe(false);
    });
});
