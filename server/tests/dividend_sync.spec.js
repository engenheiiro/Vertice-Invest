/**
 * Proventos — ingestão (financialService.syncDividends).
 * Garante que: busca por ticker e faz upsert em DividendEvent; conta só os
 * inseridos (upsertedCount); ignora cripto/renda fixa/caixa e tickers repetidos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/DividendEvent.js', () => ({ default: { updateOne: vi.fn(), find: vi.fn(), deleteMany: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getDividendsHistory: vi.fn() },
}));
// Modelos não usados neste teste, mas importados pelo financialService:
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));

const DividendEvent = (await import('../models/DividendEvent.js')).default;
const { externalMarketService } = await import('../services/externalMarketService.js');
const { financialService } = await import('../services/financialService.js');

/** Encadeável para os dois formatos usados no serviço: .select().lean() e .sort().lean(). */
const chain = (rows = []) => {
  const self = { select: () => self, sort: () => self, lean: async () => rows };
  return self;
};

beforeEach(() => {
  vi.clearAllMocks();
  DividendEvent.updateOne.mockResolvedValue({ upsertedCount: 1 });
  // Reconciliação do provisório: sem provisórios, nada a remover.
  DividendEvent.find.mockReturnValue(chain([]));
  DividendEvent.deleteMany.mockResolvedValue({ deletedCount: 0 });
});

describe('financialService.syncDividends', () => {
  it('busca e faz upsert dos proventos, contando os novos', async () => {
    externalMarketService.getDividendsHistory.mockResolvedValue([
      { date: new Date('2026-03-02'), amount: 0.10 },
      { date: new Date('2026-04-01'), amount: 0.095 },
    ]);

    const res = await financialService.syncDividends([{ ticker: 'mxrf11', type: 'FII' }]);

    expect(externalMarketService.getDividendsHistory).toHaveBeenCalledWith('mxrf11', 'FII');
    expect(DividendEvent.updateOne).toHaveBeenCalledTimes(2);
    // upsert filtra por ticker normalizado (uppercase) + date + amount
    const firstCall = DividendEvent.updateOne.mock.calls[0][0];
    expect(firstCall.ticker).toBe('MXRF11');
    expect(res).toEqual({ tickers: 1, events: 2, expirados: 0 });
  });

  it('não conta evento já existente (upsertedCount 0)', async () => {
    externalMarketService.getDividendsHistory.mockResolvedValue([{ date: new Date('2026-03-02'), amount: 0.10 }]);
    DividendEvent.updateOne.mockResolvedValue({ upsertedCount: 0 });

    const res = await financialService.syncDividends([{ ticker: 'MXRF11', type: 'FII' }]);
    expect(res).toEqual({ tickers: 1, events: 0, expirados: 0 });
  });

  it('ignora cripto/renda fixa/caixa e tickers repetidos', async () => {
    externalMarketService.getDividendsHistory.mockResolvedValue([]);

    const res = await financialService.syncDividends([
      { ticker: 'BTC', type: 'CRYPTO' },
      { ticker: 'TESOURO', type: 'FIXED_INCOME' },
      { ticker: 'PETR4', type: 'STOCK' },
      { ticker: 'PETR4', type: 'STOCK' }, // repetido
    ]);

    // só PETR4 (uma vez) chega ao fetch
    expect(externalMarketService.getDividendsHistory).toHaveBeenCalledTimes(1);
    expect(externalMarketService.getDividendsHistory).toHaveBeenCalledWith('PETR4', 'STOCK');
    expect(res.tickers).toBe(1);
  });

  it('lista vazia retorna zero sem buscar nada', async () => {
    const res = await financialService.syncDividends([]);
    expect(externalMarketService.getDividendsHistory).not.toHaveBeenCalled();
    expect(res).toEqual({ tickers: 0, events: 0, expirados: 0 });
  });

  it('IVVB11 não busca proventos e remove o provisório falso já gravado', async () => {
    DividendEvent.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const res = await financialService.syncDividends([{ ticker: 'ivvb11', type: 'ETF' }]);

    expect(externalMarketService.getDividendsHistory).not.toHaveBeenCalled();
    expect(DividendEvent.updateOne).not.toHaveBeenCalled();
    expect(DividendEvent.deleteMany).toHaveBeenCalledWith({ ticker: 'IVVB11', source: 'DERIVED' });
    expect(res).toEqual({ tickers: 0, events: 0, expirados: 0 });
  });
});

/**
 * ── O PROVISÓRIO TEM PRAZO — E DUAS CHANCES DE SER CONFIRMADO ───────────────
 *
 * Medido em 09/09/2026: 928 eventos DERIVED no banco (36% do razão de proventos)
 * e nenhum caminho que os retirasse. Entre eles, 44 nasceram no feriado de 07/09,
 * quando a B3 não abriu. Mas entre eles também estavam 133 pagamentos REAIS de
 * FII que o Yahoo nunca publicou e que só a B3 datou — por isso confirmar não é
 * só "a fonte de valor publicou".
 */
describe('financialService.expireUnconfirmedDerivedDividends', () => {
  const dias = (n) => new Date(Date.now() - n * 86400000);

  it('apaga o provisório vencido que nenhuma fonte reconheceu', async () => {
    DividendEvent.find
      .mockReturnValueOnce(chain([{ _id: 'p1', ticker: 'KNCR11', date: dias(10) }]))
      .mockReturnValueOnce(chain([{ ticker: 'KNCR11', date: dias(40) }]));

    expect(await financialService.expireUnconfirmedDerivedDividends()).toBe(1);
    expect(DividendEvent.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['p1'] } });
  });

  it('preserva o provisório que a fonte oficial confirmou por perto', async () => {
    DividendEvent.find
      .mockReturnValueOnce(chain([{ _id: 'p1', ticker: 'KNCR11', date: dias(10) }]))
      .mockReturnValueOnce(chain([{ ticker: 'KNCR11', date: dias(9) }]));

    expect(await financialService.expireUnconfirmedDerivedDividends()).toBe(0);
    expect(DividendEvent.deleteMany).not.toHaveBeenCalled();
  });

  it('não olha para quem tem data de pagamento de fonte — a B3 já confirmou', async () => {
    DividendEvent.find.mockReturnValue(chain([]));

    expect(await financialService.expireUnconfirmedDerivedDividends()).toBe(0);
    // O filtro exclui na consulta quem tem paymentDateSource: sem isso, os 133
    // pagamentos de FII datados pela B3 sairiam junto com os fantasmas.
    expect(DividendEvent.find.mock.calls[0][0]).toMatchObject({
      source: 'DERIVED',
      paymentDateSource: { $in: [null, undefined] },
    });
  });

  it('provisório recente fica: a fonte ainda está no prazo de publicar', async () => {
    DividendEvent.find.mockReturnValue(chain([]));
    await financialService.expireUnconfirmedDerivedDividends();

    const corte = DividendEvent.find.mock.calls[0][0].date.$lt;
    const idadeDias = (Date.now() - corte.getTime()) / 86400000;
    expect(idadeDias).toBeCloseTo(7, 1);
  });
});
