/**
 * A ÚLTIMA ESCRITA DE SÉRIE QUE AINDA SUBSTITUÍA.
 *
 * `getBenchmarkHistory` tem nome de coadjuvante e é o carregador de série de
 * `financialService._loadPriceCacheMap` — ou seja, roda para TODO ticker em
 * carteira a cada rebuild, além do motor da Carteira Recomendada. E até
 * 06/09/2026 era a única escrita de `AssetHistory` do sistema que fazia
 * `historyEntry.history = o que a fonte devolveu`: o worker, o caminho da
 * carteira e o reparo de cripto já mesclavam.
 *
 * Substituir transforma degradação passageira da fonte em perda permanente — foi
 * assim que o HSRE11 perdeu 623 candles quando o Yahoo passou a devolver um só.
 * Neste caminho o dano é pior: o rebuild exige que a série alcance o primeiro dia
 * da posição, e série encurtada faz ele marcar todo o período anterior pelo preço
 * de compra, produzindo TWRR e Sharpe falsos sem erro nenhum na tela.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: { findOne: vi.fn(), create: vi.fn() } }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/FundamentalSnapshot.js', () => ({ default: {} }));
vi.mock('../models/DividendEvent.js', () => ({ default: {} }));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getFullHistory: vi.fn() },
}));
vi.mock('../services/configService.js', () => ({ getTunablesSync: () => ({ marketCacheMinutes: 15 }) }));

const AssetHistory = (await import('../models/AssetHistory.js')).default;
const { externalMarketService } = await import('../services/externalMarketService.js');
const { marketDataService } = await import('../services/marketDataService.js');

const candle = (date, close) => ({ date, close, adjClose: close, volume: 100 });

/** Doc guardado com cache VENCIDO (>12h), que é quando a re-busca acontece. */
const guardado = (history) => {
  const doc = { ticker: 'X', history, lastUpdated: new Date(Date.now() - 24 * 3600 * 1000), save: vi.fn() };
  doc.save.mockImplementation(async () => doc);
  return doc;
};

beforeEach(() => {
  vi.clearAllMocks();
  AssetHistory.create.mockImplementation(async (doc) => doc);
});

describe('getBenchmarkHistory — grava mesclando', () => {
  it('fonte degradada NÃO apaga a série guardada (o caso HSRE11)', async () => {
    const antiga = [candle('2026-08-26', 10), candle('2026-08-27', 11), candle('2026-08-28', 12)];
    const doc = guardado(antiga);
    AssetHistory.findOne.mockResolvedValue(doc);
    // A degradação: a fonte devolve UM candle onde havia três.
    externalMarketService.getFullHistory.mockResolvedValue([candle('2026-08-28', 12)]);

    const out = await marketDataService.getBenchmarkHistory('HSRE11', 'FII');

    expect(out).toHaveLength(3);
    expect(out.map((c) => c.date)).toEqual(['2026-08-26', '2026-08-27', '2026-08-28']);
  });

  it('candle novo entra e revisão da fonte vence na mesma data', async () => {
    const doc = guardado([candle('2026-08-27', 11), candle('2026-08-28', 12)]);
    AssetHistory.findOne.mockResolvedValue(doc);
    externalMarketService.getFullHistory.mockResolvedValue([
      candle('2026-08-28', 12.5), // remarcado pela fonte
      candle('2026-08-31', 13),   // dia novo
    ]);

    const out = await marketDataService.getBenchmarkHistory('PETR4', 'STOCK');

    expect(out.map((c) => c.date)).toEqual(['2026-08-27', '2026-08-28', '2026-08-31']);
    expect(out.find((c) => c.date === '2026-08-28').close).toBe(12.5);
  });

  it('não impõe o cap do worker — a profundidade do rebuild fica de pé', async () => {
    // 1.664 candles é a profundidade real dos tickers em carteira (desde 2020).
    const funda = Array.from({ length: 1664 }, (_, i) => candle(
      new Date(Date.UTC(2020, 0, 2) + i * 86400000).toISOString().slice(0, 10), 10 + i,
    ));
    const doc = guardado([]);
    AssetHistory.findOne.mockResolvedValue(doc);
    externalMarketService.getFullHistory.mockResolvedValue(funda);

    const out = await marketDataService.getBenchmarkHistory('ITSA4', 'STOCK');

    // Sem o cap de 400 do timeSeriesWorker: quem sobrevive é a série inteira.
    expect(out.length).toBeGreaterThan(1000);
  });

  it('recusa candle de sábado numa classe de pregão — ele congelaria a série', async () => {
    const doc = guardado([candle('2026-09-04', 12)]); // sexta
    AssetHistory.findOne.mockResolvedValue(doc);
    externalMarketService.getFullHistory.mockResolvedValue([
      candle('2026-09-04', 12),
      candle('2026-09-05', 12), // sábado — a barra "viva" de ticker sem negócio
    ]);

    const out = await marketDataService.getBenchmarkHistory('BTLG11', 'FII');

    expect(out.map((c) => c.date)).toEqual(['2026-09-04']);
  });

  it('cripto mantém o fim de semana — negocia 7 dias', async () => {
    const doc = guardado([candle('2026-09-04', 100)]);
    AssetHistory.findOne.mockResolvedValue(doc);
    externalMarketService.getFullHistory.mockResolvedValue([
      candle('2026-09-05', 101),
      candle('2026-09-06', 102),
    ]);

    const out = await marketDataService.getBenchmarkHistory('BTC', 'CRYPTO');

    expect(out.map((c) => c.date)).toEqual(['2026-09-04', '2026-09-05', '2026-09-06']);
  });

  it('série nova nasce filtrada pela mesma régua', async () => {
    AssetHistory.findOne.mockResolvedValue(null);
    externalMarketService.getFullHistory.mockResolvedValue([
      candle('2026-09-04', 12),
      candle('2026-09-06', 12), // domingo
    ]);

    const out = await marketDataService.getBenchmarkHistory('BOVA11', 'ETF');

    expect(out.map((c) => c.date)).toEqual(['2026-09-04']);
  });

  it('fonte muda para NADA e a série guardada continua servida', async () => {
    const doc = guardado([candle('2026-08-28', 12)]);
    AssetHistory.findOne.mockResolvedValue(doc);
    externalMarketService.getFullHistory.mockResolvedValue([]);

    const out = await marketDataService.getBenchmarkHistory('HSRE11', 'FII');

    expect(out).toHaveLength(1);
    expect(doc.save).not.toHaveBeenCalled();
  });
});
