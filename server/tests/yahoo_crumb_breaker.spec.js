/**
 * O 429 DO CRUMB NÃO PODE DERRUBAR O CANDLE JUNTO.
 *
 * A cadeia de cotação promete, nesta ordem: cotação do Yahoo (v7) → candle do
 * Yahoo (v8) → Google → Brapi. Os dois primeiros são o mesmo provedor por
 * caminhos diferentes, e a diferença que importa é o crumb: o `quote` busca
 * cookie + crumb em `/v1/test/getcrumb` antes de responder, o `chart` não pede
 * nada. É o endpoint de crumb que a Yahoo rate-limita por IP de datacenter — e
 * foi por isso que o candle entrou na cadeia como segundo elo.
 *
 * Enquanto os dois compartilhavam um circuit breaker, o arranjo se anulava
 * sozinho. Medido em 09/09/2026 no painel de fontes: 15 chamadas de cotação, 15
 * falhas, todas "Failed to get crumb, status 429", e 194 ativos descendo a
 * cadeia. Só que o lote falhava 4 vezes, o circuito abria, e o protocolo de
 * emergência então chamava o candle dos 194 com o circuito JÁ ABERTO: cada um
 * levava `ERR_CIRCUIT_OPEN` sem que uma requisição fosse feita. O segundo elo
 * ficava fora do ar exatamente no minuto em que o primeiro caía.
 *
 * O prejuízo não é ficar sem preço — o Google atende. É o que o Google NÃO traz:
 * volume (que é quem separa papel vivo de papel morto) e variação de verdade.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEscalations, resetSourceStats } from '../utils/sourceHealth.js';

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

// A mensagem exata que a yahoo-finance2 lança quando o endpoint de crumb responde 429.
const crumb429 = () => Promise.reject(new Error('Failed to get crumb, status 429'));
const candles = {
  quotes: [
    { date: new Date('2026-09-08T21:00:00Z'), close: 100, volume: 5_000 },
    { date: new Date('2026-09-09T21:00:00Z'), close: 110, volume: 6_000 },
  ],
};

// Acima do `failureThreshold: 4` do breaker: se o circuito for compartilhado, as
// últimas passagens já encontram o candle bloqueado.
const CICLOS = 6;

beforeEach(() => {
  vi.clearAllMocks();
  resetSourceStats();
});

describe('cotação em 429 de crumb', () => {
  it('o candle continua atendendo depois de o lote falhar vezes suficientes para abrir o circuito', async () => {
    yahoo.quote.mockImplementation(crumb429);
    yahoo.chart.mockResolvedValue(candles);

    const ultimos = [];
    for (let i = 0; i < CICLOS; i++) {
      ultimos.push(await externalMarketService.getQuotes(['VALE3']));
    }

    // Todos os ciclos — inclusive os posteriores à abertura do circuito de cotação.
    for (const res of ultimos) {
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ ticker: 'VALE3', price: 110, source: 'YAHOO_CHART_FALLBACK' });
    }
    expect(yahoo.chart).toHaveBeenCalledTimes(CICLOS);
  });

  it('o candle entrega o que o scraping não tem: volume e variação', async () => {
    yahoo.quote.mockImplementation(crumb429);
    yahoo.chart.mockResolvedValue(candles);

    const [cotacao] = await externalMarketService.getQuotes(['VALE3']);

    expect(cotacao.volume).toBe(6_000);
    expect(cotacao.change).toBeCloseTo(10, 6);
    expect(cotacao.marketTime).toEqual(candles.quotes[1].date);
  });

  it('a escalada registra o candle como quem resolveu, não o Google', async () => {
    yahoo.quote.mockImplementation(crumb429);
    yahoo.chart.mockResolvedValue(candles);

    await externalMarketService.getQuotes(['VALE3']);

    expect(getEscalations()).toContainEqual(
      expect.objectContaining({ subject: 'VALE3', resolvedBy: 'yahoo.chart' }),
    );
  });

  it('mas o candle mantém o circuito DELE: caindo também, para de ser chamado', async () => {
    yahoo.quote.mockImplementation(crumb429);
    yahoo.chart.mockRejectedValue(new Error('query1 fora do ar'));
    const google = vi.spyOn(externalMarketService, 'fetchFromGoogleFinance')
      .mockResolvedValue({ ticker: 'VALE3', price: 60, change: 0, source: 'GOOGLE_FINANCE_FALLBACK' });

    for (let i = 0; i < CICLOS; i++) {
      await externalMarketService.getQuotes(['VALE3']);
    }

    // Abre no 4º e passa a falhar rápido: o breaker do candle é o que impede
    // martelar o endpoint quando é ELE que está fora.
    expect(yahoo.chart).toHaveBeenCalledTimes(4);
    expect(google).toHaveBeenCalledTimes(CICLOS);
    google.mockRestore();
  });
});
