/**
 * ÍNDICES: A ÚLTIMA CHAMADA COM CRUMB QUE NÃO TINHA RESERVA.
 *
 * Em 09/09/2026 o painel de fontes mostrou três cards vermelhos ao mesmo tempo —
 * Yahoo cotações, Yahoo câmbio, Yahoo índices — e verdes os três do mesmo
 * provedor logo ao lado: candle, histórico e barras horárias. A correlação é
 * exata e tem nome: os três que caíram usam o `quote` (v7), que exige buscar
 * cookie + crumb em `/v1/test/getcrumb`; os três que ficaram de pé usam o
 * `chart` (v8), que não pede crumb nenhum. O 429 era do crumb, não do Yahoo.
 *
 * Cotação tinha o candle atrás; câmbio tinha Coinbase e PTAX. Os índices não
 * tinham ninguém: o `catch` devolvia `{}` e `performMacroSync` simplesmente não
 * escrevia `ibov`/`spx`. A barra do topo seguia exibindo o número da última vez
 * que deu certo, sem nada na tela dizendo que era velho.
 *
 * O que se cobra aqui: o índice sobrevive à queda da cotação ao vivo, e quem o
 * salvou fica registrado — porque "veio do candle" significa fechamento anterior,
 * não valor de agora, e essa diferença tem que chegar ao painel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const yahoo = vi.hoisted(() => ({ quote: vi.fn(), chart: vi.fn() }));

vi.mock('yahoo-finance2', () => ({
  default: class {
    quote(...args) { return yahoo.quote(...args); }
    chart(...args) { return yahoo.chart(...args); }
  },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/errorLogService.js', () => ({ recordIngestionError: vi.fn() }));

const { externalMarketService } = await import('../services/externalMarketService.js');

const crumb429 = () => Promise.reject(new Error('Failed to get crumb, status 429'));

const aoVivo = (symbol, price, change) => ({
  symbol, regularMarketPrice: price, regularMarketChangePercent: change,
});
// O `chart` responde por símbolo, então o mock decide pelo argumento.
const candlesPorSimbolo = {
  '^BVSP': { quotes: [{ date: new Date('2026-09-07'), close: 185000 }, { date: new Date('2026-09-08'), close: 187367 }] },
  '^GSPC': { quotes: [{ date: new Date('2026-09-08'), close: 7600 }, { date: new Date('2026-09-09'), close: 7644.35 }] },
};

beforeEach(() => {
  vi.clearAllMocks();
  yahoo.chart.mockImplementation((symbol) => Promise.resolve(candlesPorSimbolo[symbol] || { quotes: [] }));
});

describe('getGlobalIndices', () => {
  it('cotação ao vivo respondendo: o candle não é chamado', async () => {
    yahoo.quote.mockResolvedValue([aoVivo('^BVSP', 185546.8, -0.97), aoVivo('^GSPC', 7645.22, -0.36)]);

    const r = await externalMarketService.getGlobalIndices();

    expect(r.ibov).toMatchObject({ value: 185546.8, change: -0.97, source: 'Yahoo' });
    expect(r.spx).toMatchObject({ value: 7645.22, source: 'Yahoo' });
    expect(yahoo.chart).not.toHaveBeenCalled();
  });

  it('429 no crumb: o candle segura os dois índices', async () => {
    yahoo.quote.mockImplementation(crumb429);

    const r = await externalMarketService.getGlobalIndices();

    expect(r.ibov).toMatchObject({ value: 187367, source: 'Yahoo (candle)' });
    expect(r.spx).toMatchObject({ value: 7644.35, source: 'Yahoo (candle)' });
    // Variação contra o fechamento anterior, não zero de conveniência.
    expect(r.ibov.change).toBeCloseTo(1.2795, 3);
  });

  /**
   * O caso que passava despercebido: a chamada VOLTA, sem exceção nenhuma, e traz
   * só metade. Sem tratar isto, o índice ausente ficava congelado do mesmo jeito
   * — só que sem um 429 para culpar.
   */
  it('resposta pela metade também aciona a reserva, e o vivo tem precedência', async () => {
    yahoo.quote.mockResolvedValue([aoVivo('^GSPC', 7645.22, -0.36)]);

    const r = await externalMarketService.getGlobalIndices();

    expect(r.spx).toMatchObject({ value: 7645.22, source: 'Yahoo' });        // veio da principal
    expect(r.ibov).toMatchObject({ value: 187367, source: 'Yahoo (candle)' }); // e do candle
  });

  it('as duas fontes fora: devolve vazio, e vazio preserva o valor gravado', async () => {
    yahoo.quote.mockImplementation(crumb429);
    yahoo.chart.mockRejectedValue(new Error('query1 fora do ar'));

    // `{}` e não `null`: quem chama espalha o resultado, e `performMacroSync`
    // trata a ausência de cada índice preservando o anterior.
    await expect(externalMarketService.getGlobalIndices()).resolves.toEqual({});
  });

  it('candle sem fechamento utilizável não vira índice zero', async () => {
    yahoo.quote.mockImplementation(crumb429);
    yahoo.chart.mockResolvedValue({ quotes: [{ date: new Date('2026-09-09'), close: null }] });

    expect(await externalMarketService.getGlobalIndices()).toEqual({});
  });
});
