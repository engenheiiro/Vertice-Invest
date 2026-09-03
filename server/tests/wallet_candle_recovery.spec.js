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
  healGaps: vi.fn(),
  rebuildUserHistory: vi.fn(),
  loadTreasuryPricing: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { aggregate: mocks.historyAggregate } }));
vi.mock('../services/treasuryPriceService.js', () => ({
  loadTreasuryPricing: mocks.loadTreasuryPricing,
}));
vi.mock('../services/walletDayCandleService.js', () => ({
  ensureWalletDayCandles: mocks.ensureDayCandles,
  healWalletCandleGaps: mocks.healGaps,
}));
vi.mock('../services/financialService.js', () => ({
  financialService: { rebuildUserHistory: mocks.rebuildUserHistory },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: mocks.loggerInfo, error: mocks.loggerError, warn: vi.fn(), debug: vi.fn() },
}));

const {
  previousBusinessDayKey,
  previousDayKey,
  reconcilePreviousWalletSnapshot,
  reconcileTreasurySnapshot,
} = await import('../services/walletCandleRecoveryService.js');

const wireHoldings = (rows) => {
  mocks.userAssetFind.mockReturnValue({
    select: () => ({ lean: async () => rows }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.historyAggregate.mockResolvedValue([]);
  mocks.ensureDayCandles.mockResolvedValue(new Map());
  mocks.healGaps.mockResolvedValue(new Map());
  mocks.rebuildUserHistory.mockResolvedValue([]);
  mocks.loadTreasuryPricing.mockResolvedValue({ historyFor: () => null });
});

describe('walletCandleRecoveryService', () => {
  it('calcula o dia civil anterior em virada de mês', () => {
    expect(previousDayKey('2026-09-01')).toBe('2026-08-31');
  });

  it('o alvo é o último dia ÚTIL, não o dia civil anterior', () => {
    // Segunda-feira: o dia civil anterior é domingo, que não tem pregão nem
    // snapshot. Antes disso a rotina saía SKIPPED e um fechamento de sexta
    // publicado tarde (28/08/2026) nunca ganhava segunda chance.
    expect(previousDayKey('2026-08-31')).toBe('2026-08-30');
    expect(previousBusinessDayKey('2026-08-31')).toBe('2026-08-28');
  });

  it('na segunda-feira reconcilia a SEXTA', async () => {
    wireHoldings([{ ticker: 'BOVA11', type: 'ETF', quantity: 10, user: 'u1', wallet: 'w1' }]);

    await reconcilePreviousWalletSnapshot({ now: new Date('2026-08-31T12:00:00.000Z') });

    expect(mocks.ensureDayCandles).toHaveBeenCalledWith(
      expect.any(Array), '2026-08-28', expect.any(Map),
    );
  });

  it('fecha buraco ANTIGO da janela e reconstrói, mesmo sem candle novo na ponta', async () => {
    // O caso de 02/09/2026: as duas fontes falharam no dia, o candle do dia
    // seguinte entrou por cima e a lacuna sumiu do radar da ponta. Sem a
    // varredura, o buraco vira permanente e o TWRR fica marcado no preço errado.
    wireHoldings([{ ticker: 'IVVB11', type: 'ETF', quantity: 2, user: 'u1', wallet: 'w1' }]);
    mocks.ensureDayCandles.mockResolvedValue(new Map());
    mocks.healGaps.mockResolvedValue(new Map([['IVVB11', ['2026-09-02']]]));

    const result = await reconcilePreviousWalletSnapshot({ targetDay: '2026-09-03' });

    expect(mocks.healGaps).toHaveBeenCalledWith(expect.any(Array), '2026-09-03');
    expect(mocks.rebuildUserHistory).toHaveBeenCalledWith('u1', 'w1', {
      throughDayKey: '2026-09-03',
      source: 'REBUILD',
    });
    expect(result).toMatchObject({ status: 'SUCCESS', recovered: 0, healed: 1, rebuilt: 1 });
    expect(result.tickers).toEqual(['IVVB11']);
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

/**
 * Reconciliação do PU do Tesouro.
 *
 * O Tesouro publica o PU da Data Base do dia D só no dia D+1, e a ingestão roda
 * 12:30. O snapshot das 23:59 do dia D nunca enxerga o PU do próprio dia — marca
 * o título pelo de D-1 — enquanto o rebuild e a âncora do KPI ao vivo, rodando
 * depois, resolvem o PU de D. Medido em 31/08/2026: R$ 838,01 pelo PU de 28/08
 * contra R$ 836,24 pelo de 31/08, num único dia.
 */
describe('reconcileTreasurySnapshot', () => {
  const serie = [
    { date: '2026-08-27', pu: 2982.24 },
    { date: '2026-08-28', pu: 2994.37 },
    { date: '2026-08-31', pu: 2987.92 },
  ];
  const tesouro = { ticker: 'TESOURO IPCA+ 2032', type: 'FIXED_INCOME', quantity: 1, user: 'u1', wallet: 'w1' };

  it('reconstrói a carteira quando o PU do dia finalmente chega', async () => {
    wireHoldings([tesouro]);
    mocks.loadTreasuryPricing.mockResolvedValue({ historyFor: () => serie });

    const result = await reconcileTreasurySnapshot({ targetDay: '2026-08-31' });

    expect(mocks.rebuildUserHistory).toHaveBeenCalledWith('u1', 'w1', {
      throughDayKey: '2026-08-31',
      source: 'REBUILD',
    });
    expect(result).toMatchObject({ status: 'SUCCESS', resolved: 1, rebuilt: 1, failed: 0 });
  });

  it('não reconstrói enquanto o PU do dia não existe — só há o ponto anterior', async () => {
    wireHoldings([tesouro]);
    // Série parada em 28/08: é exatamente o PU que o snapshot de 31/08 já usou.
    mocks.loadTreasuryPricing.mockResolvedValue({ historyFor: () => serie.slice(0, 2) });

    const result = await reconcileTreasurySnapshot({ targetDay: '2026-08-31' });

    expect(mocks.rebuildUserHistory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'SUCCESS', resolved: 0, rebuilt: 0 });
  });

  it('ignora renda fixa sem série de PU (fica na curva, não é marcável)', async () => {
    wireHoldings([{ ticker: 'PÓS-FIXADO', type: 'FIXED_INCOME', quantity: 1, user: 'u1', wallet: 'w1' }]);
    mocks.loadTreasuryPricing.mockResolvedValue({ historyFor: () => null });

    const result = await reconcileTreasurySnapshot({ targetDay: '2026-08-31' });

    expect(mocks.rebuildUserHistory).not.toHaveBeenCalled();
    expect(result.resolved).toBe(0);
  });

  it('reconstrói cada carteira uma vez, mesmo com dois títulos marcáveis', async () => {
    wireHoldings([
      tesouro,
      { ticker: 'TESOURO PREFIXADO 2032', type: 'FIXED_INCOME', quantity: 1, user: 'u1', wallet: 'w1' },
      { ticker: 'TESOURO IPCA+ 2032', type: 'FIXED_INCOME', quantity: 1, user: 'u2', wallet: 'w2' },
    ]);
    mocks.loadTreasuryPricing.mockResolvedValue({ historyFor: () => serie });

    const result = await reconcileTreasurySnapshot({ targetDay: '2026-08-31' });

    expect(mocks.rebuildUserHistory).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ rebuilt: 2, resolved: 2 });
  });

  it('em dia sem pregão não consulta posição nem reconstrói', async () => {
    wireHoldings([tesouro]);

    const result = await reconcileTreasurySnapshot({ targetDay: '2026-08-30' }); // domingo

    expect(result.status).toBe('SKIPPED');
    expect(mocks.userAssetFind).not.toHaveBeenCalled();
    expect(mocks.rebuildUserHistory).not.toHaveBeenCalled();
  });

  it('uma carteira quebrada não impede a reconstrução das outras', async () => {
    wireHoldings([
      tesouro,
      { ticker: 'TESOURO IPCA+ 2032', type: 'FIXED_INCOME', quantity: 1, user: 'u2', wallet: 'w2' },
    ]);
    mocks.loadTreasuryPricing.mockResolvedValue({ historyFor: () => serie });
    mocks.rebuildUserHistory
      .mockRejectedValueOnce(new Error('histórico insuficiente'))
      .mockResolvedValueOnce([]);

    const result = await reconcileTreasurySnapshot({ targetDay: '2026-08-31' });

    expect(result).toMatchObject({ status: 'PARTIAL', rebuilt: 1, failed: 1 });
  });
});
