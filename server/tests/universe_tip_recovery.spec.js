/**
 * A PONTA DO UNIVERSO GANHA SEGUNDA CHANCE.
 *
 * O estado que motiva a rotina foi medido em 09/09/2026: das 1.253 séries ativas,
 * 1.002 ficaram sem o fechamento do pregão — e nenhuma por falha de fonte. São
 * duas réguas nossas discordando: `isHistoryStale` tolera ~1 pregão de atraso de
 * propósito (e por isso o Yahoo nem foi consultado), enquanto `reinforceWithB3`
 * lê essa mesma ponta como lacuna e desce para a B3, cujo arquivo ainda não
 * estava publicado às 18:30. O arquivo subiu à noite e ficou disponível o dia
 * inteiro seguinte sem que ninguém voltasse lá: a recuperação horária que já
 * existia só cobre ativo EM CARTEIRA.
 *
 * O que estes testes prendem é o contrato dessa segunda passagem — e, tão
 * importante quanto o dado, a CURA DO LEDGER: consertar a série sem sobrescrever
 * a escalada deixaria o painel vermelho por 24h sobre uma falha que já não existe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    marketAssetFind: vi.fn(),
    marketAssetBulkWrite: vi.fn(),
    historyFind: vi.fn(),
    historyAggregate: vi.fn(),
    historyUpdateOne: vi.fn(),
    historyUpdateMany: vi.fn(),
    historyBulkWrite: vi.fn(),
    systemConfigUpdate: vi.fn(),
    getFullHistory: vi.fn(),
    getBenchmarkHistory: vi.fn(),
    fetchB3DailyCloses: vi.fn(),
}));

vi.mock('../models/MarketAsset.js', () => ({
    default: { find: mocks.marketAssetFind, bulkWrite: mocks.marketAssetBulkWrite },
}));
vi.mock('../models/AssetHistory.js', () => ({
    default: {
        find: mocks.historyFind,
        aggregate: mocks.historyAggregate,
        updateOne: mocks.historyUpdateOne,
        updateMany: mocks.historyUpdateMany,
        bulkWrite: mocks.historyBulkWrite,
    },
}));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOneAndUpdate: mocks.systemConfigUpdate } }));
vi.mock('../services/externalMarketService.js', () => ({
    externalMarketService: { getFullHistory: mocks.getFullHistory },
}));
vi.mock('../services/marketDataService.js', () => ({
    marketDataService: { getBenchmarkHistory: mocks.getBenchmarkHistory },
}));
vi.mock('../services/b3DailyFileService.js', () => ({
    fetchB3DailyCloses: (...a) => mocks.fetchB3DailyCloses(...a),
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { lastClosedSessionDay, recoverUniverseTipWithB3 } = await import('../services/workers/timeSeriesWorker.js');
const { getEscalations, recordEscalation, resetSourceStats } = await import('../utils/sourceHealth.js');

const PREGAO = '2026-09-09';   // quarta — o último pregão FECHADO
const VESPERA = '2026-09-08';  // terça
// Quinta, 14:00 BRT: a sessão de hoje está aberta, então o alvo é a quarta.
const AGORA = new Date('2026-09-10T17:00:00.000Z');

const candles = (n, lastDate) => {
    const end = new Date(`${lastDate}T00:00:00Z`).getTime();
    return Array.from({ length: n }, (_, i) => ({
        date: new Date(end - (n - 1 - i) * 86400000).toISOString().slice(0, 10),
        close: 100 + i,
        adjClose: 100 + i,
        volume: 1000,
    }));
};

const universo = (assets) => ({ select: () => ({ lean: async () => assets }) });
const docsDeSerie = (docs) => ({ lean: async () => docs });

/** Arquivo da B3 do pregão, no formato que `fetchB3DailyCloses` devolve. */
const arquivo = (tickers) => new Map(tickers.map((t) => [t, { close: 42.5, volume: 9999, trades: 10 }]));

const ITSA4 = { ticker: 'ITSA4', type: 'STOCK' };

const cenario = ({ ponta = VESPERA, arquivoDoDia = arquivo(['ITSA4']), assets = [ITSA4] } = {}) => {
    mocks.marketAssetFind.mockReturnValue(universo(assets));
    mocks.historyAggregate.mockResolvedValue(
        ponta === null ? [] : assets.map((a) => ({ ticker: a.ticker, tip: ponta })),
    );
    mocks.historyFind.mockReturnValue(docsDeSerie(
        assets.map((a) => ({ ticker: a.ticker, history: candles(40, ponta || VESPERA) })),
    ));
    mocks.fetchB3DailyCloses.mockResolvedValue(arquivoDoDia);
    mocks.historyBulkWrite.mockResolvedValue({ ok: 1 });
};

const escaladaDe = (ticker) => getEscalations().find((e) => e.subject === ticker && e.chain === 'candle');

beforeEach(() => {
    resetSourceStats();
    vi.clearAllMocks();
});

describe('lastClosedSessionDay', () => {
    it('durante o pregão o alvo é a VÉSPERA, não o dia de hoje', () => {
        // 09:25 BRT de uma quinta. Ancorar em `lastBusinessDayUpTo(hoje)` devolveria
        // a própria quinta, `sessaoJaFechou` recusaria, e a varredura passaria o dia
        // inteiro sem fazer nada — justamente quando há um fechamento pendente.
        expect(lastClosedSessionDay(new Date('2026-09-10T12:25:00.000Z'))).toBe('2026-09-09');
    });

    it('depois das 18h o pregão do dia vira o alvo', () => {
        expect(lastClosedSessionDay(new Date('2026-09-10T21:30:00.000Z'))).toBe('2026-09-10');
    });

    it('fim de semana olha para a última sexta', () => {
        // Sábado 12/09 → sexta 11/09, já fechada.
        expect(lastClosedSessionDay(new Date('2026-09-12T18:00:00.000Z'))).toBe('2026-09-11');
    });
});

describe('recoverUniverseTipWithB3', () => {
    it('sem lacuna, sai em duas consultas e não toca a B3', async () => {
        // O caso normal — 15 execuções por dia. Se esta rotina custar rede quando
        // não há o que fazer, ela vira um problema em vez de um conserto.
        cenario({ ponta: PREGAO });

        const r = await recoverUniverseTipWithB3({ now: AGORA });

        expect(r).toMatchObject({ status: 'SUCCESS', day: PREGAO, targets: 0 });
        expect(mocks.fetchB3DailyCloses).not.toHaveBeenCalled();
        expect(mocks.historyBulkWrite).not.toHaveBeenCalled();
    });

    it('arquivo publicado depois do run fecha a ponta e CURA o ledger', async () => {
        // A linha que o run das 18:30 deixou: vermelha, sem resolvedBy.
        recordEscalation({
            chain: 'candle', subject: 'ITSA4', tried: ['yahoo.history', 'b3'],
            resolvedBy: null, reason: 'arquivo ainda não publicado', expected: false,
        });
        expect(escaladaDe('ITSA4').resolvedBy).toBeNull();

        cenario();
        const r = await recoverUniverseTipWithB3({ now: AGORA });

        expect(r).toMatchObject({ targets: 1, recovered: 1, written: 1, missing: 0 });

        // O candle do pregão entrou na série.
        const [[ops]] = mocks.historyBulkWrite.mock.calls;
        const historyGravado = ops[0].updateOne.update.$set.history;
        expect(historyGravado.at(-1).date).toBe(PREGAO);

        // E a linha do painel deixou de acusar a cadeia. Sem isto, o dado ficaria
        // certo e a tela seguiria vermelha por 24h.
        expect(escaladaDe('ITSA4').resolvedBy).toBe('b3');
    });

    it('não renova lastCheckedAt — a fila do worker não é desta rotina', async () => {
        cenario();
        await recoverUniverseTipWithB3({ now: AGORA });

        const [[ops]] = mocks.historyBulkWrite.mock.calls;
        const set = ops[0].updateOne.update.$set;
        expect(set).toHaveProperty('lastUpdated');
        expect(set).not.toHaveProperty('lastCheckedAt');
    });

    it('arquivo ainda ausente: nada gravado e a escalada segue acusando a cadeia', async () => {
        cenario({ arquivoDoDia: null });

        const r = await recoverUniverseTipWithB3({ now: AGORA });

        expect(r).toMatchObject({ targets: 1, recovered: 0, missing: 1, written: 0 });
        expect(mocks.historyBulkWrite).not.toHaveBeenCalled();
        expect(escaladaDe('ITSA4')).toMatchObject({ resolvedBy: null, expected: false });
    });

    it('papel fora do arquivo publicado é ausência ESPERADA, não falha', async () => {
        // O arquivo do dia está no ar e ITSA4 não está nele: o papel não negociou.
        // Fechamento que não existe não é dado que faltou — pintar de vermelho
        // ensina o dono a ignorar a lista (foram 49 ilíquidos em 08/09/2026).
        cenario({ arquivoDoDia: arquivo(['PETR4']) });

        const r = await recoverUniverseTipWithB3({ now: AGORA });

        expect(r).toMatchObject({ targets: 1, recovered: 0, noTrade: 1, missing: 0 });
        expect(escaladaDe('ITSA4')).toMatchObject({ resolvedBy: null, expected: true });
    });

    it('série vazia não vira alvo — a B3 estende ponta, não reconstrói histórico', async () => {
        cenario({ ponta: null });

        const r = await recoverUniverseTipWithB3({ now: AGORA });

        expect(r.targets).toBe(0);
        expect(mocks.fetchB3DailyCloses).not.toHaveBeenCalled();
    });

    /**
     * O CAMINHO QUE ESTA ROTINA PODE DECLARAR é só o dela: ela não chama o Yahoo.
     *
     * Enquanto o elo só tinha dois estados, as 523 séries que a B3 socorreu em
     * 10/09/2026 saíram na tela com "Yahoo histórico" riscado — e o card dele
     * levou 523 `missed` de chamadas que nunca aconteceram. Quem não entregou o
     * fechamento ali foi a régua de staleness, que poupou a fonte de propósito.
     */
    it('o Yahoo entra como NÃO CONSULTADO — esta varredura não o chama', async () => {
        cenario();

        await recoverUniverseTipWithB3({ now: AGORA });

        expect(mocks.getFullHistory).not.toHaveBeenCalled();
        const ev = escaladaDe('ITSA4');
        expect(ev.tried).toEqual(['yahoo.history', 'b3']);
        expect(ev.skipped).toEqual(['yahoo.history']);
        expect(ev.resolvedBy).toBe('b3');
        expect(ev.reason).toContain('sem consultar o Yahoo');
        expect(ev.session).toBe(PREGAO);
    });

    // A cura do ledger reescreve a linha de OUTRA rotina, e aí o cuidado se
    // inverte: se o run das 18:30 chamou o Yahoo de verdade para este mesmo
    // pregão e não recebeu o fechamento, essa medição não é nossa para apagar.
    it('medição do run das 18:30 sobrevive à cura', async () => {
        recordEscalation({
            chain: 'candle', subject: 'ITSA4', tried: ['yahoo.history', 'b3'],
            skipped: [], resolvedBy: null, session: PREGAO,
            reason: 'O Yahoo publicou a série sem o fechamento de 2026-09-09',
        });

        cenario();
        await recoverUniverseTipWithB3({ now: AGORA });

        const ev = escaladaDe('ITSA4');
        expect(ev.resolvedBy).toBe('b3');
        expect(ev.skipped).toEqual([]);
        expect(ev.reason).toContain('sem o fechamento');
    });

    // Herança presa ao pregão: a linha de ontem fala de outro dia, e assumi-la
    // reintroduziria a acusação falsa um dia atrasada.
    it('não herda a medição de OUTRO pregão', async () => {
        recordEscalation({
            chain: 'candle', subject: 'ITSA4', tried: ['yahoo.history', 'b3'],
            skipped: [], resolvedBy: null, session: VESPERA,
        });

        cenario();
        await recoverUniverseTipWithB3({ now: AGORA });

        expect(escaladaDe('ITSA4').skipped).toEqual(['yahoo.history']);
    });

    it('ativo fora do alcance da B3 nem entra na conta', async () => {
        // Cripto e ação americana não passam pelo regex da bolsa brasileira. Cobrar
        // delas o calendário da B3 seria alarme falso a cada feriado de lá.
        cenario({ assets: [{ ticker: 'AAPL', type: 'STOCK_US' }, { ticker: 'BTC', type: 'CRYPTO' }] });

        const r = await recoverUniverseTipWithB3({ now: AGORA });

        expect(r).toMatchObject({ status: 'SKIPPED', targets: 0 });
        expect(mocks.fetchB3DailyCloses).not.toHaveBeenCalled();
    });
});
