/**
 * Provento detectado pelo GAP do dia-ex — a ponte sobre a defasagem da fonte.
 *
 * A fonte oficial (Yahoo) publica o provento 1-3 dias DEPOIS da data-ex. Nesse
 * intervalo a carteira registrava a queda de preço do dia-ex sem o crédito que a
 * compensa (01/09/2026: R$ 5,30 invisíveis numa carteira de R$ 22 mil).
 *
 * Cobre as três camadas: a derivação pura e suas travas, a detecção no sync de
 * cotações e a reconciliação quando o oficial finalmente chega.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { deriveDividendFromGap, DERIVED_RECONCILE_WINDOW_MS } = await import('../utils/dividendGap.js');

// Caso real medido em 01/09/2026 (fechamento bruto de 31/08 x previousClose ajustado).
const REAL = {
  TRXF11: { raw: 79.30, adj: 78.37, div: 0.93 },
  KNCR11: { raw: 108.09, adj: 106.94, div: 1.15 },
  HGCR11: { raw: 95.30, adj: 94.30, div: 1.00 },
  RZTR11: { raw: 86.10, adj: 85.25, div: 0.85 },
  KNSC11: { raw: 9.14, adj: 9.05, div: 0.09 },
  HGBS11: { raw: 18.69, adj: 18.52, div: 0.17 },
};
const base = { type: 'FII', priceDate: '2026-09-01', rawPrevCloseDate: '2026-08-31' };

describe('deriveDividendFromGap — derivação', () => {
  it('recupera o provento dos seis FIIs que foram ex em 01/09/2026', () => {
    for (const [ticker, c] of Object.entries(REAL)) {
      const out = deriveDividendFromGap({ ...base, rawPrevClose: c.raw, adjustedPrevClose: c.adj });
      expect(out, ticker).not.toBeNull();
      expect(out.amount, ticker).toBeCloseTo(c.div, 6);
      expect(out.exDate, ticker).toBe('2026-09-01');
    }
  });

  it('soma exatamente os R$ 5,30 que faltavam na carteira', () => {
    const qty = { TRXF11: 2, KNCR11: 1, HGCR11: 1, RZTR11: 1, KNSC11: 3, HGBS11: 1 };
    const total = Object.entries(REAL).reduce((acc, [t, c]) => {
      const out = deriveDividendFromGap({ ...base, rawPrevClose: c.raw, adjustedPrevClose: c.adj });
      return acc + out.amount * qty[t];
    }, 0);
    expect(total).toBeCloseTo(5.30, 2);
  });

  it('BTLG11 (sem data-ex no dia) não vira provento — controle negativo', () => {
    expect(deriveDividendFromGap({ ...base, rawPrevClose: 99.10, adjustedPrevClose: 99.10 })).toBeNull();
  });

  it('bloqueia SPLIT 2:1, que também abre gap no previousClose', () => {
    expect(deriveDividendFromGap({ ...base, type: 'STOCK', rawPrevClose: 100, adjustedPrevClose: 50 })).toBeNull();
  });

  it('bloqueia bonificação acima do teto de 10% do preço', () => {
    expect(deriveDividendFromGap({ ...base, type: 'STOCK', rawPrevClose: 100, adjustedPrevClose: 88 })).toBeNull();
    // 3% (ordem de grandeza do PETR4 em 24/08/2026) passa.
    expect(deriveDividendFromGap({ ...base, type: 'STOCK', rawPrevClose: 45.02, adjustedPrevClose: 43.67 })).not.toBeNull();
  });

  it('ignora classes que não pagam provento em dinheiro', () => {
    for (const type of ['CRYPTO', 'FIXED_INCOME', 'CASH']) {
      expect(deriveDividendFromGap({ ...base, type, rawPrevClose: 79.30, adjustedPrevClose: 78.37 }), type).toBeNull();
    }
  });

  it('exige que o candle seja de uma sessão ANTERIOR à da cotação', () => {
    expect(deriveDividendFromGap({ ...base, rawPrevCloseDate: '2026-09-01', rawPrevClose: 79.30, adjustedPrevClose: 78.37 })).toBeNull();
    expect(deriveDividendFromGap({ ...base, rawPrevCloseDate: '2026-09-02', rawPrevClose: 79.30, adjustedPrevClose: 78.37 })).toBeNull();
  });

  it('rejeita candle de duas sessões atrás — caso real do falso IVVB11', () => {
    expect(deriveDividendFromGap({
      type: 'ETF',
      priceDate: '2026-09-02',
      rawPrevCloseDate: '2026-08-31',
      rawPrevClose: 449.35,
      adjustedPrevClose: 444.35,
    })).toBeNull();
  });

  it('descarta ruído abaixo de um centavo e gap negativo', () => {
    expect(deriveDividendFromGap({ ...base, rawPrevClose: 79.30, adjustedPrevClose: 79.295 })).toBeNull();
    expect(deriveDividendFromGap({ ...base, rawPrevClose: 78.37, adjustedPrevClose: 79.30 })).toBeNull();
  });

  it('rejeita valor implausível frente à mediana do próprio ticker', () => {
    // KNSC11 paga ~0,10/cota; um gap de 0,80 (8x) não é o provento dele.
    expect(deriveDividendFromGap({
      ...base, rawPrevClose: 9.14, adjustedPrevClose: 8.34, knownAmounts: [0.099, 0.11, 0.10, 0.105],
    })).toBeNull();
    // O valor real passa pela mesma trava.
    expect(deriveDividendFromGap({
      ...base, rawPrevClose: 9.14, adjustedPrevClose: 9.05, knownAmounts: [0.099, 0.11, 0.10, 0.105],
    })).not.toBeNull();
  });

  it('aceita pagador estreante (menos de 3 proventos conhecidos)', () => {
    const out = deriveDividendFromGap({ ...base, rawPrevClose: 79.30, adjustedPrevClose: 78.37, knownAmounts: [1.5] });
    expect(out).not.toBeNull();
    expect(out.amount).toBeCloseTo(0.93, 6);
  });
});

// ---------------------------------------------------------------------------

vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn(), bulkWrite: vi.fn() } }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: { aggregate: vi.fn() } }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/FundamentalSnapshot.js', () => ({ default: {} }));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: vi.fn(), updateOne: vi.fn(), deleteMany: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: { getQuotes: vi.fn(), getDividendsHistory: vi.fn() } }));
vi.mock('../services/configService.js', () => ({ getTunablesSync: () => ({ marketCacheMinutes: 15 }) }));

const DividendEvent = (await import('../models/DividendEvent.js')).default;
const AssetHistory = (await import('../models/AssetHistory.js')).default;
const { marketDataService } = await import('../services/marketDataService.js');

const chain = (rows = []) => {
  const self = { select: () => self, sort: () => self, lean: async () => rows };
  return self;
};

// A cotação precisa ser da sessão de HOJE (BR) — o serviço compara com o relógio.
const todayBr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const yesterdayBr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
  .format(new Date(Date.now() - 86400000));
const nowInSession = new Date(`${todayBr}T17:00:00.000-03:00`);

describe('marketDataService.detectExDateDividends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    DividendEvent.find.mockReturnValue(chain([]));
    DividendEvent.updateOne.mockResolvedValue({ upsertedCount: 1 });
    AssetHistory.aggregate.mockResolvedValue([
      { ticker: 'TRXF11', candle: { date: yesterdayBr, close: 79.30 } },
    ]);
  });

  const quotes = [{ ticker: 'TRXF11', previousClose: 78.37, marketTime: nowInSession }];
  const assetMap = new Map([['TRXF11', { ticker: 'TRXF11', type: 'FII' }]]);

  it('grava o provisório com a data-ex do dia e marca a procedência', async () => {
    const written = await marketDataService.detectExDateDividends(quotes, assetMap);
    expect(written).toBe(1);

    const [filter, update, opts] = DividendEvent.updateOne.mock.calls[0];
    expect(filter.ticker).toBe('TRXF11');
    expect(filter.type).toBe('DIVIDEND');
    expect(new Date(filter.date).toISOString().slice(0, 10)).toBe(todayBr);
    expect(update.$set.amount).toBeCloseTo(0.93, 6);
    expect(update.$set.source).toBe('DERIVED');
    expect(opts.upsert).toBe(true);
  });

  it('não grava quando a fonte oficial já publicou perto da data-ex', async () => {
    const [y, m, d] = todayBr.split('-').map(Number);
    DividendEvent.find.mockReturnValue(chain([
      { ticker: 'TRXF11', date: new Date(Date.UTC(y, m - 1, d)), amount: 0.93, source: 'PROVIDER' },
    ]));
    expect(await marketDataService.detectExDateDividends(quotes, assetMap)).toBe(0);
    expect(DividendEvent.updateOne).not.toHaveBeenCalled();
  });

  it('não deriva provento de IVVB11, que reinveste rendimentos na cota', async () => {
    const ivvbQuotes = [{ ticker: 'IVVB11', previousClose: 444.35, marketTime: nowInSession }];
    const ivvbAssets = new Map([['IVVB11', { ticker: 'IVVB11', type: 'ETF' }]]);

    expect(await marketDataService.detectExDateDividends(ivvbQuotes, ivvbAssets)).toBe(0);
    expect(AssetHistory.aggregate).not.toHaveBeenCalled();
    expect(DividendEvent.updateOne).not.toHaveBeenCalled();
  });

  it('ignora cotação que não é da sessão de hoje', async () => {
    const stale = [{ ticker: 'TRXF11', previousClose: 78.37, marketTime: new Date(`${yesterdayBr}T17:00:00.000-03:00`) }];
    expect(await marketDataService.detectExDateDividends(stale, assetMap)).toBe(0);
    expect(AssetHistory.aggregate).not.toHaveBeenCalled();
  });

  it('não consulta proventos quando nenhum gap sobrevive às travas', async () => {
    const noGap = [{ ticker: 'TRXF11', previousClose: 79.30, marketTime: nowInSession }];
    expect(await marketDataService.detectExDateDividends(noGap, assetMap)).toBe(0);
    expect(DividendEvent.find).not.toHaveBeenCalled();
  });

  it('nunca propaga erro para o sync de cotações', async () => {
    AssetHistory.aggregate.mockRejectedValue(new Error('mongo caiu'));
    await expect(marketDataService.detectExDateDividends(quotes, assetMap)).resolves.toBe(0);
  });
});

// ---------------------------------------------------------------------------

vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));

const { externalMarketService } = await import('../services/externalMarketService.js');
const { financialService } = await import('../services/financialService.js');

const utc = (iso) => new Date(`${iso}T00:00:00.000Z`);

describe('syncDividends — reconciliação do provisório', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    DividendEvent.updateOne.mockResolvedValue({ upsertedCount: 1 });
    DividendEvent.deleteMany.mockResolvedValue({ deletedCount: 0 });
    DividendEvent.find.mockReturnValue(chain([]));
  });

  it('promove o provisório a oficial quando a data-ex coincide', async () => {
    externalMarketService.getDividendsHistory.mockResolvedValue([{ date: utc('2026-09-01'), amount: 0.94 }]);
    await financialService.syncDividends([{ ticker: 'TRXF11', type: 'FII' }]);

    const [filter, update] = DividendEvent.updateOne.mock.calls[0];
    expect(filter.date.toISOString().slice(0, 10)).toBe('2026-09-01');
    // O índice único {ticker,date,type} colapsa os dois no MESMO documento:
    // o valor da fonte prevalece e a procedência deixa de ser provisória.
    expect(update.$set.amount).toBe(0.94);
    expect(update.$set.source).toBe('PROVIDER');
    expect(DividendEvent.deleteMany).not.toHaveBeenCalled();
  });

  it('remove o provisório quando o oficial sai com a data deslocada', async () => {
    externalMarketService.getDividendsHistory.mockResolvedValue([{ date: utc('2026-09-02'), amount: 0.94 }]);
    DividendEvent.find.mockReturnValue(chain([{ _id: 'prov1', date: utc('2026-09-01') }]));

    await financialService.syncDividends([{ ticker: 'TRXF11', type: 'FII' }]);

    // Sem isto o mesmo pagamento existiria em 01/09 e 02/09 — contado duas vezes.
    expect(DividendEvent.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['prov1'] } });
  });

  it('preserva o provisório que a fonte nunca publicou', async () => {
    externalMarketService.getDividendsHistory.mockResolvedValue([{ date: utc('2026-08-03'), amount: 0.93 }]);
    DividendEvent.find.mockReturnValue(chain([{ _id: 'prov1', date: utc('2026-09-01') }]));

    await financialService.syncDividends([{ ticker: 'TRXF11', type: 'FII' }]);

    // 29 dias de distância: pagamento diferente, e é renda real do usuário.
    expect(DividendEvent.deleteMany).not.toHaveBeenCalled();
  });

  it('a janela de reconciliação cobre o atraso observado da fonte (1-3 dias)', () => {
    expect(DERIVED_RECONCILE_WINDOW_MS / 86400000).toBeGreaterThanOrEqual(3);
  });
});
