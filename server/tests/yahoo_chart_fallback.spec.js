/**
 * O CANDLE DO YAHOO COMO SEGUNDA TENTATIVA DA CADEIA DE COTAÇÃO.
 *
 * Entrou em 04/09/2026 entre a cotação do Yahoo e o scraping do Google: é o mesmo
 * provedor por outro endpoint, e os dois não falham juntos. O que se testa aqui
 * não é "chegou preço" — é que o preço chega DATADO e com variação de verdade.
 *
 * A variação é o ponto delicado. `change` é gravado direto no ativo, e a tela não
 * distingue "não sei" de "não mexeu": um zero de conveniência apaga da lista de
 * altas e baixas do dia um papel que andou.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { externalMarketService } from '../services/externalMarketService.js';

const yahoo = vi.hoisted(() => ({ chart: vi.fn(), quote: vi.fn() }));

vi.mock('yahoo-finance2', () => ({
  default: class {
    chart(...args) { return yahoo.chart(...args); }
    quote(...args) { return yahoo.quote(...args); }
  },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/errorLogService.js', () => ({ recordIngestionError: vi.fn() }));

const candle = (date, close, volume = 1000) => ({ date: new Date(date), close, volume });

beforeEach(() => vi.clearAllMocks());

describe('fetchFromYahooChart', () => {
  it('a variação vem dos dois últimos candles, não de zero', async () => {
    yahoo.chart.mockResolvedValue({
      quotes: [candle('2026-09-02', 100), candle('2026-09-03', 110)],
    });

    const r = await externalMarketService.fetchFromYahooChart('EQR');

    expect(r.price).toBe(110);
    expect(r.previousClose).toBe(100);
    expect(r.change).toBeCloseTo(10, 6);
  });

  // Sem base de comparação não há variação a informar — e 0 é exatamente o que o
  // consumidor (`quote.change || 0`) faria com o campo ausente.
  it('candle único devolve variação 0 sem inventar fechamento anterior', async () => {
    yahoo.chart.mockResolvedValue({ quotes: [candle('2026-09-03', 110)] });

    const r = await externalMarketService.fetchFromYahooChart('EQR');

    expect(r.change).toBe(0);
    expect(r.previousClose).toBeNull();
  });

  // Candle sem fechamento (o buraco que o Yahoo abre nos ETFs da B3) não pode
  // virar preço zero: ele é descartado, e o candle bom anterior é que responde.
  it('descarta candle sem fechamento e usa o último válido', async () => {
    yahoo.chart.mockResolvedValue({
      quotes: [candle('2026-09-02', 100), candle('2026-09-03', 110), { date: new Date('2026-09-04'), close: null }],
    });

    const r = await externalMarketService.fetchFromYahooChart('BOVA11');

    expect(r.price).toBe(110);
    expect(r.marketTime).toEqual(new Date('2026-09-03'));
  });

  // Janela vazia é resposta legítima: o papel simplesmente não negocia há mais de
  // 10 dias (EA e EQR desde agosto). Devolver o último fechamento conhecido de
  // qualquer idade seria servir preço velho como preço de hoje.
  it('janela sem candle nenhum devolve null', async () => {
    yahoo.chart.mockResolvedValue({ quotes: [] });

    expect(await externalMarketService.fetchFromYahooChart('EA')).toBeNull();
  });

  it('erro da fonte devolve null em vez de estourar na cadeia', async () => {
    yahoo.chart.mockRejectedValue(new Error('fetch failed'));

    expect(await externalMarketService.fetchFromYahooChart('EQR')).toBeNull();
  });

  // Papel da B3 precisa do sufixo .SA; papel estrangeiro NÃO pode recebê-lo, ou o
  // Yahoo procura o ticker na bolsa errada e devolve vazio.
  it('sufixa .SA só para ticker da B3', async () => {
    yahoo.chart.mockResolvedValue({ quotes: [candle('2026-09-03', 30)] });

    await externalMarketService.fetchFromYahooChart('PETR4');
    expect(yahoo.chart.mock.calls[0][0]).toBe('PETR4.SA');

    await externalMarketService.fetchFromYahooChart('AVB');
    expect(yahoo.chart.mock.calls[1][0]).toBe('AVB');
  });
});
