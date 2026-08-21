import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// SINCRONIZAÇÃO DIÁRIA DA SÉRIE USD/BRL
//
// A série `USD-BRL` (AssetHistory) é resolvida POR DATA no rebuild de histórico
// e no snapshot patrimonial. Rodando uma vez por semana ('0 6 * * 1'), ela
// envelhecia ao longo dos dias úteis — em 21/08/2026 o último candle era de
// 14/08. Para toda data posterior ao último candle, `buildUsdRateResolver`
// devolve a cotação CORRENTE (de propósito: uma compra de hoje não pode nascer
// com o câmbio da semana passada no custo), então cinco dias seguidos do rebuild
// recebiam a MESMA taxa: a variação cambial do período era achatada em zero e
// reaparecia de uma vez quando a série alcançava. Como o WalletSnapshot é a base
// do TWRR e do Sharpe, o degrau virava ruído na série de risco.
//
// O que fica travado aqui:
//  1. Cadência diária, e ANTES dos consumidores do mesmo dia (18:30 e 23:59).
//  2. A gravação é UNIÃO, nunca substituição: `USD-BRL` é isento do cap de
//     histórico porque converte compras antigas, e a fonte só devolve 730 dias.
//  3. O efeito final: dias consecutivos resolvem taxas DISTINTAS.
// ─────────────────────────────────────────────────────────────────────────────

// Banco falso: um único documento USD-BRL em memória.
const db = { usdBrl: null };

vi.mock('../models/AssetHistory.js', () => ({
    default: {
        findOne: () => ({
            select: () => ({ lean: async () => db.usdBrl }),
            lean: async () => db.usdBrl,
        }),
        findOneAndUpdate: async (_filter, update) => {
            db.usdBrl = { ...update.$set, history: update.$set.history.map((h) => ({ ...h })) };
            return db.usdBrl;
        },
    },
}));

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() },
}));

// Nenhum cron de verdade, e nenhuma rotina executada: o wrapper de observabilidade
// vira um espião que só devolve o jobId — é o que permite mapear expressão → job
// sem disparar o job.
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../utils/jobRun.js', () => ({
    trackJob: vi.fn(),
    trackJobSafe: vi.fn(async (jobId) => jobId),
}));

const { default: axios } = await import('axios');
const { default: cron } = await import('node-cron');
const { trackJobSafe } = await import('../utils/jobRun.js');
const { macroDataService } = await import('../services/macroDataService.js');
const { loadUsdRateResolver } = await import('../utils/fxRate.js');
const { JOB_CATALOG } = await import('../config/jobCatalog.js');

const candle = (date, close) => ({ date, close, adjClose: close });

beforeEach(() => { db.usdBrl = null; });
afterEach(() => { vi.restoreAllMocks(); });

describe('_persistUsdHistory — união com a série existente, nunca substituição', () => {
    it('preserva candles mais antigos que a janela da fonte', async () => {
        // A AwesomeAPI devolve 730 dias; uma compra de 2022 precisa da taxa DAQUELE
        // dia. Um $set cru jogaria fora tudo que a fonte não repete.
        db.usdBrl = { ticker: 'USD-BRL', history: [candle('2022-03-10', 5.02)] };

        const out = await macroDataService._persistUsdHistory(
            [candle('2026-08-20', 5.31), candle('2026-08-21', 5.28)],
            'AwesomeAPI',
        );

        expect(db.usdBrl.history.map((h) => h.date)).toEqual(['2022-03-10', '2026-08-20', '2026-08-21']);
        expect(out).toMatchObject({ total: 3, fetched: 2, lastDate: '2026-08-21', source: 'AwesomeAPI' });
    });

    it('resposta curta/parcial não amputa a série', async () => {
        // A validação antiga só exigia "não-vazia": uma resposta com 1 dia passava e
        // substituía os 730 do banco. Agora a escrita acontece 7x por semana.
        db.usdBrl = {
            ticker: 'USD-BRL',
            history: Array.from({ length: 300 }, (_, i) => {
                const dia = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
                return candle(dia, 5);
            }),
        };

        await macroDataService._persistUsdHistory([candle('2026-08-21', 5.28)], 'AwesomeAPI');

        expect(db.usdBrl.history).toHaveLength(301);
        expect(db.usdBrl.history[0].date).toBe('2024-01-01');
        expect(db.usdBrl.history.at(-1).date).toBe('2026-08-21');
    });

    it('data repetida fica com o valor NOVO (correção da fonte vale)', async () => {
        db.usdBrl = { ticker: 'USD-BRL', history: [candle('2026-08-20', 9.99)] };

        await macroDataService._persistUsdHistory([candle('2026-08-20', 5.31)], 'AwesomeAPI');

        expect(db.usdBrl.history).toEqual([{ date: '2026-08-20', close: 5.31, adjClose: 5.31 }]);
    });

    it('descarta candle corrompido (taxa ≤ 0 ou data malformada)', async () => {
        await macroDataService._persistUsdHistory(
            [candle('2026-08-20', 5.31), candle('2026-08-21', 0), candle('ontem', 5.4), { close: 5.5 }],
            'AwesomeAPI',
        );

        expect(db.usdBrl.history).toEqual([{ date: '2026-08-20', close: 5.31, adjClose: 5.31 }]);
    });

    it('sem nenhuma entrada válida, não escreve e preserva o que já existe', async () => {
        db.usdBrl = { ticker: 'USD-BRL', history: [candle('2026-08-20', 5.31)] };

        const out = await macroDataService._persistUsdHistory([{ date: 'lixo', close: -1 }], 'AwesomeAPI');

        expect(out).toBeNull();
        expect(db.usdBrl.history).toEqual([candle('2026-08-20', 5.31)]);
    });

    it('grava em ordem cronológica mesmo com a fonte invertida', async () => {
        // A AwesomeAPI devolve do mais recente para o mais antigo, e a busca binária
        // do resolvedor depende da ordem.
        await macroDataService._persistUsdHistory(
            [candle('2026-08-21', 5.28), candle('2026-08-19', 5.33), candle('2026-08-20', 5.31)],
            'AwesomeAPI',
        );

        expect(db.usdBrl.history.map((h) => h.date)).toEqual(['2026-08-19', '2026-08-20', '2026-08-21']);
    });
});

describe('syncHistoricalUSDRate — devolve o resumo do que gravou', () => {
    it('mapeia o payload da AwesomeAPI e reporta o último candle', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({
            data: [
                { bid: '5.2800', timestamp: String(Math.floor(Date.UTC(2026, 7, 21, 20, 0) / 1000)) },
                { bid: '5.3100', timestamp: String(Math.floor(Date.UTC(2026, 7, 20, 20, 0) / 1000)) },
            ],
        });

        const out = await macroDataService.syncHistoricalUSDRate();

        expect(out).toMatchObject({ total: 2, lastDate: '2026-08-21', source: 'AwesomeAPI' });
        expect(db.usdBrl.history[0]).toMatchObject({ date: '2026-08-20', close: 5.31 });
    });

    it('fonte fora do ar e fallback também → null, sem tocar na série', async () => {
        db.usdBrl = { ticker: 'USD-BRL', history: [candle('2026-08-20', 5.31)] };
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('ECONNRESET'));
        const { externalMarketService } = await import('../services/externalMarketService.js');
        vi.spyOn(externalMarketService, 'getFullHistory').mockResolvedValue(null);

        expect(await macroDataService.syncHistoricalUSDRate()).toBeNull();
        expect(db.usdBrl.history).toEqual([candle('2026-08-20', 5.31)]);
    });
});

describe('efeito no resolvedor de câmbio por data', () => {
    const SEMANA = [
        candle('2026-08-17', 5.4012),
        candle('2026-08-18', 5.3688),
        candle('2026-08-19', 5.3301),
        candle('2026-08-20', 5.3120),
    ];
    const DIAS = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'];
    const SPOT = 5.2800;

    it('série em dia → cada dia útil resolve a SUA taxa', async () => {
        await macroDataService._persistUsdHistory([candle('2026-08-14', 5.4455), ...SEMANA], 'AwesomeAPI');

        const resolve = await loadUsdRateResolver(SPOT);
        const taxas = DIAS.map(resolve);

        expect(taxas).toEqual([5.4012, 5.3688, 5.3301, 5.3120]);
        expect(new Set(taxas).size).toBe(4);
    });

    it('regressão: com a série parada em D-7, os quatro dias colapsam na cotação de hoje', async () => {
        // Estado observado em 21/08/2026 com o cron semanal.
        await macroDataService._persistUsdHistory([candle('2026-08-14', 5.4455)], 'AwesomeAPI');

        const resolve = await loadUsdRateResolver(SPOT);
        const taxas = DIAS.map(resolve);

        expect(new Set(taxas).size).toBe(1);
        expect(taxas[0]).toBe(SPOT);
    });
});

describe('cadência do cron fx-history', () => {
    const flagOriginal = process.env.DISABLE_SCHEDULER;
    const expressaoDe = new Map();

    // Minuto do dia de uma expressão 'm h * * *' — a ordem entre os crons é o que
    // garante que o câmbio chegue antes de quem o consome.
    const minutoDoDia = (expressao) => {
        const [m, h] = expressao.split(' ');
        return Number(h) * 60 + Number(m);
    };

    beforeAll(async () => {
        // Timers falsos só para o backfill de boot (15s) não falar com o Mongo.
        vi.useFakeTimers();
        delete process.env.DISABLE_SCHEDULER;
        const { initScheduler } = await import('../services/schedulerService.js');
        vi.mocked(cron.schedule).mockClear();
        initScheduler();

        // A closure registrada no cron só chama trackJobSafe(jobId, fn) — invocá-la
        // revela o jobId sem executar rotina nenhuma (trackJobSafe está mockado).
        for (const [expressao, callback] of vi.mocked(cron.schedule).mock.calls) {
            vi.mocked(trackJobSafe).mockClear();
            callback();
            const jobId = vi.mocked(trackJobSafe).mock.calls[0]?.[0];
            if (jobId) expressaoDe.set(jobId, expressao);
        }
    });

    afterAll(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        if (flagOriginal === undefined) delete process.env.DISABLE_SCHEDULER;
        else process.env.DISABLE_SCHEDULER = flagOriginal;
    });

    it('roda todo dia, não uma vez por semana', () => {
        const expressao = expressaoDe.get('fx-history');
        expect(expressao).toBe('10 18 * * *');
        // Dia-da-semana curinga: uma segunda feriado não pode adiar a série para terça.
        expect(expressao.split(' ')[4]).toBe('*');
    });

    it('dispara ANTES dos consumidores que resolvem câmbio por data no mesmo dia', () => {
        const fx = minutoDoDia(expressaoDe.get('fx-history'));
        // daily-evening: sync + timeSeriesWorker + ranking. daily-snapshot: WalletSnapshot.
        expect(fx).toBeLessThan(minutoDoDia(expressaoDe.get('daily-evening')));
        expect(fx).toBeLessThan(minutoDoDia(expressaoDe.get('daily-snapshot')));
    });

    it('é cron leve — não some in-app quando os pesados vão para o Render', () => {
        // scheduleHeavy some com EXTERNAL_SCHEDULER=true, e é exatamente nessa
        // configuração que o snapshot das 23:59 mais precisa do câmbio fresco.
        expect(JOB_CATALOG['fx-history'].heavy).toBeUndefined();
    });

    it('o teto de silêncio da sentinela acompanha a cadência diária', () => {
        // 192h (8 dias) tolerava o cron morto por uma semana inteira sem alarme.
        expect(JOB_CATALOG['fx-history'].maxSilenceHours).toBe(30);
        expect(JOB_CATALOG['fx-history'].severity).toBe('CRITICAL');
    });
});
