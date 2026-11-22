/**
 * Importação de carteira — pré-voo CRONOLÓGICO de saldo e dedup por preço unitário.
 *
 * 1) O pré-voo somava compras e vendas sem olhar a data. VENDA em janeiro + COMPRA
 *    em fevereiro fechava em zero, passava, era inserida, e só então
 *    `recalculatePosition` recusava ("Saldo insuficiente") — deixando o lote
 *    gravado e a posição sem recalcular. A checagem agora é por dia, partindo dos
 *    lançamentos JÁ gravados do ticker, com a mesma régua do recálculo.
 * 2) A chave de dedup arredondava o preço com `safeCurrency`: duas compras de SHIB
 *    no mesmo dia e quantidade, a preços sub-centavo diferentes, colidiam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = {
  startTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  abortTransaction: vi.fn(),
  endSession: vi.fn(),
};

vi.mock('mongoose', () => ({
  default: { startSession: vi.fn(() => Promise.resolve(session)) },
}));

const chain = (value) => ({
  select: () => ({ lean: () => Promise.resolve(value) }),
  distinct: () => Promise.resolve(value),
  lean: () => Promise.resolve(value),
});

vi.mock('../models/AssetTransaction.js', () => ({
  default: { find: vi.fn(), insertMany: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('../models/UserAsset.js', () => ({
  default: { find: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/ImportBatch.js', () => ({
  default: { create: vi.fn(), findOne: vi.fn() },
}));
vi.mock('../services/financialService.js', () => ({
  financialService: { recalculatePosition: vi.fn(), rebuildUserHistory: vi.fn(), syncDividends: vi.fn() },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { applyImport, resolveRows, findChronologicalShortfall, ROW_STATUS } =
  await import('../services/portfolioImportService.js');
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const ImportBatch = (await import('../models/ImportBatch.js')).default;
const { financialService } = await import('../services/financialService.js');

const row = (over = {}) => ({
  ticker: 'PETR4', side: 'BUY', quantity: 100, price: 30, type: 'STOCK', currency: 'BRL',
  date: new Date('2024-03-15T00:00:00.000Z'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  MarketAsset.find.mockReturnValue(chain([]));
  UserAsset.find.mockReturnValue(chain([]));
  AssetTransaction.find.mockReturnValue(chain([]));
  ImportBatch.create.mockResolvedValue([{ _id: 'batch1' }]);
  AssetTransaction.insertMany.mockResolvedValue([]);
  financialService.recalculatePosition.mockResolvedValue({});
  financialService.rebuildUserHistory.mockResolvedValue();
  financialService.syncDividends.mockResolvedValue();
});

describe('findChronologicalShortfall — saldo por dia, como o recálculo', () => {
  it('venda antes da compra é furo mesmo com o saldo final zerado', () => {
    const furo = findChronologicalShortfall([], [
      row({ side: 'SELL', quantity: 10, date: new Date('2024-01-10') }),
      row({ side: 'BUY', quantity: 10, date: new Date('2024-02-10') }),
    ]);
    expect(furo).toMatchObject({ ticker: 'PETR4', dayKey: '2024-01-10', shortfall: 10 });
  });

  it('day trade com a venda digitada antes da compra no MESMO dia passa', () => {
    expect(findChronologicalShortfall([], [
      row({ side: 'SELL', quantity: 10, date: new Date('2024-01-10') }),
      row({ side: 'BUY', quantity: 10, date: new Date('2024-01-10') }),
    ])).toBeNull();
  });

  it('considera lançamentos já gravados (a compra que dá lastro pode estar na carteira)', () => {
    const gravados = [{ ticker: 'PETR4', type: 'BUY', quantity: 50, date: new Date('2024-01-02T12:00:00Z') }];
    expect(findChronologicalShortfall(gravados, [
      row({ side: 'SELL', quantity: 50, date: new Date('2024-01-10') }),
    ])).toBeNull();
    // ...e a compra gravada DEPOIS da venda importada não dá lastro.
    const tardios = [{ ticker: 'PETR4', type: 'BUY', quantity: 50, date: new Date('2024-06-02T12:00:00Z') }];
    expect(findChronologicalShortfall(tardios, [
      row({ side: 'SELL', quantity: 50, date: new Date('2024-01-10') }),
    ])).toMatchObject({ dayKey: '2024-01-10' });
  });
});

describe('applyImport — rejeita ANTES de escrever', () => {
  it('venda em janeiro + compra em fevereiro: nada é inserido', async () => {
    await expect(applyImport({
      userId: 'u1', walletId: 'w1', source: 'SHEET',
      rows: [
        row({ side: 'SELL', quantity: 10, date: new Date('2024-01-10') }),
        row({ side: 'BUY', quantity: 10, date: new Date('2024-02-10') }),
      ],
    })).rejects.toThrow(/vendas de PETR4.*10\/01\/2024/);

    expect(AssetTransaction.insertMany).not.toHaveBeenCalled();
    expect(ImportBatch.create).not.toHaveBeenCalled();
    expect(financialService.recalculatePosition).not.toHaveBeenCalled();
  });

  it('lê os lançamentos já gravados do ticker, na carteira certa', async () => {
    AssetTransaction.find.mockReturnValue(chain([
      { ticker: 'PETR4', type: 'BUY', quantity: 100, date: new Date('2024-01-02T12:00:00Z') },
    ]));

    await applyImport({
      userId: 'u1', walletId: 'w1', source: 'SHEET',
      rows: [row({ side: 'SELL', quantity: 100, date: new Date('2024-01-10') })],
    });

    expect(AssetTransaction.find).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1', ticker: { $in: ['PETR4'] } });
    expect(AssetTransaction.insertMany).toHaveBeenCalledTimes(1);
  });
});

describe('dedup — preço pela régua de preço unitário', () => {
  it('duas compras de SHIB a preços sub-centavo diferentes NÃO são duplicata', async () => {
    MarketAsset.find.mockReturnValue(chain([{ ticker: 'SHIB', type: 'CRYPTO', currency: 'USD', name: 'Shiba' }]));
    const { rows } = await resolveRows({
      userId: 'u1', walletId: 'w1',
      rows: [
        row({ ticker: 'SHIB', type: 'CRYPTO', currency: 'USD', quantity: 1000000, price: 0.00001234 }),
        row({ ticker: 'SHIB', type: 'CRYPTO', currency: 'USD', quantity: 1000000, price: 0.00001567 }),
      ],
    });
    expect(rows.map((r) => r.status)).toEqual([ROW_STATUS.OK, ROW_STATUS.OK]);
  });

  it('o mesmo preço sub-centavo segue sendo duplicata', async () => {
    MarketAsset.find.mockReturnValue(chain([{ ticker: 'SHIB', type: 'CRYPTO', currency: 'USD', name: 'Shiba' }]));
    const { rows } = await resolveRows({
      userId: 'u1', walletId: 'w1',
      rows: [
        row({ ticker: 'SHIB', type: 'CRYPTO', currency: 'USD', quantity: 1000000, price: 0.00001234 }),
        row({ ticker: 'SHIB', type: 'CRYPTO', currency: 'USD', quantity: 1000000, price: 0.00001234 }),
      ],
    });
    expect(rows[1].status).toBe(ROW_STATUS.DUPLICADO);
  });
});
