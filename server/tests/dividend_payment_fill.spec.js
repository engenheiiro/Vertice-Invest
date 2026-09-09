/**
 * Gravação da data de pagamento (`dividendPaymentDateService`).
 *
 * O contrato aqui é fail-closed, e ele existe por um defeito concreto: até
 * 09/09/2026 o banco tinha 442 datas de pagamento que eram estimativa gravada
 * como se fosse anúncio, e a tela as exibia com selo de oficial. Estes testes
 * travam as regras que impedem isso de voltar:
 *
 *  · só grava o que a fonte publicou, com a procedência junto;
 *  · pagamento ambíguo ou fonte fora do ar NÃO viram data;
 *  · data que já existe não é reescrita;
 *  · classe fora do alcance das fontes não gasta requisição.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/DividendEvent.js', () => ({
    default: { find: vi.fn(), updateOne: vi.fn(), aggregate: vi.fn(), countDocuments: vi.fn() },
}));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn() } }));

const DividendEvent = (await import('../models/DividendEvent.js')).default;
const { fillPaymentDatesForTicker } = await import('../services/dividendPaymentDateService.js');

const dia = (iso) => new Date(`${iso}T00:00:00.000Z`);
const chain = (rows = []) => {
    const self = { select: () => self, sort: () => self, lean: async () => rows };
    return self;
};

/** Fonte de mentira com a mesma forma das reais, para não fazer HTTP no teste. */
const fonteFake = (eventos, { id = 'FAKE', sourceId = 'b3.dividends' } = {}) => ({
    id,
    sourceId,
    rotulo: id,
    buscar: vi.fn().mockResolvedValue(eventos),
});

const publicado = (dataCom, dataPagamento, valor) => ({
    dataCom: dia(dataCom),
    dataPagamento: dataPagamento ? dia(dataPagamento) : null,
    valor,
});

beforeEach(() => {
    vi.clearAllMocks();
    DividendEvent.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe('fillPaymentDatesForTicker — o caminho feliz', () => {
    it('grava a data publicada junto com a procedência', async () => {
        DividendEvent.find.mockReturnValue(chain([
            { _id: 'ev1', date: dia('2026-09-02'), amount: 0.1, source: 'PROVIDER' },
        ]));
        const fonte = fonteFake([publicado('2026-09-01', '2026-09-09', 0.1)]);

        const r = await fillPaymentDatesForTicker('GGRC11', 'FII', { cadeia: [fonte] });

        expect(r.preenchidos).toBe(1);
        expect(DividendEvent.updateOne).toHaveBeenCalledWith(
            { _id: 'ev1', paymentDate: { $in: [null, undefined] } },
            { $set: { paymentDate: dia('2026-09-09'), paymentDateSource: 'FAKE' } },
        );
    });

    it('só pergunta por eventos que ainda NÃO têm data', async () => {
        DividendEvent.find.mockReturnValue(chain([]));
        const fonte = fonteFake([]);

        await fillPaymentDatesForTicker('GGRC11', 'FII', { cadeia: [fonte] });

        expect(DividendEvent.find).toHaveBeenCalledWith(
            expect.objectContaining({ ticker: 'GGRC11', paymentDate: { $in: [null, undefined] } }),
        );
        // Sem pendências, nem chega a consultar a fonte.
        expect(fonte.buscar).not.toHaveBeenCalled();
    });

    it('a escrita repete a condição de nulo, para não atropelar um sync concorrente', async () => {
        DividendEvent.find.mockReturnValue(chain([
            { _id: 'ev1', date: dia('2026-09-02'), amount: 0.1, source: 'PROVIDER' },
        ]));
        await fillPaymentDatesForTicker('GGRC11', 'FII', { cadeia: [fonteFake([publicado('2026-09-01', '2026-09-09', 0.1)])] });

        const [filtro] = DividendEvent.updateOne.mock.calls[0];
        expect(filtro.paymentDate).toEqual({ $in: [null, undefined] });
    });
});

describe('fillPaymentDatesForTicker — fail-closed', () => {
    it('pagamento dividido em datas diferentes NÃO vira data', async () => {
        DividendEvent.find.mockReturnValue(chain([
            { _id: 'ev1', date: dia('2026-06-02'), amount: 0.70097272, source: 'PROVIDER' },
        ]));
        const fonte = fonteFake([
            publicado('2026-06-01', '2026-08-20', 0.35048636),
            publicado('2026-06-01', '2026-09-21', 0.35048636),
        ]);

        const r = await fillPaymentDatesForTicker('PETR4', 'STOCK', { cadeia: [fonte] });

        expect(r.preenchidos).toBe(0);
        expect(DividendEvent.updateOne).not.toHaveBeenCalled();
    });

    it('fonte fora do ar não grava nada e não derruba a rotina', async () => {
        DividendEvent.find.mockReturnValue(chain([
            { _id: 'ev1', date: dia('2026-09-02'), amount: 0.1, source: 'PROVIDER' },
        ]));
        const fonte = { id: 'FAKE', sourceId: 'b3.dividends', rotulo: 'FAKE', buscar: vi.fn().mockRejectedValue(new Error('HTTP 403')) };

        const r = await fillPaymentDatesForTicker('GGRC11', 'FII', { cadeia: [fonte] });

        expect(r.preenchidos).toBe(0);
        expect(r.falhas).toEqual([{ fonte: 'FAKE', motivo: 'HTTP 403' }]);
        expect(DividendEvent.updateOne).not.toHaveBeenCalled();
    });

    it('evento que a fonte não conhece fica sem data', async () => {
        DividendEvent.find.mockReturnValue(chain([
            { _id: 'ev1', date: dia('2026-09-02'), amount: 0.1, source: 'PROVIDER' },
        ]));
        const r = await fillPaymentDatesForTicker('GGRC11', 'FII', {
            cadeia: [fonteFake([publicado('2025-01-10', '2025-01-20', 0.1)])],
        });
        expect(r.preenchidos).toBe(0);
    });

    it('classe fora do alcance das fontes nem consulta o banco', async () => {
        for (const tipo of ['CRYPTO', 'STOCK_US', 'ETF', 'FIXED_INCOME']) {
            const r = await fillPaymentDatesForTicker('QUALQUER', tipo, { cadeia: [fonteFake([])] });
            expect(r.preenchidos).toBe(0);
        }
        expect(DividendEvent.find).not.toHaveBeenCalled();
    });
});

describe('fillPaymentDatesForTicker — cadeia de fontes', () => {
    it('a segunda fonte só é consultada pelo que a primeira não datou', async () => {
        DividendEvent.find.mockReturnValue(chain([
            { _id: 'ev1', date: dia('2026-09-02'), amount: 0.1, source: 'PROVIDER' },
            { _id: 'ev2', date: dia('2020-03-03'), amount: 0.2, source: 'PROVIDER' },
        ]));
        // A B3 só alcança ~12 meses: conhece o recente e não o antigo.
        const primeira = fonteFake([publicado('2026-09-01', '2026-09-09', 0.1)], { id: 'B3' });
        const segunda = fonteFake([publicado('2020-03-02', '2020-03-12', 0.2)], { id: 'FUNDAMENTUS', sourceId: 'fundamentus.dividends' });

        const r = await fillPaymentDatesForTicker('GGRC11', 'FII', { cadeia: [primeira, segunda] });

        expect(r.preenchidos).toBe(2);
        expect(segunda.buscar).toHaveBeenCalledTimes(1);
        const fontes = DividendEvent.updateOne.mock.calls.map(([, up]) => up.$set.paymentDateSource);
        expect(fontes).toEqual(['B3', 'FUNDAMENTUS']);
    });

    it('a cadeia para quando a primeira fonte já datou tudo', async () => {
        DividendEvent.find.mockReturnValue(chain([
            { _id: 'ev1', date: dia('2026-09-02'), amount: 0.1, source: 'PROVIDER' },
        ]));
        const primeira = fonteFake([publicado('2026-09-01', '2026-09-09', 0.1)], { id: 'B3' });
        const segunda = fonteFake([], { id: 'FUNDAMENTUS', sourceId: 'fundamentus.dividends' });

        await fillPaymentDatesForTicker('GGRC11', 'FII', { cadeia: [primeira, segunda] });

        expect(segunda.buscar).not.toHaveBeenCalled();
    });

    it('provento PROVISÓRIO é datado mesmo com o valor divergindo — o valor dele é dedução nossa', async () => {
        DividendEvent.find.mockReturnValue(chain([
            { _id: 'ev1', date: dia('2026-09-02'), amount: 0.815, source: 'DERIVED' },
        ]));
        const r = await fillPaymentDatesForTicker('KNHF11', 'FII', {
            cadeia: [fonteFake([publicado('2026-09-01', '2026-09-09', 0.66)])],
        });
        expect(r.preenchidos).toBe(1);
    });

    it('provento OFICIAL com valor divergente NÃO é datado — aí a divergência é suspeita', async () => {
        DividendEvent.find.mockReturnValue(chain([
            { _id: 'ev1', date: dia('2026-09-02'), amount: 0.815, source: 'PROVIDER' },
        ]));
        const r = await fillPaymentDatesForTicker('KNHF11', 'FII', {
            cadeia: [fonteFake([publicado('2026-09-01', '2026-09-09', 0.66)])],
        });
        expect(r.preenchidos).toBe(0);
    });
});
