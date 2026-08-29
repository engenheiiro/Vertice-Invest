/**
 * Importação de carteira em lote (Investidor10 / extrato B3 / planilha).
 *
 * Cobre o que só o servidor pode decidir: normalização de ticker, resolução de
 * classe contra o catálogo, detecção de duplicata, a simulação de saldo que
 * impede uma venda sem lastro de quebrar a posição, e a economia do commit
 * (um recálculo por ticker, um rebuild no fim — não um por lançamento).
 * Sem rede e sem banco: mongoose, models e financialService são mockados.
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

// Helper de query encadeável: `.select().lean()` e `.distinct()`.
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

const { extractTicker, resolveRows, applyImport, undoImport, ROW_STATUS } =
  await import('../services/portfolioImportService.js');
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const ImportBatch = (await import('../models/ImportBatch.js')).default;
const { financialService } = await import('../services/financialService.js');

/** Estado do "banco" para um teste: catálogo, posições e transações existentes. */
const givenDb = ({ catalog = [], positions = [], transactions = [] } = {}) => {
  MarketAsset.find.mockReturnValue(chain(catalog));
  UserAsset.find.mockReturnValue(chain(positions));
  AssetTransaction.find.mockReturnValue(chain(transactions));
};

const row = (over = {}) => ({
  ticker: 'PETR4',
  side: 'BUY',
  quantity: 100,
  price: 30,
  date: new Date('2024-03-15T00:00:00.000Z'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  financialService.recalculatePosition.mockResolvedValue({});
  financialService.rebuildUserHistory.mockResolvedValue();
  financialService.syncDividends.mockResolvedValue();
});

describe('extractTicker — código de negociação a partir do rótulo do extrato', () => {
  it('extrai o ticker do formato "PETR4 - NOME DA EMPRESA" da B3', () => {
    expect(extractTicker('PETR4 - PETROLEO BRASILEIRO S.A. PETROBRAS')).toBe('PETR4');
  });

  it('normaliza o ticker fracionário para o lote padrão', () => {
    // Sem isso a carteira nasce com PETR4 e PETR4F como duas posições da mesma empresa.
    expect(extractTicker('PETR4F')).toBe('PETR4');
    expect(extractTicker('MXRF11F - MAXI RENDA FDO INV IMOB')).toBe('MXRF11');
  });

  it('não confunde hífen do nome com o separador de coluna', () => {
    expect(extractTicker('SANB11 - BANCO SANTANDER-BRASIL')).toBe('SANB11');
  });

  it('preserva o rótulo que não é código de negociação', () => {
    // Reduzido ao primeiro token, todo título do Tesouro virava "TESOURO" e dois
    // papéis diferentes se fundiam numa posição só, com custo somado.
    expect(extractTicker('Tesouro Selic 2029')).toBe('TESOURO SELIC 2029');
    expect(extractTicker('Tesouro IPCA+ 2035')).toBe('TESOURO IPCA+ 2035');
  });

  it('devolve string vazia para entrada vazia em vez de explodir', () => {
    expect(extractTicker('')).toBe('');
    expect(extractTicker(null)).toBe('');
  });
});

describe('resolveRows — classificação contra o catálogo', () => {
  it('resolve tipo, moeda e nome pelo MarketAsset quando o parser não os traz', async () => {
    givenDb({ catalog: [{ ticker: 'MXRF11', name: 'Maxi Renda', type: 'FII', currency: 'BRL' }] });

    const { rows } = await resolveRows({
      userId: 'u1', walletId: 'w1', rows: [row({ ticker: 'MXRF11 - MAXI RENDA' })],
    });

    expect(rows[0]).toMatchObject({ ticker: 'MXRF11', type: 'FII', currency: 'BRL', name: 'Maxi Renda', status: ROW_STATUS.OK });
  });

  it('marca como não reconhecido o ativo fora do catálogo, sem chutar a classe', async () => {
    // "Termina em 11" é FII, ETF ou unit — adivinhar desloca o ativo de classe
    // na alocação inteira, então a linha volta para o usuário decidir.
    givenDb({});

    const { rows } = await resolveRows({
      userId: 'u1', walletId: 'w1', rows: [row({ ticker: 'XPTO11' })],
    });

    expect(rows[0].status).toBe(ROW_STATUS.NAO_RECONHECIDO);
    expect(rows[0].type).toBeNull();
  });

  it('respeita o tipo explícito do parser acima do catálogo', async () => {
    givenDb({ catalog: [{ ticker: 'GOLD11', name: 'Ouro', type: 'STOCK', currency: 'BRL' }] });

    const { rows } = await resolveRows({
      userId: 'u1', walletId: 'w1', rows: [row({ ticker: 'GOLD11', type: 'ETF' })],
    });

    expect(rows[0].type).toBe('ETF');
  });

  it('detecta lançamento idêntico já existente na carteira', async () => {
    givenDb({
      catalog: [{ ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' }],
      transactions: [{ ticker: 'PETR4', date: new Date('2024-03-15T12:00:00.000Z'), type: 'BUY', quantity: 100, price: 30 }],
    });

    const { rows } = await resolveRows({ userId: 'u1', walletId: 'w1', rows: [row()] });

    expect(rows[0].status).toBe(ROW_STATUS.DUPLICADO);
  });

  it('detecta linha repetida dentro do próprio arquivo', async () => {
    givenDb({ catalog: [{ ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' }] });

    const { rows } = await resolveRows({ userId: 'u1', walletId: 'w1', rows: [row(), row()] });

    expect(rows[0].status).toBe(ROW_STATUS.OK);
    expect(rows[1].status).toBe(ROW_STATUS.DUPLICADO);
  });

  it('sinaliza venda maior que a posição acumulada até a data', async () => {
    givenDb({ catalog: [{ ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' }] });

    const { rows } = await resolveRows({
      userId: 'u1',
      walletId: 'w1',
      rows: [
        row({ quantity: 50, date: new Date('2024-01-10') }),
        row({ side: 'SELL', quantity: 80, date: new Date('2024-05-10') }),
      ],
    });

    expect(rows[1].status).toBe(ROW_STATUS.ATENCAO);
    expect(rows[1].reason).toMatch(/Venda maior/);
  });

  it('considera a posição JÁ EXISTENTE ao julgar a venda', async () => {
    // Quem já tem 100 PETR4 na carteira pode importar uma venda de 80 sem alarme.
    givenDb({
      catalog: [{ ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' }],
      positions: [{ ticker: 'PETR4', quantity: 100, type: 'STOCK', currency: 'BRL' }],
    });

    const { rows } = await resolveRows({
      userId: 'u1', walletId: 'w1', rows: [row({ side: 'SELL', quantity: 80 })],
    });

    expect(rows[0].status).toBe(ROW_STATUS.OK);
  });

  it('julga o saldo em ordem CRONOLÓGICA, não na ordem do arquivo', async () => {
    // Extrato da B3 vem do mais recente para o mais antigo. Julgar na ordem do
    // arquivo acusaria venda sem lastro numa carteira perfeitamente válida.
    givenDb({ catalog: [{ ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' }] });

    const { rows } = await resolveRows({
      userId: 'u1',
      walletId: 'w1',
      rows: [
        row({ side: 'SELL', quantity: 80, date: new Date('2024-05-10') }),
        row({ side: 'BUY', quantity: 100, date: new Date('2024-01-10') }),
      ],
    });

    expect(rows.every((r) => r.status === ROW_STATUS.OK)).toBe(true);
  });

  it('resume a posição resultante para conferência contra a origem', async () => {
    givenDb({ catalog: [{ ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' }] });

    const { summary } = await resolveRows({
      userId: 'u1',
      walletId: 'w1',
      rows: [
        row({ quantity: 100, price: 30, date: new Date('2024-01-10') }),
        row({ quantity: 100, price: 40, date: new Date('2024-02-10') }),
      ],
    });

    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ ticker: 'PETR4', quantity: 200, averagePrice: 35, totalCost: 7000 });
  });

  it('conta na posição a linha que só espera a CLASSE do usuário', async () => {
    // O Tesouro do extrato da B3 não está no catálogo de mercado. Deixá-lo fora
    // do resumo mostrava quantidade e valor ZERO na conferência — o número que o
    // usuário abriu a tela para conferir — enquanto o commit gravava certo.
    givenDb({});

    const { rows, summary } = await resolveRows({
      userId: 'u1',
      walletId: 'w1',
      rows: [row({ ticker: 'Tesouro IPCA+ 2032', quantity: 0.25, price: 2943.69 })],
    });

    expect(rows[0].status).toBe(ROW_STATUS.NAO_RECONHECIDO);
    // O custo é o do extrato (0,25 × 2.943,69 = R$ 735,92). O preço médio é
    // derivado do custo em CENTAVOS, então fica um centavo abaixo do PU do
    // título — é o que a posição vai mostrar depois, e não uma divergência.
    expect(summary[0]).toMatchObject({
      ticker: 'TESOURO IPCA+ 2032',
      quantity: 0.25,
      totalCost: 735.92,
      averagePrice: 2943.68,
    });
  });

  it('não conta duplicatas na posição resultante', async () => {
    givenDb({ catalog: [{ ticker: 'PETR4', name: 'Petrobras', type: 'STOCK', currency: 'BRL' }] });

    const { summary } = await resolveRows({ userId: 'u1', walletId: 'w1', rows: [row(), row()] });

    expect(summary[0].quantity).toBe(100);
  });
});

describe('applyImport — gravação do lote', () => {
  const givenWritableDb = () => {
    givenDb({});
    ImportBatch.create.mockResolvedValue([{ _id: 'batch1' }]);
    AssetTransaction.insertMany.mockResolvedValue([]);
  };

  it('grava os lançamentos e carimba lote e fonte em cada um', async () => {
    givenWritableDb();

    const result = await applyImport({
      userId: 'u1', walletId: 'w1', source: 'B3_MOVIMENTACAO',
      rows: [row({ type: 'STOCK', currency: 'BRL' })],
    });

    const [docs] = AssetTransaction.insertMany.mock.calls[0];
    expect(docs[0]).toMatchObject({
      ticker: 'PETR4', type: 'BUY', quantity: 100, price: 30, totalValue: 3000,
      currency: 'BRL', importBatchId: 'batch1', importSource: 'B3_MOVIMENTACAO',
    });
    expect(result).toMatchObject({ batchId: 'batch1', inserted: 1 });
  });

  it('ancora a data no meio-dia UTC (dia-calendário, não meia-noite)', async () => {
    givenWritableDb();

    await applyImport({
      userId: 'u1', walletId: 'w1', source: 'SHEET',
      rows: [row({ type: 'STOCK', date: new Date('2024-03-15T00:00:00.000Z') })],
    });

    const [docs] = AssetTransaction.insertMany.mock.calls[0];
    expect(docs[0].date.toISOString()).toBe('2024-03-15T12:00:00.000Z');
  });

  it('NÃO carimba fxRate — quem congela o câmbio é o recálculo', async () => {
    // Regra do câmbio congelado (CLAUDE.md §8): recalculatePosition resolve a
    // taxa pela série histórica do dia da compra. Chutar aqui reintroduziria o
    // bug de reconverter custo pela cotação de hoje.
    givenWritableDb();

    await applyImport({
      userId: 'u1', walletId: 'w1', source: 'SHEET',
      rows: [row({ ticker: 'AAPL', type: 'STOCK_US', currency: 'USD' })],
    });

    const [docs] = AssetTransaction.insertMany.mock.calls[0];
    expect(docs[0].fxRate).toBeUndefined();
    expect(docs[0].currency).toBe('USD');
  });

  it('recalcula UMA vez por ticker distinto e reconstrói o histórico UMA vez', async () => {
    // É a razão de existir do endpoint em lote: 4 lançamentos de 2 ativos não
    // podem virar 4 recálculos e 4 rebuilds.
    givenWritableDb();

    await applyImport({
      userId: 'u1', walletId: 'w1', source: 'B3_NEGOCIACAO',
      rows: [
        row({ ticker: 'PETR4', type: 'STOCK' }),
        row({ ticker: 'PETR4', type: 'STOCK', date: new Date('2024-04-15') }),
        row({ ticker: 'VALE3', type: 'STOCK' }),
        row({ ticker: 'VALE3', type: 'STOCK', date: new Date('2024-04-15') }),
      ],
    });

    expect(financialService.recalculatePosition).toHaveBeenCalledTimes(2);
    expect(financialService.rebuildUserHistory).toHaveBeenCalledTimes(1);
  });

  it('passa tipo e moeda como forcedType/forcedCurrency ao recalcular', async () => {
    // Sem isso um ativo fora do catálogo nasce como STOCK/BRL por default e cai
    // na classe errada da alocação.
    givenWritableDb();

    await applyImport({
      userId: 'u1', walletId: 'w1', source: 'SHEET',
      rows: [row({ ticker: 'BTC', type: 'CRYPTO', currency: 'USD' })],
    });

    expect(financialService.recalculatePosition).toHaveBeenCalledWith(
      'u1', 'BTC', 'CRYPTO', null, 'USD', 'w1'
    );
  });

  it('rejeita ANTES de escrever quando as vendas superam as compras', async () => {
    // recalculatePosition lança "Saldo insuficiente" quando a quantidade final
    // fica negativa. Descobrir isso depois do insertMany deixaria o lote gravado
    // com a posição quebrada.
    givenWritableDb();

    await expect(applyImport({
      userId: 'u1', walletId: 'w1', source: 'SHEET',
      rows: [
        row({ type: 'STOCK', side: 'BUY', quantity: 50 }),
        row({ type: 'STOCK', side: 'SELL', quantity: 80, date: new Date('2024-04-15') }),
      ],
    })).rejects.toThrow(/vendas de PETR4/);

    expect(AssetTransaction.insertMany).not.toHaveBeenCalled();
    expect(ImportBatch.create).not.toHaveBeenCalled();
  });

  it('dispara sync de proventos dos pagadores importados', async () => {
    // O self-heal da aba Proventos só acorda quando TUDO está zerado, então quem
    // importa numa carteira que já tem proventos ficaria esperando o cron das
    // 04:00. O lançamento avulso já sincroniza na hora; o import também.
    givenWritableDb();

    await applyImport({
      userId: 'u1', walletId: 'w1', source: 'B3_MOVIMENTACAO',
      rows: [row({ ticker: 'PETR4', type: 'STOCK' }), row({ ticker: 'MXRF11', type: 'FII' })],
    });

    expect(financialService.syncDividends).toHaveBeenCalledWith([
      { ticker: 'PETR4', type: 'STOCK' },
      { ticker: 'MXRF11', type: 'FII' },
    ]);
  });

  it('não pede proventos de cripto, renda fixa nem caixa', async () => {
    givenWritableDb();

    await applyImport({
      userId: 'u1', walletId: 'w1', source: 'SHEET',
      rows: [row({ ticker: 'BTC', type: 'CRYPTO' }), row({ ticker: 'TESOURO SELIC 2029', type: 'FIXED_INCOME' })],
    });

    expect(financialService.syncDividends).not.toHaveBeenCalled();
  });

  it('falha no sync de proventos não derruba o import (roda em background)', async () => {
    givenWritableDb();
    financialService.syncDividends.mockRejectedValue(new Error('fonte fora do ar'));

    const result = await applyImport({
      userId: 'u1', walletId: 'w1', source: 'SHEET',
      rows: [row({ type: 'STOCK' })],
    });

    expect(result.inserted).toBe(1);
  });

  it('uma falha de recálculo não derruba o import inteiro', async () => {
    givenWritableDb();
    financialService.recalculatePosition
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('catálogo indisponível'));

    const result = await applyImport({
      userId: 'u1', walletId: 'w1', source: 'SHEET',
      rows: [row({ ticker: 'PETR4', type: 'STOCK' }), row({ ticker: 'VALE3', type: 'STOCK' })],
    });

    expect(result.failures).toEqual([{ ticker: 'VALE3', message: 'catálogo indisponível' }]);
    expect(financialService.rebuildUserHistory).toHaveBeenCalledTimes(1);
  });
});

describe('undoImport — reversão do lote', () => {
  it('apaga os lançamentos do lote e marca o lote como desfeito', async () => {
    const batch = { _id: 'batch1', tickers: ['PETR4'], save: vi.fn(), undoneAt: null };
    ImportBatch.findOne.mockResolvedValue(batch);
    AssetTransaction.deleteMany.mockResolvedValue({ deletedCount: 3 });
    AssetTransaction.find.mockReturnValue(chain([]));
    UserAsset.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const result = await undoImport({ userId: 'u1', walletId: 'w1', batchId: 'batch1' });

    expect(AssetTransaction.deleteMany).toHaveBeenCalledWith({ wallet: 'w1', importBatchId: 'batch1' });
    expect(result).toMatchObject({ removed: 3 });
    expect(batch.undoneAt).toBeInstanceOf(Date);
    expect(batch.save).toHaveBeenCalled();
  });

  it('remove a posição órfã que só existia por causa do import', async () => {
    const batch = { _id: 'batch1', tickers: ['PETR4'], save: vi.fn() };
    ImportBatch.findOne.mockResolvedValue(batch);
    AssetTransaction.deleteMany.mockResolvedValue({ deletedCount: 2 });
    AssetTransaction.find.mockReturnValue(chain([])); // nenhuma transação restante
    UserAsset.deleteMany.mockResolvedValue({ deletedCount: 1 });

    await undoImport({ userId: 'u1', walletId: 'w1', batchId: 'batch1' });

    expect(UserAsset.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: { $in: ['PETR4'] } })
    );
  });

  it('PRESERVA a posição que tinha lançamentos anteriores ao import', async () => {
    const batch = { _id: 'batch1', tickers: ['PETR4'], save: vi.fn() };
    ImportBatch.findOne.mockResolvedValue(batch);
    AssetTransaction.deleteMany.mockResolvedValue({ deletedCount: 2 });
    AssetTransaction.find.mockReturnValue(chain(['PETR4'])); // ainda há transações
    UserAsset.deleteMany.mockResolvedValue({ deletedCount: 0 });

    await undoImport({ userId: 'u1', walletId: 'w1', batchId: 'batch1' });

    expect(UserAsset.deleteMany).not.toHaveBeenCalled();
  });

  it('devolve null para lote de outra carteira (a query já filtra por dono)', async () => {
    ImportBatch.findOne.mockResolvedValue(null);

    const result = await undoImport({ userId: 'u1', walletId: 'w1', batchId: 'alheio' });

    expect(result).toBeNull();
    expect(AssetTransaction.deleteMany).not.toHaveBeenCalled();
  });
});
