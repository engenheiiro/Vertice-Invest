/**
 * goalsController — contrato HTTP das metas: lista e detalhe com projeção sobre
 * o patrimônio AO VIVO da carteira (com fallback no snapshot), criação herdando
 * jornada, edição/religamento, jornada nomeada, aportes manuais e exclusões.
 *
 * Sem banco: models, mongoose e serviços mockados (o `.env` local aponta para
 * produção). goalMath/goalRate/goalChain rodam de verdade.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

const h = vi.hoisted(() => {
    const chain = (value) => {
        const q = {};
        for (const m of ['sort', 'limit', 'select', 'lean', 'populate']) q[m] = vi.fn(() => q);
        q.exec = () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
        q.then = (ok, fail) => q.exec().then(ok, fail);
        return q;
    };
    return { chain, state: {} };
});

vi.mock('mongoose', () => {
    class ObjectId { constructor(v) { this.v = v; } }
    return {
        default: {
            Types: { ObjectId },
            connect: vi.fn(() => { throw new Error('conexão real proibida em teste'); }),
        },
    };
});
vi.mock('../services/holidayService.js', () => ({
    holidayService: { sync: vi.fn(async () => true), isHoliday: () => false },
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/marketDataService.js', () => ({
    marketDataService: { refreshQuotesBatch: vi.fn(), getMarketDataMap: vi.fn() },
}));
vi.mock('../services/treasuryPriceService.js', () => ({
    loadTreasuryPricing: vi.fn(async () => ({ historyFor: () => null })),
}));
vi.mock('../models/InvestmentGoal.js', () => ({
    default: {
        find: vi.fn(), findOne: vi.fn(), countDocuments: vi.fn(), create: vi.fn(), distinct: vi.fn(),
        findOneAndDelete: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn(),
    },
}));
vi.mock('../models/GoalJourney.js', () => ({ default: { deleteMany: vi.fn(), findOneAndUpdate: vi.fn(), create: vi.fn() } }));
vi.mock('../models/GoalContribution.js', () => ({
    default: { find: vi.fn(), aggregate: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), findOneAndDelete: vi.fn() },
}));
vi.mock('../models/AssetTransaction.js', () => ({ default: { aggregate: vi.fn() } }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: { findOne: vi.fn(), find: vi.fn() } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));

const InvestmentGoal = (await import('../models/InvestmentGoal.js')).default;
const GoalJourney = (await import('../models/GoalJourney.js')).default;
const GoalContribution = (await import('../models/GoalContribution.js')).default;
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const WalletSnapshot = (await import('../models/WalletSnapshot.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const SystemConfig = (await import('../models/SystemConfig.js')).default;
const { marketDataService } = await import('../services/marketDataService.js');
const logger = (await import('../config/logger.js')).default;
const ctrl = await import('../controllers/goalsController.js');

const { chain, state } = h;

const mockRes = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = vi.fn((c) => { res.statusCode = c; return res; });
    res.json = vi.fn((b) => { res.body = b; return res; });
    return res;
};

const call = async (handler, req = {}) => {
    const res = mockRes();
    const next = vi.fn();
    await handler({ user: { id: 'u1', plan: 'PRO' }, walletId: 'w1', query: {}, params: {}, body: {}, ...req }, res, next);
    return { res, next };
};

// Documento de meta falso: campos + save/toObject, como o do Mongoose.
const goalDoc = (fields = {}) => {
    const doc = {
        _id: 'g1', status: 'ACTIVE', targetAmount: 10000, monthlyTarget: 500, expectedAnnualRate: 10,
        manualBalance: 0, mirrorWallet: true, startValue: 1000, startDate: new Date('2026-06-01T12:00:00.000Z'),
        lastCelebratedMilestone: 0, journey: null, previousGoalId: null,
        ...fields,
    };
    doc.save = vi.fn(async () => doc);
    doc.toObject = () => {
        const { save, toObject, ...plain } = doc;
        return plain;
    };
    return doc;
};

const NOW = new Date('2026-11-24T18:00:00.000Z');
beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, {
        assets: [{ ticker: 'PETR4', type: 'STOCK', quantity: 100 }],
        quotes: new Map([['PETR4', { price: 35 }]]),
        latestSnapshot: { date: new Date('2026-11-24T02:59:00.000Z'), totalEquity: 3200, quotaPrice: 104 },
        snapshots: [],
    });
    WalletSnapshot.findOne.mockImplementation(() => chain(state.latestSnapshot));
    WalletSnapshot.find.mockImplementation(() => chain(state.snapshots));
    UserAsset.find.mockImplementation(async () => state.assets);
    SystemConfig.findOne.mockImplementation(() => chain({ cdi: 14.9, selic: 15, ipca: 4.5, dollar: 5.5 }));
    marketDataService.refreshQuotesBatch.mockResolvedValue();
    marketDataService.getMarketDataMap.mockImplementation(async () => state.quotes);
    InvestmentGoal.distinct.mockResolvedValue([]);
    GoalJourney.deleteMany.mockResolvedValue({});
    GoalContribution.find.mockImplementation(() => chain([]));
    GoalContribution.aggregate.mockResolvedValue([]);
    AssetTransaction.aggregate.mockResolvedValue([]);
});

describe('GET /goals/rate-suggestion', () => {
    it('sugere a taxa pela composição ao vivo e mede o retorno histórico', async () => {
        const { res, next } = await call(ctrl.getRateSuggestion);

        expect(next).not.toHaveBeenCalled();
        expect(typeof res.body.suggested).toBe('number');
        expect(res.body.cdi).toBeCloseTo(14.9, 4);
        expect(res.body.walletReturn).toHaveProperty('enough');
        expect(marketDataService.refreshQuotesBatch).toHaveBeenCalledWith(['PETR4']);
    });

    it('erro na leitura do macro vai para o error handler', async () => {
        state.assets = [];
        SystemConfig.findOne.mockImplementation(() => chain(new Error('macro fora')));

        const { next } = await call(ctrl.getRateSuggestion);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'macro fora' }));
    });
});

describe('GET /goals', () => {
    it('projeta cada meta sobre o patrimônio ao vivo + saldo manual', async () => {
        const goal = goalDoc({ manualBalance: 500 });
        InvestmentGoal.find.mockReturnValue(chain([goal]));

        const { res } = await call(ctrl.listGoals);

        expect(InvestmentGoal.find).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1', status: { $ne: 'ARCHIVED' } });
        expect(res.body.walletEquity).toBe(3500);
        expect(res.body.snapshotDate).toEqual(state.latestSnapshot.date);
        const [g] = res.body.goals;
        expect(g).toMatchObject({
            currentValue: 4000, walletEquity: 3500, remainingAmount: 6000, progressPct: 40, achieved: false,
            onTrack: true, status: 'ACTIVE', startValue: 1000,
        });
        expect(g.monthsRemaining).toBeGreaterThan(0);
        expect(g.projectedDate).toBeInstanceOf(Date);
        expect(typeof g.rateDeltaPp).toBe('number');
        // Meta com startValue próprio não precisa do histórico.
        expect(WalletSnapshot.find).not.toHaveBeenCalled();
        expect(goal.save).not.toHaveBeenCalled();
    });

    it('meta antiga sem startValue usa o 1º snapshot desde o início como baseline', async () => {
        InvestmentGoal.find.mockReturnValue(chain([goalDoc({ startValue: 0, manualBalance: 100 })]));
        state.snapshots = [
            { date: new Date('2026-05-01T02:59:00.000Z'), totalEquity: 500 },
            { date: new Date('2026-06-02T02:59:00.000Z'), totalEquity: 2000 },
        ];

        const { res } = await call(ctrl.listGoals);

        expect(res.body.goals[0].startValue).toBe(2100);
    });

    it('meta batida vira ACHIEVED e grava a data da conquista', async () => {
        const goal = goalDoc({ targetAmount: 3000 });
        InvestmentGoal.find.mockReturnValue(chain([goal]));

        const { res } = await call(ctrl.listGoals);

        expect(res.body.goals[0]).toMatchObject({ status: 'ACHIEVED', achieved: true, progressPct: 100, remainingAmount: 0 });
        expect(goal.achievedAt).toEqual(NOW);
        expect(goal.save).toHaveBeenCalled();
    });

    it('meta conquistada que caiu abaixo da histerese volta para ACTIVE', async () => {
        const goal = goalDoc({ status: 'ACHIEVED', achievedAt: NOW, targetAmount: 50000, lastCelebratedMilestone: 75 });
        InvestmentGoal.find.mockReturnValue(chain([goal]));

        const { res } = await call(ctrl.listGoals);

        expect(res.body.goals[0].status).toBe('ACTIVE');
        expect(goal.achievedAt).toBeUndefined();
        expect(goal.lastCelebratedMilestone).toBe(0);
    });

    it('carteira vazia vale zero, sem cair no snapshot', async () => {
        state.assets = [];
        InvestmentGoal.find.mockReturnValue(chain([goalDoc({ mirrorWallet: true })]));

        const { res } = await call(ctrl.listGoals);

        expect(res.body.walletEquity).toBe(0);
    });

    it('cotações fora do ar: patrimônio cai no último snapshot', async () => {
        marketDataService.getMarketDataMap.mockRejectedValue(new Error('Yahoo fora'));
        InvestmentGoal.find.mockReturnValue(chain([]));

        const { res } = await call(ctrl.listGoals);

        expect(res.body.walletEquity).toBe(3200);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('fallback to snapshot'));
    });

    it('renda fixa e dólar entram no patrimônio pela régua da carteira', async () => {
        state.assets = [
            { ticker: 'AAPL', type: 'STOCK_US', quantity: 10, currency: 'USD' },
            { ticker: 'RESERVA', type: 'CASH', quantity: 1000, totalCost: 1000, startDate: new Date('2026-11-01T00:00:00.000Z') },
        ];
        state.quotes = new Map([['AAPL', { price: 200 }]]);
        InvestmentGoal.find.mockReturnValue(chain([]));

        const { res } = await call(ctrl.listGoals);

        expect(res.body.walletEquity).toBeGreaterThan(11000 + 1000);
        expect(res.body.walletEquity).toBeLessThan(11000 + 1100);
    });

    it('erro vai para o error handler', async () => {
        InvestmentGoal.find.mockImplementation(() => { throw new Error('falhou'); });
        const { next } = await call(ctrl.listGoals);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('GET /goals/:id', () => {
    it('404 quando a meta não é desta carteira', async () => {
        InvestmentGoal.findOne.mockResolvedValue(null);
        const { res } = await call(ctrl.getGoal, { params: { id: 'gX' } });
        expect(InvestmentGoal.findOne).toHaveBeenCalledWith({ _id: 'gX', user: 'u1', wallet: 'w1' });
        expect(res.statusCode).toBe(404);
    });

    it('detalhe com aportes do mês (carteira + manual), histórico mensal, ritmo e trajetória', async () => {
        InvestmentGoal.findOne.mockResolvedValue(goalDoc({ manualBalance: 200 }));
        GoalContribution.find.mockImplementation(() => chain([
            { amount: 200, date: new Date('2026-11-10T12:00:00.000Z') },
        ]));
        AssetTransaction.aggregate
            .mockResolvedValueOnce([{ _id: null, inflow: 1000 }])
            .mockResolvedValueOnce([{ _id: { y: 2026, m: 11 }, inflow: 1000 }, { _id: { y: 2026, m: 10 }, inflow: 500 }]);
        GoalContribution.aggregate.mockResolvedValue([{ _id: { y: 2026, m: 11 }, total: 200 }]);
        state.snapshots = [{ date: new Date('2026-10-31T02:59:00.000Z'), totalEquity: 2500, quotaPrice: 101 }];

        const { res, next } = await call(ctrl.getGoal, { params: { id: 'g1' } });

        expect(next).not.toHaveBeenCalled();
        expect(res.body.goal).toMatchObject({ currentValue: 3700, status: 'ACTIVE' });
        expect(res.body.currentMonth).toMatchObject({ contributions: 1200, manual: 200, wallet: 1000 });
        expect(res.body.monthlyHistory).toHaveLength(12);
        expect(res.body.monthlyHistory.at(-1)).toEqual({ month: '2026-11', amount: 1200 });
        expect(res.body.monthlyHistory.at(-2)).toEqual({ month: '2026-10', amount: 500 });
        expect(res.body.streak).toBe(2);
        expect(res.body.avgContribution3m).toBeCloseTo(1700 / 3, 2);
        expect(Array.isArray(res.body.trajectory)).toBe(true);
        expect(res.body.trajectory.length).toBeGreaterThan(1);
        expect(res.body.contributions).toHaveLength(1);
        expect(res.body.walletEquity).toBe(3500);
    });

    it('meta só manual não consulta lançamentos da carteira', async () => {
        InvestmentGoal.findOne.mockResolvedValue(goalDoc({ mirrorWallet: false, manualBalance: 800 }));

        const { res } = await call(ctrl.getGoal, { params: { id: 'g1' } });

        expect(AssetTransaction.aggregate).not.toHaveBeenCalled();
        expect(res.body.goal).toMatchObject({ currentValue: 800, walletEquity: 0 });
        expect(res.body.currentMonth.wallet).toBe(0);
    });

    it('erro vai para o error handler', async () => {
        InvestmentGoal.findOne.mockRejectedValue(new Error('falhou'));
        const { next } = await call(ctrl.getGoal, { params: { id: 'g1' } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('POST /goals', () => {
    it('cria a meta com baseline = patrimônio + saldo manual e herda a jornada do marco anterior', async () => {
        InvestmentGoal.countDocuments.mockResolvedValue(1);
        InvestmentGoal.findOne.mockResolvedValue({ _id: 'g0', journey: 'j1' });
        InvestmentGoal.create.mockImplementation(async (doc) => goalDoc({ ...doc, _id: 'g2' }));

        const { res } = await call(ctrl.createGoal, {
            body: { name: 'Casa', targetAmount: 200000, monthlyTarget: 2000, manualBalance: 500, previousGoalId: 'g0' },
        });

        expect(res.statusCode).toBe(201);
        const created = InvestmentGoal.create.mock.calls[0][0];
        expect(created).toMatchObject({
            user: 'u1', wallet: 'w1', name: 'Casa', targetAmount: 200000, monthlyTarget: 2000,
            expectedAnnualRate: 10, mirrorWallet: true, manualBalance: 500, startValue: 4000,
            previousGoalId: 'g0', journey: 'j1',
        });
        expect(res.body.goal).toMatchObject({ _id: 'g2', currentValue: 4000 });
    });

    it('meta sem espelhar a carteira usa só o saldo manual', async () => {
        InvestmentGoal.countDocuments.mockResolvedValue(0);
        InvestmentGoal.create.mockImplementation(async (doc) => goalDoc(doc));

        const { res } = await call(ctrl.createGoal, {
            body: { name: 'Viagem', targetAmount: 10000, mirrorWallet: false, expectedAnnualRate: 0, targetDate: '2027-11-24' },
        });

        expect(InvestmentGoal.create.mock.calls[0][0]).toMatchObject({ startValue: 0, journey: null, expectedAnnualRate: 0 });
        expect(res.body.goal).toMatchObject({ currentValue: 0, walletEquity: 0 });
        // Com prazo e aporte zero não há como chegar: fora do caminho.
        expect(res.body.goal.onTrack).toBe(false);
        expect(res.body.goal.requiredMonthlyForDeadline).toBeGreaterThan(0);
    });

    it('erro vai para o error handler', async () => {
        InvestmentGoal.countDocuments.mockRejectedValue(new Error('falhou'));
        const { next } = await call(ctrl.createGoal, { body: {} });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('PUT /goals/:id', () => {
    it('404 quando a meta não existe', async () => {
        InvestmentGoal.findOne.mockResolvedValue(null);
        const { res } = await call(ctrl.updateGoal, { params: { id: 'gX' } });
        expect(res.statusCode).toBe(404);
    });

    it('atualiza campos saneados e, ao religar a cadeia, troca a jornada e apaga a órfã', async () => {
        const goal = goalDoc({ journey: 'jOld' });
        InvestmentGoal.findOne
            .mockResolvedValueOnce(goal)
            .mockResolvedValueOnce({ _id: 'g9', journey: 'jNew' });

        const { res } = await call(ctrl.updateGoal, {
            params: { id: 'g1' },
            body: {
                name: 'Novo nome', targetAmount: '12000.456', monthlyTarget: 700, expectedAnnualRate: '9.5',
                targetDate: '', startValue: 900, previousGoalId: 'g9',
            },
        });

        expect(goal).toMatchObject({
            name: 'Novo nome', targetAmount: 12000.46, monthlyTarget: 700, expectedAnnualRate: 9.5, startValue: 900,
            previousGoalId: 'g9', journey: 'jNew', targetDate: undefined,
        });
        expect(goal.save).toHaveBeenCalled();
        expect(GoalJourney.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['jOld'] }, user: 'u1', wallet: 'w1' });
        expect(res.body.goal).toMatchObject({ name: 'Novo nome', currentValue: 3500 });
    });

    it('desligar da cadeia zera a jornada; a antiga ainda usada é mantida', async () => {
        const goal = goalDoc({ journey: 'jOld', previousGoalId: 'g0' });
        InvestmentGoal.findOne.mockResolvedValueOnce(goal);
        InvestmentGoal.distinct.mockResolvedValue(['jOld']);

        await call(ctrl.updateGoal, { params: { id: 'g1' }, body: { previousGoalId: null } });

        expect(goal.journey).toBeNull();
        expect(GoalJourney.deleteMany).not.toHaveBeenCalled();
    });

    it('erro vai para o error handler', async () => {
        InvestmentGoal.findOne.mockRejectedValue(new Error('falhou'));
        const { next } = await call(ctrl.updateGoal, { params: { id: 'g1' } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('DELETE /goals/:id e DELETE /goals', () => {
    it('remove a meta, seus aportes e a jornada que ficou vazia', async () => {
        InvestmentGoal.findOneAndDelete.mockResolvedValue({ _id: 'g1', journey: 'j1' });

        const { res } = await call(ctrl.deleteGoal, { params: { id: 'g1' } });

        expect(GoalContribution.deleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1', goal: 'g1' });
        expect(GoalJourney.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['j1'] }, user: 'u1', wallet: 'w1' });
        expect(res.body).toEqual({ message: 'Meta removida.' });
    });

    it('meta sem jornada não toca em jornadas; inexistente → 404', async () => {
        InvestmentGoal.findOneAndDelete.mockResolvedValueOnce({ _id: 'g1', journey: null });
        await call(ctrl.deleteGoal, { params: { id: 'g1' } });
        expect(InvestmentGoal.distinct).not.toHaveBeenCalled();

        InvestmentGoal.findOneAndDelete.mockResolvedValueOnce(null);
        const { res } = await call(ctrl.deleteGoal, { params: { id: 'gX' } });
        expect(res.statusCode).toBe(404);

        InvestmentGoal.findOneAndDelete.mockRejectedValueOnce(new Error('falhou'));
        const erro = await call(ctrl.deleteGoal, { params: { id: 'g1' } });
        expect(erro.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('limpar tudo apaga metas, aportes e jornadas desta carteira', async () => {
        InvestmentGoal.deleteMany.mockResolvedValue({ deletedCount: 4 });

        const { res } = await call(ctrl.clearAllGoals);

        const scope = { user: 'u1', wallet: 'w1' };
        expect(InvestmentGoal.deleteMany).toHaveBeenCalledWith(scope);
        expect(GoalContribution.deleteMany).toHaveBeenCalledWith(scope);
        expect(GoalJourney.deleteMany).toHaveBeenCalledWith(scope);
        expect(res.body).toEqual({ message: 'Todas as metas removidas.', deletedCount: 4 });

        InvestmentGoal.deleteMany.mockResolvedValueOnce({});
        expect((await call(ctrl.clearAllGoals)).res.body.deletedCount).toBe(0);

        InvestmentGoal.deleteMany.mockRejectedValueOnce(new Error('falhou'));
        expect((await call(ctrl.clearAllGoals)).next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('PUT /goals/:id/journey', () => {
    const linked = () => [
        goalDoc({ _id: 'g1', journey: 'jA' }),
        goalDoc({ _id: 'g2', previousGoalId: 'g1', journey: 'jB' }),
    ];

    it('404 sem meta; 400 para meta solta', async () => {
        InvestmentGoal.findOne.mockResolvedValueOnce(null);
        expect((await call(ctrl.renameJourney, { params: { id: 'gX' }, body: { name: 'J' } })).res.statusCode).toBe(404);

        const solo = goalDoc();
        InvestmentGoal.findOne.mockResolvedValueOnce(solo);
        InvestmentGoal.find.mockResolvedValueOnce([solo]);
        const { res } = await call(ctrl.renameJourney, { params: { id: 'g1' }, body: { name: 'J' } });
        expect(res.statusCode).toBe(400);
    });

    it('renomeia a jornada existente, aplica a toda a cadeia e apaga a perdedora', async () => {
        const all = linked();
        InvestmentGoal.findOne.mockResolvedValue(all[1]);
        InvestmentGoal.find.mockResolvedValue(all);
        GoalJourney.findOneAndUpdate.mockResolvedValue({ _id: 'jA', name: 'Independência' });

        const { res } = await call(ctrl.renameJourney, { params: { id: 'g2' }, body: { name: 'Independência' } });

        expect(GoalJourney.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'jA', user: 'u1', wallet: 'w1' }, { name: 'Independência', updatedAt: NOW.getTime() }, { new: true },
        );
        expect(InvestmentGoal.updateMany).toHaveBeenCalledWith(
            { _id: { $in: ['g1', 'g2'] }, user: 'u1', wallet: 'w1' }, { journey: 'jA', updatedAt: NOW.getTime() },
        );
        expect(GoalJourney.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['jB'] }, user: 'u1', wallet: 'w1' });
        expect(res.body).toEqual({ journey: { _id: 'jA', name: 'Independência' } });
    });

    it('cadeia legada sem jornada ganha uma nova', async () => {
        const all = [goalDoc({ _id: 'g1' }), goalDoc({ _id: 'g2', previousGoalId: 'g1' })];
        InvestmentGoal.findOne.mockResolvedValue(all[0]);
        InvestmentGoal.find.mockResolvedValue(all);
        GoalJourney.create.mockResolvedValue({ _id: 'jN', name: 'Nova' });

        const { res } = await call(ctrl.renameJourney, { params: { id: 'g1' }, body: { name: 'Nova' } });

        expect(GoalJourney.findOneAndUpdate).not.toHaveBeenCalled();
        expect(GoalJourney.create).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1', name: 'Nova' });
        expect(res.body.journey).toEqual({ _id: 'jN', name: 'Nova' });
    });

    it('erro vai para o error handler', async () => {
        InvestmentGoal.findOne.mockRejectedValue(new Error('falhou'));
        const { next } = await call(ctrl.renameJourney, { params: { id: 'g1' }, body: { name: 'J' } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('aportes manuais', () => {
    it('registrar aporte soma ao saldo, grava e diz quantos meses adiantou', async () => {
        const goal = goalDoc({ manualBalance: 100 });
        InvestmentGoal.findOne.mockResolvedValue(goal);

        const { res } = await call(ctrl.addContribution, { params: { id: 'g1' }, body: { amount: 2000.004, note: 'bônus' } });

        expect(res.statusCode).toBe(201);
        expect(GoalContribution.create).toHaveBeenCalledWith({
            user: 'u1', wallet: 'w1', goal: 'g1', amount: 2000, date: NOW.getTime(), note: 'bônus',
        });
        expect(goal.manualBalance).toBe(2100);
        expect(goal.save).toHaveBeenCalled();
        expect(res.body.goal.currentValue).toBe(5600);
        expect(res.body.monthsAccelerated).toBeGreaterThan(0);
    });

    it('aporte em meta inexistente → 404; erro → error handler', async () => {
        InvestmentGoal.findOne.mockResolvedValueOnce(null);
        expect((await call(ctrl.addContribution, { params: { id: 'gX' }, body: { amount: 1 } })).res.statusCode).toBe(404);

        InvestmentGoal.findOne.mockRejectedValueOnce(new Error('falhou'));
        const erro = await call(ctrl.addContribution, { params: { id: 'g1' }, body: { amount: 1 } });
        expect(erro.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('remover aporte desconta do saldo e devolve a meta recalculada', async () => {
        const goal = goalDoc({ manualBalance: 1500 });
        InvestmentGoal.findOne.mockResolvedValue(goal);
        GoalContribution.findOneAndDelete.mockResolvedValue({ amount: 500 });

        const { res } = await call(ctrl.deleteContribution, { params: { id: 'g1', cid: 'c1' } });

        expect(GoalContribution.findOneAndDelete).toHaveBeenCalledWith({ _id: 'c1', user: 'u1', wallet: 'w1', goal: 'g1' });
        expect(goal.manualBalance).toBe(1000);
        expect(res.body.goal.currentValue).toBe(4500);
    });

    it('remover aporte: 404 para meta ou aporte inexistente; erro → error handler', async () => {
        InvestmentGoal.findOne.mockResolvedValueOnce(null);
        expect((await call(ctrl.deleteContribution, { params: { id: 'gX', cid: 'c1' } })).res.statusCode).toBe(404);

        InvestmentGoal.findOne.mockResolvedValueOnce(goalDoc());
        GoalContribution.findOneAndDelete.mockResolvedValueOnce(null);
        const semAporte = await call(ctrl.deleteContribution, { params: { id: 'g1', cid: 'cX' } });
        expect(semAporte.res.statusCode).toBe(404);
        expect(semAporte.res.body).toEqual({ message: 'Aporte não encontrado.' });

        InvestmentGoal.findOne.mockRejectedValueOnce(new Error('falhou'));
        const erro = await call(ctrl.deleteContribution, { params: { id: 'g1', cid: 'c1' } });
        expect(erro.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});
