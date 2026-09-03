/**
 * Varredura de lacuna pelo arquivo oficial da B3.
 *
 * O caminho do snapshot só enxerga a PONTA da série. Quando as duas fontes
 * falham no dia D e o candle de D+1 chega normalmente, a ponta se fecha com o
 * buraco de D dentro dela — foi assim que 27 e 28/08/2026 viraram cicatriz
 * permanente e que 02/09 repetiu a dose com BOVA11 e IVVB11.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  find: vi.fn(),
  updateOne: vi.fn(),
  fetchB3: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../models/AssetHistory.js', () => ({
  default: { aggregate: mocks.aggregate, find: mocks.find, updateOne: mocks.updateOne },
}));
vi.mock('../services/b3DailyFileService.js', () => ({ fetchB3DailyCloses: mocks.fetchB3 }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: { getFullHistoryDetailed: vi.fn() } }));
vi.mock('../config/logger.js', () => ({
  default: { info: mocks.loggerInfo, warn: mocks.loggerWarn, error: vi.fn(), debug: vi.fn() },
}));

const { healWalletCandleGaps } = await import('../services/walletDayCandleService.js');

const CARTEIRA = [
  { ticker: 'BOVA11', type: 'ETF', quantity: 7 },
  { ticker: 'IVVB11', type: 'ETF', quantity: 2 },
];
// Janela útil que termina em 03/09/2026: 28/08 (sex), 31/08, 01/09, 02/09, 03/09.
const SERIE_CHEIA = ['2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'];
const semODia02 = SERIE_CHEIA.filter((d) => d !== '2026-09-02');

const wireFind = (docs) => mocks.find.mockReturnValue({ lean: async () => docs });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateOne.mockResolvedValue({});
  wireFind([]);
});

describe('healWalletCandleGaps', () => {
  it('sem lacuna, não toca a rede nem regrava a série', async () => {
    mocks.aggregate.mockResolvedValue([
      { ticker: 'BOVA11', dates: SERIE_CHEIA },
      { ticker: 'IVVB11', dates: SERIE_CHEIA },
    ]);

    const recuperados = await healWalletCandleGaps(CARTEIRA, '2026-09-03');

    expect(recuperados.size).toBe(0);
    expect(mocks.fetchB3).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it('preenche o buraco do meio com o fechamento oficial e mescla na série guardada', async () => {
    mocks.aggregate.mockResolvedValue([
      { ticker: 'BOVA11', dates: semODia02 },
      { ticker: 'IVVB11', dates: SERIE_CHEIA },
    ]);
    wireFind([{ ticker: 'BOVA11', history: [{ date: '2026-09-01', close: 177.1 }, { date: '2026-09-03', close: 182.11 }] }]);
    mocks.fetchB3.mockResolvedValue(new Map([['BOVA11', { close: 182.27, volume: 1000 }]]));

    const recuperados = await healWalletCandleGaps(CARTEIRA, '2026-09-03');

    expect(mocks.fetchB3).toHaveBeenCalledTimes(1);
    expect(mocks.fetchB3).toHaveBeenCalledWith('2026-09-02');
    expect(recuperados.get('BOVA11')).toEqual(['2026-09-02']);
    const [filtro, update] = mocks.updateOne.mock.calls[0];
    expect(filtro).toEqual({ ticker: 'BOVA11' });
    // Mescla, nunca substitui: o candle recuperado entra ORDENADO no meio.
    expect(update.$set.history.map((c) => c.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(update.$set.history[1].close).toBe(182.27);
  });

  it('ticker ausente do arquivo é dia sem negócio — não inventa candle', async () => {
    mocks.aggregate.mockResolvedValue([{ ticker: 'BOVA11', dates: semODia02 }]);
    wireFind([{ ticker: 'BOVA11', history: [{ date: '2026-09-01', close: 177.1 }] }]);
    mocks.fetchB3.mockResolvedValue(new Map([['PETR4', { close: 48.2, volume: 10 }]]));

    const recuperados = await healWalletCandleGaps(CARTEIRA, '2026-09-03');

    expect(recuperados.size).toBe(0);
    expect(mocks.updateOne).not.toHaveBeenCalled();
    // Silêncio aqui foi o que custou o diagnóstico de 03/09: "lacuna sem
    // cobertura" tem de ser distinguível de "não havia lacuna".
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('sem cobertura'),
      expect.objectContaining({ throughDay: '2026-09-03' }),
    );
  });

  it('B3 fora do ar não derruba a passagem', async () => {
    mocks.aggregate.mockResolvedValue([{ ticker: 'BOVA11', dates: semODia02 }]);
    wireFind([{ ticker: 'BOVA11', history: [{ date: '2026-09-01', close: 177.1 }] }]);
    mocks.fetchB3.mockResolvedValue(null);

    await expect(healWalletCandleGaps(CARTEIRA, '2026-09-03')).resolves.toEqual(new Map());
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it('só pergunta pelo que o arquivo da B3 cobre — cripto e ativo americano ficam fora', async () => {
    const recuperados = await healWalletCandleGaps(
      [{ ticker: 'BTC', type: 'CRYPTO', quantity: 1 }, { ticker: 'VOO', type: 'ETF', quantity: 3 }],
      '2026-09-03',
    );

    expect(recuperados.size).toBe(0);
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });

  it('dia sem pregão não abre janela', async () => {
    await healWalletCandleGaps(CARTEIRA, '2026-09-05'); // sábado
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });

  it('posição zerada não pesa no patrimônio e não vira busca', async () => {
    await healWalletCandleGaps([{ ticker: 'BOVA11', type: 'ETF', quantity: 0 }], '2026-09-03');
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });
});
