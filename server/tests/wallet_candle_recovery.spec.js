/**
 * Reconciliação matinal do snapshot degradado.
 *
 * O snapshot das 23:59 é fail-open quando as duas fontes ainda não publicaram o
 * fechamento. No dia seguinte, o candle oficial precisa entrar e a carteira
 * afetada deve ser reconstruída pela linha do tempo de transações.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userAssetFind: vi.fn(),
  historyAggregate: vi.fn(),
  ensureDayCandles: vi.fn(),
  rebuildUserHistory: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { aggregate: mocks.historyAggregate } }));
vi.mock('../services/walletDayCandleService.js', () => ({
  ensureWalletDayCandles: mocks.ensureDayCandles,
}));
vi.mock('../services/financialService.js', () => ({
  financialService: { rebuildUserHistory: mocks.rebuildUserHistory },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: mocks.loggerInfo, error: mocks.loggerError, warn: vi.fn(), debug: vi.fn() },
}));

const { previousDayKey, reconcilePreviousWalletSnapshot } = await import(
  '../services/walletCandleRecoveryService.js'
);

const wireHoldings = (rows) => {
  mocks.userAssetFind.mockReturnValue({
    select: () => ({ lean: async () => rows }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.historyAggregate.mockResolvedValue([]);
  mocks.ensureDayCandles.mockResolvedValue(new Map());
  mocks.rebuildUserHistory.mockResolvedValue([]);
});

describe('walletCandleRecoveryService', () => {
  it('calcula o dia civil anterior em virada de mês', () => {
    expect(previousDayKey('2026-09-01')).toBe('2026-08-31');
  });

  it('recupera o candle tardio e reconstrói só a carteira afetada', async () => {
    wireHoldings([
      { ticker: 'BOVA11', type: 'ETF', quantity: 10, user: 'u1', wallet: 'w1' },
      { ticker: 'IVVB11', type: 'ETF', quantity: 2, user: 'u1', wallet: 'w1' },
      { ticker: 'PETR4', type: 'STOCK', quantity: 5, user: 'u2', wallet: 'w2' },
    ]);
    mocks.ensureDayCandles.mockResolvedValue(new Map([
      ['BOVA11', 174.78],
      ['IVVB11', 449.35],
    ]));

    const result = await reconcilePreviousWalletSnapshot({ targetDay: '2026-08-31' });

    expect(mocks.ensureDayCandles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ ticker: 'BOVA11' })]),
      '2026-08-31',
      expect.any(Map),
    );
    // Dois tickers, uma carteira: rebuild único.
    expect(mocks.rebuildUserHistory).toHaveBeenCalledTimes(1);
    expect(mocks.rebuildUserHistory).toHaveBeenCalledWith('u1', 'w1', {
      throughDayKey: '2026-08-31',
      source: 'REBUILD',
    });
    expect(result).toMatchObject({ status: 'SUCCESS', recovered: 2, rebuilt: 1, failed: 0 });
    expect(result.tickers.sort()).toEqual(['BOVA11', 'IVVB11']);
  });

  it('não reconstrói carteira quando nenhuma fonte trouxe candle novo', async () => {
    wireHoldings([
      { ticker: 'BOVA11', type: 'ETF', quantity: 10, user: 'u1', wallet: 'w1' },
    ]);
    mocks.ensureDayCandles.mockResolvedValue(new Map());

    const result = await reconcilePreviousWalletSnapshot({ targetDay: '2026-08-31' });

    expect(result).toMatchObject({ status: 'SUCCESS', recovered: 0, rebuilt: 0, failed: 0 });
    expect(mocks.rebuildUserHistory).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).not.toHaveBeenCalled();
  });

  it('isola falha de rebuild por carteira e continua nas demais', async () => {
    wireHoldings([
      { ticker: 'BOVA11', type: 'ETF', quantity: 10, user: 'u1', wallet: 'w1' },
      { ticker: 'IVVB11', type: 'ETF', quantity: 2, user: 'u2', wallet: 'w2' },
    ]);
    mocks.ensureDayCandles.mockResolvedValue(new Map([
      ['BOVA11', 174.78],
      ['IVVB11', 449.35],
    ]));
    mocks.rebuildUserHistory
      .mockRejectedValueOnce(new Error('histórico insuficiente'))
      .mockResolvedValueOnce([]);

    const result = await reconcilePreviousWalletSnapshot({ targetDay: '2026-08-31' });

    expect(mocks.rebuildUserHistory).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: 'PARTIAL', recovered: 2, rebuilt: 1, failed: 1 });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.stringContaining('histórico insuficiente'),
    );
  });

  it('em dia sem pregão não busca candle nem reconstrói snapshot inexistente', async () => {
    wireHoldings([
      { ticker: 'BOVA11', type: 'ETF', quantity: 10, user: 'u1', wallet: 'w1' },
      { ticker: 'BTC', type: 'CRYPTO', quantity: 0.1, user: 'u1', wallet: 'w1' },
    ]);

    const result = await reconcilePreviousWalletSnapshot({ targetDay: '2026-08-30' }); // domingo

    expect(result.status).toBe('SKIPPED');
    expect(mocks.userAssetFind).not.toHaveBeenCalled();
    expect(mocks.ensureDayCandles).not.toHaveBeenCalled();
    expect(mocks.rebuildUserHistory).not.toHaveBeenCalled();
  });
});
