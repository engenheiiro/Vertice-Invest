/**
 * Rede de segurança do walletController — metas, busca, extrato e admin.
 *
 * Trava status + JSON de updateWalletTargets, searchAssets,
 * getAssetTransactions, getCashFlow e das rotas administrativas de snapshot,
 * antes da divisão do controller em módulos.
 *
 * Sem banco: models, serviços e mongoose são mockados (o `.env` local aponta
 * para produção).
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

const Wallet = (await import('../models/Wallet.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const TreasuryBond = (await import('../models/TreasuryBond.js')).default;
const WalletSnapshot = (await import('../models/WalletSnapshot.js')).default;
const { financialService } = await import('../services/financialService.js');
const { runDailySnapshot } = await import('../services/schedulerService.js');
const ctrl = await import('../controllers/walletController.js');

const { createdTx } = h;

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

describe('PUT /wallet/targets', () => {
    it('saneia a alocação, a reserva e as sub-metas e devolve o que foi salvo', async () => {
        Wallet.findOneAndUpdate.mockImplementation((_filter, update) => chain(update.$set));

        const { res } = await call(ctrl.updateWalletTargets, {
            body: {
                targetAllocation: { STOCK: '50', FII: 30.123456, CRYPTO: null },
                targetReserve: -500,
                targetMonthlyDividendIncome: '1200',
                targetSubAllocation: { STOCK: { STOCK: 80, ETF: 20 }, STOCK_US: { REIT: 10 } },
            },
        });

        expect(Wallet.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'w1', user: 'u1' }, expect.any(Object), { new: true });
        expect(res.body).toEqual({
            message: 'Carteira ideal atualizada.',
            targetAllocation: { STOCK: 50, FII: 30.1235, STOCK_US: 0, ETF: 0, CRYPTO: 0, FIXED_INCOME: 0 },
            targetReserve: 0,
            targetMonthlyDividendIncome: 1200,
            targetSubAllocation: {
                STOCK: { STOCK: 80, ETF: 20 },
                FIXED_INCOME: { IPCA: 0, POS: 0, PRE: 0 },
                STOCK_US: { STOCK: 0, REIT: 10, ETF: 0, DOLLAR: 0 },
            },
        });
    });

    it('só grava os campos enviados', async () => {
        Wallet.findOneAndUpdate.mockImplementation(() => chain({ targetReserve: 5000 }));

        const { res } = await call(ctrl.updateWalletTargets, { body: { targetReserve: 5000 } });

        expect(Wallet.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { targetReserve: 5000 } });
        expect(res.body.targetReserve).toBe(5000);
        expect(res.body.targetAllocation).toBeUndefined();
    });

    it('erro vai para o error handler', async () => {
        Wallet.findOneAndUpdate.mockImplementation(() => { throw new Error('falhou'); });
        const { next } = await call(ctrl.updateWalletTargets, { body: {} });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('GET /wallet/search', () => {
    it('termo curto devolve lista vazia sem consultar', async () => {
        const { res } = await call(ctrl.searchAssets, { query: { q: 'P' } });
        expect(res.body).toEqual([]);
        expect(MarketAsset.find).not.toHaveBeenCalled();
    });

    it('busca por prefixo do ticker ou nome, ignorando ativos ocultos', async () => {
        MarketAsset.find.mockReturnValue(chain([{ ticker: 'PETR4', name: 'Petrobras PN' }]));

        const { res } = await call(ctrl.searchAssets, { query: { q: 'PETR' } });

        expect(res.body).toEqual([{ ticker: 'PETR4', name: 'Petrobras PN' }]);
        expect(MarketAsset.find).toHaveBeenCalledWith({
            $or: [{ ticker: { $regex: '^PETR', $options: 'i' } }, { name: { $regex: 'PETR', $options: 'i' } }],
            isIgnored: { $ne: true },
        });
        expect(TreasuryBond.find).not.toHaveBeenCalled();
    });

    it('renda fixa inclui títulos do Tesouro, com o termo escapado', async () => {
        MarketAsset.find.mockReturnValue(chain([]));
        TreasuryBond.find.mockReturnValue(chain([{
            title: 'Tesouro IPCA+ 2035', unitPrice: 2100.5, rate: 7.1, index: 'IPCA', maturityDate: '15/05/2035',
        }]));

        const { res } = await call(ctrl.searchAssets, { query: { q: 'IPCA+', type: 'FIXED_INCOME' } });

        expect(TreasuryBond.find).toHaveBeenCalledWith({ title: { $regex: 'IPCA\\+', $options: 'i' } });
        expect(res.body).toEqual([{
            ticker: 'Tesouro IPCA+ 2035', name: 'Tesouro IPCA+ 2035', type: 'FIXED_INCOME', lastPrice: 2100.5,
            rate: 7.1, index: 'IPCA', maturityDate: '15/05/2035', isTreasury: true,
        }]);
    });

    it('erro vai para o error handler', async () => {
        MarketAsset.find.mockReturnValue(chain(new Error('falhou')));
        const { next } = await call(ctrl.searchAssets, { query: { q: 'PETR' } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

const txDoc = (fields) => ({ ...fields, toObject: () => ({ ...fields }) });

describe('GET /wallet/transactions/:ticker', () => {
    it('pagina com padrão de 10 e resolve a moeda gravada sem consultar a posição', async () => {
        const find = chain([txDoc({ _id: 't1', ticker: 'PETR4', currency: 'BRL', totalValue: 300 })]);
        AssetTransaction.find.mockReturnValue(find);
        AssetTransaction.countDocuments.mockResolvedValue(25);

        const { res } = await call(ctrl.getAssetTransactions, { params: { ticker: 'petr4' } });

        expect(AssetTransaction.find).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1', ticker: 'PETR4' });
        expect(find.skip).toHaveBeenCalledWith(0);
        expect(find.limit).toHaveBeenCalledWith(10);
        expect(UserAsset.findOne).not.toHaveBeenCalled();
        expect(res.body).toEqual({
            transactions: [{ _id: 't1', ticker: 'PETR4', currency: 'BRL', totalValue: 300 }],
            pagination: { total: 25, page: 1, pages: 3, hasMore: true },
        });
    });

    it('limit acima do teto é cortado em 200 e página inválida vira 1', async () => {
        const find = chain([]);
        AssetTransaction.find.mockReturnValue(find);
        AssetTransaction.countDocuments.mockResolvedValue(0);

        const { res } = await call(ctrl.getAssetTransactions, { params: { ticker: 'PETR4' }, query: { page: '-3', limit: '1000000' } });

        expect(find.limit).toHaveBeenCalledWith(ctrl.ASSET_TRANSACTIONS_MAX_LIMIT);
        expect(find.skip).toHaveBeenCalledWith(0);
        expect(res.body.pagination).toEqual({ total: 0, page: 1, pages: 0, hasMore: false });
    });

    it('lançamento legado sem moeda herda a moeda da posição (US$)', async () => {
        const find = chain([txDoc({ _id: 't1', ticker: 'AAPL', totalValue: 400 })]);
        AssetTransaction.find.mockReturnValue(find);
        AssetTransaction.countDocuments.mockResolvedValue(1);
        UserAsset.findOne.mockReturnValue(chain({ ticker: 'AAPL', type: 'STOCK_US', currency: 'USD' }));

        const { res } = await call(ctrl.getAssetTransactions, { params: { ticker: 'AAPL' }, query: { page: '1', limit: '5' } });

        expect(res.body.transactions[0].currency).toBe('USD');
        expect(res.body.pagination).toEqual({ total: 1, page: 1, pages: 1, hasMore: false });
    });

    it('erro vai para o error handler', async () => {
        AssetTransaction.find.mockReturnValue(chain(new Error('falhou')));
        const { next } = await call(ctrl.getAssetTransactions, { params: { ticker: 'PETR4' } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('GET /wallet/cashflow', () => {
    const portfolio = [
        { ticker: 'PETR4', type: 'STOCK', currency: 'BRL' },
        { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD' },
        { ticker: 'RESERVA', type: 'CASH', name: 'Reserva de emergência' },
    ];

    const mockFinds = (transactions, legacy = []) => {
        UserAsset.find.mockImplementation((filter) => chain(filter.ticker?.$in ? legacy : portfolio));
        const find = chain(transactions);
        AssetTransaction.find.mockReturnValue(find);
        AssetTransaction.countDocuments.mockResolvedValue(transactions.length + 30);
        return find;
    };

    it('marca operações de caixa, classe do ativo e moeda de cada lançamento', async () => {
        mockFinds([
            txDoc({ _id: 't1', ticker: 'PETR4', currency: 'BRL', type: 'BUY' }),
            txDoc({ _id: 't2', ticker: 'AAPL', type: 'BUY' }),
            txDoc({ _id: 't3', ticker: 'RESERVA', currency: 'BRL', type: 'BUY' }),
        ]);

        const { res } = await call(ctrl.getCashFlow);

        const [petr, aapl, cash] = res.body.transactions;
        expect(petr).toMatchObject({ isCashOp: false, assetClass: 'STOCK', assetType: 'STOCK', currency: 'BRL' });
        expect(petr.cashName).toBeUndefined();
        // Legado sem moeda gravada herda a da posição: US$ 400 não vira R$ 400.
        expect(aapl).toMatchObject({ isCashOp: false, assetType: 'STOCK_US', currency: 'USD' });
        expect(cash).toMatchObject({ isCashOp: true, cashName: 'Reserva de emergência', assetClass: 'CASH' });
        expect(res.body.pagination).toEqual({ total: 33, hasMore: true });
        // AAPL já está na carteira: nenhuma consulta extra de legado.
        expect(UserAsset.find).toHaveBeenCalledTimes(1);
    });

    it('filtro de caixa restringe aos tickers de reserva; paginação respeita page e limit', async () => {
        const find = mockFinds([]);

        const { res } = await call(ctrl.getCashFlow, { query: { filterType: 'CASH', page: 2, limit: '5' } });

        expect(AssetTransaction.find).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1', ticker: { $in: ['RESERVA'] } });
        expect(find.skip).toHaveBeenCalledWith(5);
        expect(find.limit).toHaveBeenCalledWith(5);
        expect(res.body.pagination).toEqual({ total: 30, hasMore: true });
    });

    it('lançamento legado de ativo fora da carteira busca a moeda pelo ticker', async () => {
        mockFinds([txDoc({ _id: 't9', ticker: 'IVVB11' })], [{ ticker: 'IVVB11', type: 'ETF', currency: 'USD' }]);

        const { res } = await call(ctrl.getCashFlow);

        expect(UserAsset.find).toHaveBeenLastCalledWith({ user: 'u1', wallet: 'w1', ticker: { $in: ['IVVB11'] } });
        expect(res.body.transactions[0]).toMatchObject({ currency: 'USD', assetType: 'ETF' });
    });

    it('erro vai para o error handler', async () => {
        UserAsset.find.mockReturnValue(chain(new Error('falhou')));
        const { next } = await call(ctrl.getCashFlow);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });
});

describe('rotas administrativas', () => {
    it('runCorporateAction só confirma o recebimento', async () => {
        const { res } = await call(ctrl.runCorporateAction);
        expect(res.body).toEqual({ message: 'Comando recebido.', details: { updates: 0 } });
    });

    it('fixWalletSnapshots apaga cotas absurdas e resets espúrios por carteira', async () => {
        WalletSnapshot.deleteMany.mockResolvedValueOnce({ deletedCount: 2 }).mockResolvedValueOnce({ deletedCount: 1 });
        WalletSnapshot.distinct.mockResolvedValue(['w1', 'w2']);
        WalletSnapshot.find.mockImplementation(({ wallet }) => chain(wallet === 'w1'
            ? [{ _id: 's1', quotaPrice: 120 }, { _id: 's2', quotaPrice: 100 }, { _id: 's3', quotaPrice: 121 }]
            : [{ _id: 's4', quotaPrice: 100 }, { _id: 's5', quotaPrice: 100.5 }]));

        const { res } = await call(ctrl.fixWalletSnapshots);

        expect(WalletSnapshot.deleteMany).toHaveBeenNthCalledWith(1, {
            $or: [{ quotaPrice: { $lte: 0.1 } }, { quotaPrice: { $gte: 1000000 } }],
        });
        expect(WalletSnapshot.deleteMany).toHaveBeenNthCalledWith(2, { _id: { $in: ['s2'] } });
        expect(res.body).toEqual({ message: 'Limpeza de snapshots concluída.', deletedZeros: 2, deletedResets: 1 });
    });

    it('fixWalletSnapshots com erro vai para o error handler', async () => {
        WalletSnapshot.deleteMany.mockRejectedValue(new Error('falhou'));
        const { next } = await call(ctrl.fixWalletSnapshots);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('getSnapshotHealth mede a cobertura do dia por carteira', async () => {
        Wallet.countDocuments.mockResolvedValue(20);
        WalletSnapshot.countDocuments.mockResolvedValue(19);
        const lastRun = new Date('2026-11-24T02:59:00.000Z');
        WalletSnapshot.findOne.mockReturnValue(chain({ createdAt: lastRun }));

        const { res } = await call(ctrl.getSnapshotHealth);

        expect(res.body).toEqual({ totalWallets: 20, snapshotsToday: 19, coverage: '95.0%', lastRun, status: 'HEALTHY' });
    });

    it('getSnapshotHealth sem carteiras e sem execução fica em WARNING', async () => {
        Wallet.countDocuments.mockResolvedValue(0);
        WalletSnapshot.countDocuments.mockResolvedValue(0);
        WalletSnapshot.findOne.mockReturnValue(chain(null));

        const { res } = await call(ctrl.getSnapshotHealth);

        expect(res.body).toEqual({ totalWallets: 0, snapshotsToday: 0, coverage: '0%', lastRun: undefined, status: 'WARNING' });
    });

    it('getSnapshotHealth com erro vai para o error handler', async () => {
        Wallet.countDocuments.mockRejectedValue(new Error('falhou'));
        const { next } = await call(ctrl.getSnapshotHealth);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'falhou' }));
    });

    it('forceSnapshot repassa force e devolve as estatísticas', async () => {
        runDailySnapshot.mockResolvedValue({ status: 'SUCCESS', stats: { processed: 12 } });

        const { res } = await call(ctrl.forceSnapshot, { body: { force: 'yes' } });

        expect(runDailySnapshot).toHaveBeenCalledWith(true);
        expect(res.body).toEqual({ message: 'Snapshot executado com sucesso.', stats: { processed: 12 } });
    });

    it('forceSnapshot ignorado em dia sem pregão responde 200 explicando', async () => {
        runDailySnapshot.mockResolvedValue({ status: 'SKIPPED' });

        const { res } = await call(ctrl.forceSnapshot, { body: {} });

        expect(runDailySnapshot).toHaveBeenCalledWith(false);
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toContain('Snapshot ignorado');
    });

    it('forceSnapshot com erro do scheduler vai para o error handler', async () => {
        runDailySnapshot.mockResolvedValue({ status: 'ERROR', error: 'lease ocupado' });

        const { res, next } = await call(ctrl.forceSnapshot, { body: { force: true } });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'lease ocupado' }));
        expect(res.json).not.toHaveBeenCalled();
    });
});
