import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
import { oncePerMinute } from '../utils/cronTick.js';

// ============================================================================
// DISPARO PERDIDO DO NODE-CRON
// ============================================================================
// O laço interno da biblioteca roda a cada ~1s e só dispara se a passada cair
// dentro do segundo :00. Quando o atraso acumulado faz a passada pular esse
// segundo, o minuto se perde sem log e sem JobRun. Foi o que deixou o fx-history
// sem rodar em 27/10 e 03/11/2026. Roda contra a biblioteca real, de propósito: o
// que está travado aqui é o comportamento dela, e atualizar a versão pode mudá-lo.

const QUASE_19H45 = new Date('2026-11-03T22:44:59.900Z');
const LOGO_APOS_O_MINUTO = new Date('2026-11-03T22:45:00.001Z');
const RECUPERA = { timezone: 'America/Sao_Paulo', recoverMissedExecutions: true };

const pulandoOSegundoZero = (job, opcoes) => {
    const tarefa = cron.schedule('45 19 * * *', job, opcoes);
    // A próxima passada do laço, 1s depois, cai em :01,001. O :00 não é visitado.
    vi.setSystemTime(LOGO_APOS_O_MINUTO);
    vi.advanceTimersByTime(1000);
    tarefa.stop();
};

const noHorarioCerto = (job, opcoes) => {
    const tarefa = cron.schedule('45 19 * * *', job, opcoes);
    vi.advanceTimersByTime(5000);
    tarefa.stop();
};

describe('node-cron: disparo do scheduler', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'hrtime'], now: QUASE_19H45 });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('sem recuperação, a passada que pula o :00 perde o disparo (o defeito)', () => {
        const job = vi.fn();
        pulandoOSegundoZero(job, { timezone: 'America/Sao_Paulo' });
        expect(job).not.toHaveBeenCalled();
    });

    it('só com a recuperação, o disparo normal roda duas vezes (a armadilha)', () => {
        const job = vi.fn();
        noHorarioCerto(job, RECUPERA);
        expect(job).toHaveBeenCalledTimes(2);
    });

    it('com a recuperação e a trava, a passada que pula o :00 roda uma vez', () => {
        const job = vi.fn();
        pulandoOSegundoZero(oncePerMinute(job), RECUPERA);
        expect(job).toHaveBeenCalledTimes(1);
    });

    it('com a recuperação e a trava, o disparo normal roda uma vez', () => {
        const job = vi.fn();
        noHorarioCerto(oncePerMinute(job), RECUPERA);
        expect(job).toHaveBeenCalledTimes(1);
    });
});

describe('oncePerMinute', () => {
    it('volta a executar no minuto seguinte', () => {
        let agora = 0;
        const job = vi.fn();
        const travado = oncePerMinute(job, () => agora);
        travado();
        agora = 59_000;
        travado();
        expect(job).toHaveBeenCalledTimes(1);
        agora = 60_000;
        travado();
        expect(job).toHaveBeenCalledTimes(2);
    });
});
