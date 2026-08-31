import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Retenção do funil: quem é RENOVAÇÃO e quem é venda nova.
 *
 * A primeira versão respondia isso pela idade da CONTA — se o cadastro era
 * anterior à janela, o pagamento virava renovação. Num produto novo, quase toda
 * venda sai da base gratuita acumulada, então praticamente toda estreia era
 * contada como renovação e o churn (`perdidos / (perdidos + renovados)`) saía
 * menor do que a realidade. O número existe para dizer se o produto segura quem
 * entra; enfeitado, ele não serve para nada.
 *
 * A regra correta é PAGAMENTO anterior à janela.
 */

vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/User.js', () => ({
    default: { find: vi.fn(), countDocuments: vi.fn(), estimatedDocumentCount: vi.fn() },
}));
vi.mock('../models/UserAsset.js', () => ({ default: { aggregate: vi.fn() } }));
vi.mock('../models/Transaction.js', () => ({ default: { aggregate: vi.fn() } }));

const User = (await import('../models/User.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const Transaction = (await import('../models/Transaction.js')).default;
const { getFunnelReport } = await import('../services/funnelService.js');

const DIA = 24 * 60 * 60 * 1000;
const agora = Date.now();
const diasAtras = (dias) => new Date(agora - dias * DIA);

/** Encadeamento `.select().lean()` do Mongoose, com o resultado já pronto. */
const consulta = (linhas) => ({ select: () => ({ lean: () => Promise.resolve(linhas) }) });

/**
 * @param {object} cenario
 * @param {Array} cenario.vigentes      contas com período em aberto agora
 * @param {Map}   cenario.primeiroPagamento  id → data do primeiro pagamento
 * @param {Array} cenario.pagouNaJanela ids que pagaram nos últimos 30 dias
 * @param {number} cenario.perdidos     períodos vencidos na janela sem volta
 */
const montarBanco = ({ vigentes = [], primeiroPagamento = new Map(), pagouNaJanela = [], perdidos = 0 }) => {
    User.find.mockImplementation((query) => (
        query?.plan
            ? consulta(vigentes)
            : consulta(vigentes.map((v) => ({ _id: v._id, createdAt: diasAtras(120) })))
    ));
    User.countDocuments.mockResolvedValue(perdidos);
    User.estimatedDocumentCount.mockResolvedValue(vigentes.length);
    UserAsset.aggregate.mockResolvedValue([]);

    Transaction.aggregate.mockImplementation((pipeline) => {
        // Duas consultas com a mesma cara: a do PRIMEIRO pagamento agrupa com
        // `at`, a dos pagantes da janela agrupa só o id.
        const agrupaData = Boolean(pipeline?.[1]?.$group?.at);
        if (agrupaData) {
            return Promise.resolve([...primeiroPagamento].map(([id, at]) => ({ _id: id, at })));
        }
        return Promise.resolve(pagouNaJanela.map((id) => ({ _id: id })));
    });
};

const assinante = (id) => ({ _id: id, plan: 'PRO', billingCycle: 'MONTHLY' });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Renovação x venda nova', () => {
    it('conta como renovação quem já pagava antes da janela', async () => {
        montarBanco({
            vigentes: [assinante('veterano')],
            primeiroPagamento: new Map([['veterano', diasAtras(90)]]),
            pagouNaJanela: ['veterano'],
            perdidos: 1,
        });

        const { retention } = await getFunnelReport({ months: 3 });

        expect(retention.renewed).toBe(1);
        expect(retention.lost).toBe(1);
        expect(retention.churnRate).toBeCloseTo(0.5);
    });

    it('NÃO conta como renovação a primeira compra de um cadastro antigo', async () => {
        // O caso que quebrava: conta de 120 dias, primeira assinatura hoje.
        // Como venda nova, ela não pertence à base de retenção — o churn tem de
        // continuar 100% (um vencimento, nenhuma renovação).
        montarBanco({
            vigentes: [assinante('estreante')],
            primeiroPagamento: new Map([['estreante', diasAtras(5)]]),
            pagouNaJanela: ['estreante'],
            perdidos: 1,
        });

        const { retention } = await getFunnelReport({ months: 3 });

        expect(retention.renewed).toBe(0);
        expect(retention.dueInWindow).toBe(1);
        expect(retention.churnRate).toBe(1);
    });

    it('não conta quem pagou na janela mas já não está vigente', async () => {
        // Estorno ou período que venceu depois do pagamento: não é retenção.
        montarBanco({
            vigentes: [],
            primeiroPagamento: new Map([['sumiu', diasAtras(200)]]),
            pagouNaJanela: ['sumiu'],
            perdidos: 1,
        });

        const { retention } = await getFunnelReport({ months: 3 });

        expect(retention.renewed).toBe(0);
        expect(retention.activeNow).toBe(0);
    });

    it('separa veterano de estreante na mesma janela', async () => {
        montarBanco({
            vigentes: [assinante('veterano'), assinante('estreante')],
            primeiroPagamento: new Map([
                ['veterano', diasAtras(200)],
                ['estreante', diasAtras(2)],
            ]),
            pagouNaJanela: ['veterano', 'estreante'],
            perdidos: 3,
        });

        const { retention } = await getFunnelReport({ months: 3 });

        expect(retention.renewed).toBe(1);
        expect(retention.churnRate).toBeCloseTo(0.75);
        // Base pequena continua marcada: 3 saídas não sustentam conclusão.
        expect(retention.significant).toBe(false);
    });

    it('sem vencimento nenhum, o churn é "sem base" — não zero', async () => {
        montarBanco({ vigentes: [assinante('novo')], perdidos: 0 });

        const { retention } = await getFunnelReport({ months: 3 });

        expect(retention.dueInWindow).toBe(0);
        expect(retention.churnRate).toBeNull();
    });
});
