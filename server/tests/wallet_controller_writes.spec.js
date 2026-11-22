/**
 * Rede de segurança do walletController — ESCRITAS na carteira.
 *
 * Trava o comportamento observável (status + JSON + o que é gravado) de
 * addAssetTransaction, updateAsset, removeAsset, deleteTransaction (rebuild)
 * e resetWallet, antes da divisão do controller em módulos.
 *
 * Sem banco: models, serviços e mongoose são mockados (o `.env` local aponta
 * para produção). `runTransaction` roda de verdade sobre a sessão falsa, para
 * o teste enxergar commit × abort.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { chain, call, NOW, positionDoc } from './helpers/walletControllerHarness.js';

// Içados: as fábricas dos mocks abaixo dependem da sessão e da lista de lançamentos.
const h = vi.hoisted(() => {
    const session = {
        startTransaction: vi.fn(),
        commitTransaction: vi.fn(async () => {}),
        abortTransaction: vi.fn(async () => {}),
        endSession: vi.fn(async () => {}),
    };
    return { session, createdTx: [] };
});

vi.mock('mongoose', () => ({
    default: {
        startSession: vi.fn(async () => h.session),
        connect: vi.fn(() => { throw new Error('conexão real proibida em teste'); }),
    },
}));
vi.mock('../services/holidayService.js', () => ({
    holidayService: { sync: vi.fn(async () => true), isHoliday: (d) => ['2026-11-20', '2026-12-25'].includes(d) },
}));
vi.mock('../services/errorLogService.js', () => ({ recordError: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({
    default: { findById: vi.fn(), findOneAndUpdate: vi.fn(), countDocuments: vi.fn() },
}));
vi.mock('../models/UserAsset.js', () => ({
    default: { find: vi.fn(), findOne: vi.fn(), deleteOne: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('../models/AssetTransaction.js', () => {
    class AssetTransaction {
        constructor(doc) {
            Object.assign(this, doc);
            this.save = vi.fn(async () => this);
            h.createdTx.push(this);
        }
    }
    AssetTransaction.find = vi.fn();
    AssetTransaction.countDocuments = vi.fn();
    AssetTransaction.deleteMany = vi.fn();
    AssetTransaction.distinct = vi.fn();
    AssetTransaction.findOneAndDelete = vi.fn();
    return { default: AssetTransaction };
});
vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/TreasuryBond.js', () => ({ default: { find: vi.fn(), findOne: vi.fn() } }));
vi.mock('../services/treasuryPriceService.js', () => {
    const empty = { catalog: [], series: new Map(), historyFor: () => null, resolve: () => ({ key: null, reason: 'NOT_TREASURY' }) };
    return { loadTreasuryPricing: vi.fn(async () => empty), EMPTY_TREASURY_PRICING: empty };
});
vi.mock('../models/WalletSnapshot.js', () => ({
    default: { find: vi.fn(), findOne: vi.fn(), countDocuments: vi.fn(), deleteMany: vi.fn(), distinct: vi.fn() },
}));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: { find: vi.fn(() => ({ lean: async () => [] })) } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/financialService.js', () => ({
    financialService: { recalculatePosition: vi.fn(), rebuildUserHistory: vi.fn(), syncDividends: vi.fn() },
}));
vi.mock('../services/schedulerService.js', () => ({ runDailySnapshot: vi.fn() }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const UserAsset = (await import('../models/UserAsset.js')).default;
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const TreasuryBond = (await import('../models/TreasuryBond.js')).default;
const WalletSnapshot = (await import('../models/WalletSnapshot.js')).default;
const { financialService } = await import('../services/financialService.js');
const logger = (await import('../config/logger.js')).default;
const ctrl = await import('../controllers/walletController.js');

const { session, createdTx } = h;

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
    vi.clearAllMocks();
    createdTx.length = 0;
    financialService.rebuildUserHistory.mockResolvedValue();
    financialService.syncDividends.mockResolvedValue();
    financialService.recalculatePosition.mockImplementation(async (_u, ticker, type) => positionDoc({
        ticker, type: type || 'STOCK', currency: 'BRL',
    }));
});

describe('POST /wallet/add — validação', () => {
    it.each([
        ['sem ticker', { quantity: 10, price: 30 }, 'Dados incompletos.'],
        ['sem preço', { ticker: 'PETR4', quantity: 10 }, 'Dados incompletos.'],
        ['data ilegível', { ticker: 'PETR4', quantity: 10, price: 30, date: 'ontem' }, 'Data inválida.'],
        ['data futura em Brasília', { ticker: 'PETR4', quantity: 10, price: 30, date: '2026-11-25' }, 'Data futura não permitida.'],
    ])('%s → 400 sem gravar nada', async (_label, body, message) => {
        const { res, next } = await call(ctrl.addAssetTransaction, { body });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400, message }));
        expect(res.json).not.toHaveBeenCalled();
        expect(createdTx).toHaveLength(0);
    });
});

describe('POST /wallet/add — lançamentos', () => {
    it('compra de hoje: grava BUY normalizado, commita, sincroniza proventos e não reconstrói histórico', async () => {
        const { res, next } = await call(ctrl.addAssetTransaction, {
            body: { ticker: 'petr4', type: 'STOCK', quantity: 10, price: 30.5, date: '2026-11-24', name: 'Petrobras' },
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(201);
        expect(res.body.message).toBe('Transação registrada.');
        expect(res.body.asset).toMatchObject({ ticker: 'PETR4' });
        expect(createdTx).toHaveLength(1);
        expect(createdTx[0]).toMatchObject({
            user: 'u1', wallet: 'w1', ticker: 'PETR4', type: 'BUY', quantity: 10, price: 30.5, totalValue: 305,
            notes: 'Nome: Petrobras',
        });
        // Dia civil ancorado ao meio-dia UTC: não escorrega para o dia anterior.
        expect(createdTx[0].date.toISOString().slice(0, 10)).toBe('2026-11-24');
        expect(createdTx[0].save).toHaveBeenCalledWith({ session });
        expect(financialService.recalculatePosition).toHaveBeenCalledWith('u1', 'PETR4', 'STOCK', session, undefined, 'w1');
        expect(session.commitTransaction).toHaveBeenCalledTimes(1);
        expect(financialService.rebuildUserHistory).not.toHaveBeenCalled();
        expect(financialService.syncDividends).toHaveBeenCalledWith([{ ticker: 'PETR4', type: 'STOCK' }]);
    });

    it('sem data vale o dia de hoje em Brasília', async () => {
        await call(ctrl.addAssetTransaction, { body: { ticker: 'PETR4', type: 'STOCK', quantity: 1, price: 30 } });
        expect(createdTx[0].date.toISOString().slice(0, 10)).toBe('2026-11-24');
    });

    it('compra retroativa reconstrói o histórico; falha no rebuild é logada e não derruba a resposta', async () => {
        financialService.rebuildUserHistory.mockRejectedValue(new Error('rebuild caiu'));

        const { res } = await call(ctrl.addAssetTransaction, {
            body: { ticker: 'PETR4', type: 'STOCK', quantity: 10, price: 30, date: '2026-11-10' },
        });

        expect(financialService.rebuildUserHistory).toHaveBeenCalledWith('u1', 'w1');
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Rebuild de histórico falhou'));
        expect(res.statusCode).toBe(201);
    });

    it('quantidade negativa é venda: grava SELL com valores absolutos e não sincroniza proventos', async () => {
        await call(ctrl.addAssetTransaction, {
            body: { ticker: 'PETR4', type: 'STOCK', quantity: -5, price: -32, date: '2026-11-24' },
        });

        expect(createdTx[0]).toMatchObject({ type: 'SELL', quantity: 5, price: 32, totalValue: 160, notes: '' });
        expect(financialService.syncDividends).not.toHaveBeenCalled();
    });

    it('ativo em dólar: carimba USD no lançamento e respeita o sub-tipo escolhido', async () => {
        const position = positionDoc({ ticker: 'VOO', type: 'STOCK_US', currency: 'USD' });
        financialService.recalculatePosition.mockResolvedValue(position);

        await call(ctrl.addAssetTransaction, {
            body: { ticker: 'VOO', type: 'STOCK_US', quantity: 2, price: 500, date: '2026-11-24', currency: 'USD', usSubType: 'ETF' },
        });

        expect(createdTx[0].currency).toBe('USD');
        expect(createdTx[0].save).toHaveBeenCalledTimes(2);
        expect(position).toMatchObject({ usSubType: 'ETF', usSubTypeManual: true });
        expect(position.save).toHaveBeenCalledWith({ session });
    });

    it('preço unitário sub-centavo de cripto não zera', async () => {
        await call(ctrl.addAssetTransaction, {
            body: { ticker: 'SHIB', type: 'CRYPTO', quantity: 1000000, price: 0.00001234, date: '2026-11-24' },
        });

        expect(createdTx[0].price).toBeCloseTo(0.00001234, 10);
        expect(createdTx[0].totalValue).toBeCloseTo(12.34, 2);
        expect(financialService.syncDividends).not.toHaveBeenCalled();
    });

    it('título do Tesouro sem índice no formulário: completa índice, spread e vencimento pelo catálogo', async () => {
        const position = positionDoc({ ticker: 'TESOURO IPCA+ 2035', type: 'FIXED_INCOME', currency: 'BRL' });
        financialService.recalculatePosition.mockResolvedValue(position);
        const bondQuery = chain({ title: 'Tesouro IPCA+ 2035', index: 'IPCA', rate: 7.1, maturityDate: '15/05/2035' });
        TreasuryBond.findOne.mockReturnValue(bondQuery);

        const { res } = await call(ctrl.addAssetTransaction, {
            body: {
                ticker: 'Tesouro IPCA+ 2035', type: 'FIXED_INCOME', quantity: 1, price: 2000, date: '2026-11-03',
                fixedIncomeRate: 7.1, name: 'Tesouro IPCA+ 2035', isReserve: false,
            },
        });

        expect(res.statusCode).toBe(201);
        // O "+" do nome é literal no regex, não quantificador.
        expect(TreasuryBond.findOne.mock.calls[0][0].title.test('tesouro ipca+ 2035')).toBe(true);
        expect(bondQuery.session).toHaveBeenCalledWith(session);
        expect(position).toMatchObject({
            fixedIncomeRate: 7.1, fixedIncomeIndex: 'IPCA', fixedIncomeSpread: 7.1,
            name: 'Tesouro IPCA+ 2035', isReserve: false,
        });
        expect(position.maturityDate).toEqual(new Date('2035-05-15T00:00:00.000Z'));
        expect(position.startDate.toISOString().slice(0, 10)).toBe('2026-11-03');
        expect(position.save).toHaveBeenCalledWith({ session });
        expect(financialService.syncDividends).not.toHaveBeenCalled();
    });

    it('renda fixa com índice e vencimento informados não consulta o catálogo', async () => {
        const position = positionDoc({ ticker: 'CDB BANCO X', type: 'FIXED_INCOME', currency: 'BRL' });
        financialService.recalculatePosition.mockResolvedValue(position);

        await call(ctrl.addAssetTransaction, {
            body: {
                ticker: 'CDB BANCO X', type: 'FIXED_INCOME', quantity: 1, price: 5000, date: '2026-11-24',
                fixedIncomeIndex: 'CDI', fixedIncomeSpread: 0, maturityDate: '2028-01-10',
            },
        });

        expect(TreasuryBond.findOne).not.toHaveBeenCalled();
        expect(position).toMatchObject({ fixedIncomeIndex: 'CDI', fixedIncomeSpread: 0 });
        expect(position.maturityDate).toEqual(new Date('2028-01-10'));
        // Sem flag explícito, o aporte não reclassifica a posição.
        expect(position.isReserve).toBeUndefined();
    });

    it('caixa é sempre reserva', async () => {
        const position = positionDoc({ ticker: 'RESERVA', type: 'CASH', currency: 'BRL' });
        financialService.recalculatePosition.mockResolvedValue(position);

        await call(ctrl.addAssetTransaction, {
            body: { ticker: 'RESERVA', type: 'CASH', quantity: 1000, price: 1, date: '2026-11-24' },
        });

        expect(position.isReserve).toBe(true);
        expect(position.save).toHaveBeenCalled();
    });

    it('recálculo que falha aborta a transação e vai para o error handler', async () => {
        financialService.recalculatePosition.mockRejectedValue(new Error('Saldo insuficiente para PETR4.'));

        const { res, next } = await call(ctrl.addAssetTransaction, {
            body: { ticker: 'PETR4', type: 'STOCK', quantity: -500, price: 30, date: '2026-11-24' },
        });

        expect(session.abortTransaction).toHaveBeenCalledTimes(1);
        expect(session.commitTransaction).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Saldo insuficiente para PETR4.' }));
        expect(res.json).not.toHaveBeenCalled();
    });
});

describe('PUT /wallet/:id', () => {
    it('404 quando o ativo não é desta carteira', async () => {
        UserAsset.findOne.mockResolvedValue(null);

        const { res } = await call(ctrl.updateAsset, { params: { id: 'x' }, body: { tags: ['a'] } });

        expect(UserAsset.findOne).toHaveBeenCalledWith({ _id: 'x', user: 'u1', wallet: 'w1' });
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ message: 'Ativo não encontrado' });
    });

    it('atualiza tags e nome; sub-tipo só vale para exterior', async () => {
        const asset = positionDoc({ ticker: 'PETR4', type: 'STOCK' });
        UserAsset.findOne.mockResolvedValue(asset);

        const { res } = await call(ctrl.updateAsset, {
            params: { id: 'a1' }, body: { tags: ['dividendos'], name: '  Petrobras  ', usSubType: 'ETF' },
        });

        expect(res.body.message).toBe('Ativo atualizado.');
        expect(asset).toMatchObject({ tags: ['dividendos'], name: 'Petrobras' });
        expect(asset.usSubType).toBeUndefined();
        expect(asset.save).toHaveBeenCalled();
        expect(financialService.rebuildUserHistory).not.toHaveBeenCalled();
    });

    it('override de sub-tipo em exterior marca como manual', async () => {
        const asset = positionDoc({ ticker: 'O', type: 'STOCK_US' });
        UserAsset.findOne.mockResolvedValue(asset);

        await call(ctrl.updateAsset, { params: { id: 'a1' }, body: { usSubType: 'REIT' } });

        expect(asset).toMatchObject({ usSubType: 'REIT', usSubTypeManual: true });
    });

    it('caixa reclassificado em renda fixa vira investimento e reconstrói o histórico', async () => {
        const asset = positionDoc({ ticker: 'RESERVA', type: 'CASH', isReserve: true });
        UserAsset.findOne.mockResolvedValue(asset);

        const { res } = await call(ctrl.updateAsset, {
            params: { id: 'a1' },
            body: { type: 'FIXED_INCOME', fixedIncomeRate: 110, fixedIncomeIndex: 'CDI', fixedIncomeSpread: '0.5', maturityDate: '2029-01-01' },
        });

        expect(res.body.message).toBe('Ativo convertido em Renda Fixa.');
        expect(asset).toMatchObject({
            type: 'FIXED_INCOME', fixedIncomeRate: 110, fixedIncomeIndex: 'CDI', fixedIncomeSpread: 0.5, isReserve: false,
        });
        expect(asset.maturityDate).toEqual(new Date('2029-01-01'));
        expect(financialService.rebuildUserHistory).toHaveBeenCalledWith('u1', 'w1');
    });

    it('reclassificação prefixada mantendo na reserva; rebuild que falha só loga', async () => {
        const asset = positionDoc({ ticker: 'RESERVA', type: 'CASH' });
        UserAsset.findOne.mockResolvedValue(asset);
        financialService.rebuildUserHistory.mockRejectedValue(new Error('rebuild caiu'));

        const { res } = await call(ctrl.updateAsset, {
            params: { id: 'a1' }, body: { type: 'FIXED_INCOME', fixedIncomeIndex: 'PRE', isReserve: true },
        });

        expect(asset).toMatchObject({ fixedIncomeIndex: 'PRE', isReserve: true });
        expect(asset.fixedIncomeSpread).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Rebuild pós-reclassificação falhou'));
        expect(res.body.message).toBe('Ativo convertido em Renda Fixa.');
    });

    it('alterna a reserva separada de renda fixa sem mudar a classe', async () => {
        const asset = positionDoc({ ticker: 'CDB', type: 'FIXED_INCOME', isReserve: false });
        UserAsset.findOne.mockResolvedValue(asset);

        await call(ctrl.updateAsset, { params: { id: 'a1' }, body: { isReserve: 1 } });

        expect(asset).toMatchObject({ type: 'FIXED_INCOME', isReserve: true });
    });

    it('erro de persistência vai para o error handler', async () => {
        UserAsset.findOne.mockRejectedValue(new Error('Mongo fora'));
        const { next } = await call(ctrl.updateAsset, { params: { id: 'a1' } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Mongo fora' }));
    });
});

describe('DELETE /wallet/:id', () => {
    it('remove o ativo e todos os lançamentos dele na mesma transação e reconstrói o histórico', async () => {
        UserAsset.findOne.mockResolvedValue({ _id: 'a1', ticker: 'PETR4' });
        const txDelete = chain({ deletedCount: 3 });
        const assetDelete = chain({ deletedCount: 1 });
        AssetTransaction.deleteMany.mockReturnValue(txDelete);
        UserAsset.deleteOne.mockReturnValue(assetDelete);

        const { res } = await call(ctrl.removeAsset, { params: { id: 'a1' } });

        expect(AssetTransaction.deleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1', ticker: 'PETR4' });
        expect(txDelete.session).toHaveBeenCalledWith(session);
        expect(UserAsset.deleteOne).toHaveBeenCalledWith({ _id: 'a1' });
        expect(session.commitTransaction).toHaveBeenCalledTimes(1);
        expect(financialService.rebuildUserHistory).toHaveBeenCalledWith('u1', 'w1');
        expect(res.body).toEqual({ message: 'Ativo removido.' });
    });

    it('ativo inexistente → 404 com abort', async () => {
        UserAsset.findOne.mockResolvedValue(null);

        const { res } = await call(ctrl.removeAsset, { params: { id: 'nope' } });

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ message: 'Ativo não encontrado' });
        expect(session.abortTransaction).toHaveBeenCalledTimes(1);
        expect(financialService.rebuildUserHistory).not.toHaveBeenCalled();
    });

    it('falha no meio aborta e vai para o error handler', async () => {
        UserAsset.findOne.mockResolvedValue({ _id: 'a1', ticker: 'PETR4' });
        AssetTransaction.deleteMany.mockReturnValue(chain(new Error('write conflict')));

        const { res, next } = await call(ctrl.removeAsset, { params: { id: 'a1' } });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'write conflict' }));
        expect(res.json).not.toHaveBeenCalled();
    });

    it('rebuild pós-commit que falha só loga', async () => {
        UserAsset.findOne.mockResolvedValue({ _id: 'a1', ticker: 'PETR4' });
        AssetTransaction.deleteMany.mockReturnValue(chain({}));
        UserAsset.deleteOne.mockReturnValue(chain({}));
        financialService.rebuildUserHistory.mockRejectedValue(new Error('rebuild caiu'));

        const { res } = await call(ctrl.removeAsset, { params: { id: 'a1' } });

        expect(res.body).toEqual({ message: 'Ativo removido.' });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('após remover ativo'));
    });
});

describe('DELETE /wallet/transactions/:id — rebuild pós-commit', () => {
    it('falha no rebuild só loga e a resposta segue', async () => {
        AssetTransaction.findOneAndDelete.mockResolvedValue({ ticker: 'PETR4' });
        financialService.recalculatePosition.mockResolvedValue({});
        financialService.rebuildUserHistory.mockRejectedValue(new Error('rebuild caiu'));

        const { res } = await call(ctrl.deleteTransaction, { params: { id: 't1' } });

        expect(res.body).toEqual({ message: 'Transação removida.' });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('após remover transação'));
    });
});

describe('POST /wallet/reset', () => {
    it('apaga posições, lançamentos e snapshots SÓ desta carteira', async () => {
        UserAsset.deleteMany.mockReturnValue(chain({}));
        AssetTransaction.deleteMany.mockReturnValue(chain({}));
        WalletSnapshot.deleteMany.mockReturnValue(chain({}));

        const { res } = await call(ctrl.resetWallet);

        const scope = { user: 'u1', wallet: 'w1' };
        expect(UserAsset.deleteMany).toHaveBeenCalledWith(scope);
        expect(AssetTransaction.deleteMany).toHaveBeenCalledWith(scope);
        expect(WalletSnapshot.deleteMany).toHaveBeenCalledWith(scope);
        expect(session.commitTransaction).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual({ message: 'Carteira resetada.' });
    });

    it('falha reverte e vai para o error handler', async () => {
        UserAsset.deleteMany.mockReturnValue(chain(new Error('falhou')));

        const { res, next } = await call(ctrl.resetWallet);

        expect(session.abortTransaction).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
        expect(res.json).not.toHaveBeenCalled();
    });
});

