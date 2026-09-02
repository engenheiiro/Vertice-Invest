import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_CATALOG } from '../config/jobCatalog.js';

// ─────────────────────────────────────────────────────────────────────────────
// GUARD DE INSTÂNCIA DO SCHEDULER (DISABLE_SCHEDULER)
//
// initScheduler() era chamado incondicionalmente no import de app.js. Como o .env
// local aponta para o Mongo de PRODUÇÃO, todo `npm run dev` registrava os crons
// e passava a executá-los contra o mesmo banco do host — em 19/08/2026 dois JobRun
// de 'daily-evening' abriram no mesmo segundo (21:30:00.021 e 21:30:00.038) e
// ambos ficaram RUNNING.
//
// EXTERNAL_SCHEDULER não resolvia: cobre só os 3 jobs marcados como `heavy` e
// existe para outro fim (mover os pesados para Render Cron Jobs). Os dois
// mecanismos coexistem — este spec trava o guard novo sem tocar naquele.
//
// O que precisa ficar travado:
//  1. COM a flag: nenhum cron registrado E nenhuma rotina de boot agendada — o
//     backfill de snapshot dos 15s escreve no banco, então o guard tem que vir
//     antes dele, não só antes do cron.schedule.
//  2. SEM a flag: comportamento idêntico ao de hoje (todos os jobs + as rotinas de
//     boot). Produção não pode ficar muda por variável ausente ou escrita errada
//     — silêncio de scheduler não deixa rastro, é pior que duplicação.
// ─────────────────────────────────────────────────────────────────────────────

// Nenhum cron de verdade num teste — só o espião de registro.
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() },
}));
vi.mock('../utils/jobLease.js', () => ({
    withJobLease: vi.fn(async (jobId) => ({ skipped: true, reason: 'TEST_LEASE', jobId })),
}));

const { default: cron } = await import('node-cron');
const { default: logger } = await import('../config/logger.js');
const { withJobLease } = await import('../utils/jobLease.js');
const { initScheduler, runDailySnapshot } = await import('../services/schedulerService.js');

// Os jobs que initScheduler registra hoje, na ordem em que aparecem no arquivo.
const JOBS_ESPERADOS = [
    'macro-sync', 'quotes-sync', 'radar-alpha', 'backtest-intraday', 'daily-morning',
    'daily-evening', 'weekly-autopublish', 'monthly-anchor-publish', 'daily-snapshot',
    'subscriptions-check', 'dividends-sync', 'holidays-sync', 'us-fundamentals',
    'fx-history', 'assets-reactivation', 'storage-cleanup', 'treasury-prices',
    'lgpd-retention', 'data-health',
];

const flagOriginal = process.env.DISABLE_SCHEDULER;

beforeAll(() => {
    // Timers falsos só para CONTAR o que foi agendado. Nada é avançado: disparar
    // o backfill de boot faria o teste falar com o Mongo de verdade.
    vi.useFakeTimers();
});

afterAll(() => {
    vi.useRealTimers();
    if (flagOriginal === undefined) delete process.env.DISABLE_SCHEDULER;
    else process.env.DISABLE_SCHEDULER = flagOriginal;
});

beforeEach(() => {
    vi.mocked(cron.schedule).mockClear();
    vi.mocked(logger.warn).mockClear();
});

afterEach(() => {
    vi.clearAllTimers();
});

describe('DISABLE_SCHEDULER=true — a instância não registra nada', () => {
    beforeEach(() => {
        process.env.DISABLE_SCHEDULER = 'true';
    });

    it('não registra um único cron', () => {
        const resultado = initScheduler();

        expect(cron.schedule).not.toHaveBeenCalled();
        expect(resultado).toEqual({ started: false, reason: 'DISABLE_SCHEDULER' });
    });

    it('não agenda as rotinas de boot (backfill de snapshot e sentinela)', () => {
        initScheduler();

        // Timer nenhum pendente: o guard sai ANTES dos setTimeout, então não há
        // como o backfill dos 15s escrever no banco de produção. Avançar o relógio
        // além dos dois prazos confirma que não há nada para disparar.
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(120000);
        expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('avisa em WARN nomeando a flag — a sentinela alarma job em silêncio e quem diagnostica precisa distinguir "desligado" de "morreu"', () => {
        initScheduler();

        expect(logger.warn).toHaveBeenCalledTimes(1);
        const mensagem = vi.mocked(logger.warn).mock.calls[0][0];
        expect(mensagem).toContain('DISABLE_SCHEDULER');
    });
});

describe('sem a flag — comportamento idêntico ao de hoje', () => {
    beforeEach(() => {
        delete process.env.DISABLE_SCHEDULER;
    });

    it('registra todos os crons do catálogo', () => {
        const resultado = initScheduler();

        expect(cron.schedule).toHaveBeenCalledTimes(JOBS_ESPERADOS.length);
        expect(resultado).toEqual({ started: true });

        // Amostra das expressões: o jobId fica dentro do closure, então é pela
        // expressão que se confirma que os 15 min e o pós-mercado entraram.
        const expressoes = vi.mocked(cron.schedule).mock.calls.map(([expr]) => expr);
        expect(expressoes).toContain('*/15 * * * *');   // quotes-sync
        expect(expressoes).toContain('30 18 * * *');    // daily-evening (heavy)
        // Publicação âncora mensal: dia 1 às 07:30, FORA do pregão da B3
        // (10:00–18:00). Rodar durante o pregão gravaria candle parcial como
        // fechamento. É o cron que mais depende deste guard: mensal, publica no
        // Mongo de produção e não é `heavy` — logo, só DISABLE_SCHEDULER o cala.
        expect(expressoes).toContain('30 7 1 * *');     // monthly-anchor-publish
    });

    it('todo job esperado existe no catálogo da sentinela', () => {
        // Job registrado fora do jobCatalog é invisível para o alarme de silêncio.
        for (const jobId of JOBS_ESPERADOS) {
            expect(JOB_CATALOG, `'${jobId}' fora do jobCatalog`).toHaveProperty(jobId);
        }
    });

    it('mantém as rotinas de boot agendadas', () => {
        initScheduler();

        // Backfill + reconciliação sequencial (15s) e sentinela (45s).
        expect(vi.getTimerCount()).toBe(2);
    });

    it('valor diferente de "true" não desliga nada — default é registrar tudo', () => {
        process.env.DISABLE_SCHEDULER = 'false';
        expect(initScheduler()).toEqual({ started: true });
        expect(cron.schedule).toHaveBeenCalledTimes(JOBS_ESPERADOS.length);

        vi.mocked(cron.schedule).mockClear();
        vi.clearAllTimers();

        // Erro de digitação também não pode calar produção.
        process.env.DISABLE_SCHEDULER = 'TRUE ';
        expect(initScheduler()).toEqual({ started: true });
        expect(cron.schedule).toHaveBeenCalledTimes(JOBS_ESPERADOS.length);
    });
});

describe('EXTERNAL_SCHEDULER segue ortogonal', () => {
    it('cobre só os 3 jobs pesados — não é substituto do guard de instância', () => {
        const pesados = Object.entries(JOB_CATALOG)
            .filter(([, cfg]) => cfg.heavy)
            .map(([id]) => id);

        // Se um dia todos os jobs virarem `heavy`, este spec deixa de provar o
        // ponto — e a falha aqui é o aviso de que o raciocínio mudou.
        expect(pesados.length).toBeLessThan(JOBS_ESPERADOS.length);
        expect(pesados).toContain('daily-evening');
        // Justamente os dois vistos morrendo ficam de fora do EXTERNAL_SCHEDULER.
        expect(pesados).not.toContain('quotes-sync');
        expect(pesados).not.toContain('daily-morning');
    });
});

describe('lease também cobre entradas externas', () => {
    it('runDailySnapshot público disputa daily-snapshot antes de tocar o core', async () => {
        await expect(runDailySnapshot(false)).resolves.toMatchObject({
            skipped: true, reason: 'TEST_LEASE', jobId: 'daily-snapshot',
        });
        expect(withJobLease).toHaveBeenCalledWith('daily-snapshot', expect.any(Function));
    });
});
