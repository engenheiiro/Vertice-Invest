/**
 * SIGLA DISPUTADA — o preço certo do ativo errado.
 *
 * A tradução "ticker do banco → símbolo do provedor" era concatenação: se o
 * ticker estivesse numa lista de cripto escrita à mão, virava `${ticker}-USD`.
 * Duas coisas quebram nisso, e as duas estavam quebradas em produção até
 * 05/09/2026:
 *
 *  1. **A lista não sabe o tipo do ativo.** `STX` é Stacks na cripto e Seagate na
 *     NASDAQ. A Seagate, ação do S&P 500, era perguntada como `STX-USD` e recebia
 *     o preço de "Stox", um token parado desde abril de 2025 — US$ 0,0028 no lugar
 *     de US$ 849,28, no ranking, sem erro nenhum no caminho.
 *  2. **Ticker de cripto não é único.** O Yahoo desempata sigla disputada com o id
 *     da CoinMarketCap e serve o impostor no símbolo curto: `TAO-USD` é "Together
 *     As One" (parado em 2022), e Bittensor mora em `TAO22974-USD`. Três dos
 *     impostores (Toncoin, Mantle, Arbitrum) NEGOCIAM hoje — nenhuma régua de
 *     frescor os pega, só o símbolo certo.
 *
 * E o símbolo certo tem volta: `TAO22974-USD` precisa virar `TAO` de novo, senão
 * o ativo conta como falha mesmo tendo vindo preço.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { externalMarketService } from '../services/externalMarketService.js';
import { CRYPTO_ASSETS, CRYPTO_TICKERS, cryptoYahooSymbol, isKnownCryptoTicker } from '../config/cryptoList.js';

const yahoo = vi.hoisted(() => ({ quote: vi.fn() }));
vi.mock('yahoo-finance2', () => ({
  default: class {
    quote(...args) { return yahoo.quote(...args); }
  },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/errorLogService.js', () => ({ recordIngestionError: vi.fn() }));

const simbolo = (ticker, type) => externalMarketService._providerSymbol(ticker, type);

beforeEach(() => vi.clearAllMocks());

describe('catálogo', () => {
  it('não tem ticker repetido', () => {
    expect(new Set(CRYPTO_TICKERS).size).toBe(CRYPTO_TICKERS.length);
  });

  it('toda moeda tem nome — é ele que a auditoria confronta com o provedor', () => {
    // Vários tokens se chamam mesmo como a sigla (BNB, XRP, USDC, OKB), então a
    // régua é "tem nome", não "nome diferente do ticker".
    expect(CRYPTO_ASSETS.filter((c) => !c.name)).toEqual([]);
  });

  it('override de símbolo que apenas repete o padrão é ruído — não existe', () => {
    const inutil = CRYPTO_ASSETS.filter((c) => c.yahoo && c.yahoo === `${c.ticker}-USD`);
    expect(inutil).toEqual([]);
  });

  it('sigla não disputada cai no sufixo padrão', () => {
    expect(cryptoYahooSymbol('BTC')).toBe('BTC-USD');
  });

  it('sigla disputada usa o desempate da CoinMarketCap', () => {
    expect(cryptoYahooSymbol('TAO')).toBe('TAO22974-USD');
    expect(cryptoYahooSymbol('ARB')).toBe('ARB11841-USD');
  });

  it('token renomeado entra pelo símbolo novo, não pelo antigo', () => {
    // MATIC→POL e RNDR→RENDER: os antigos estão congelados no provedor.
    expect(isKnownCryptoTicker('MATIC')).toBe(false);
    expect(isKnownCryptoTicker('RNDR')).toBe(false);
    expect(cryptoYahooSymbol('POL')).toBe('POL28321-USD');
    expect(cryptoYahooSymbol('RENDER')).toBe('RENDER-USD');
  });
});

describe('tradução ciente do tipo', () => {
  it('o caso Seagate: sigla de cripto num ativo que NÃO é cripto', () => {
    expect(simbolo('STX', 'STOCK_US')).toBe('STX');
    expect(simbolo('STX', 'CRYPTO')).toBe('STX4847-USD');
  });

  it('cripto fora do catálogo ainda recebe o sufixo padrão', () => {
    expect(simbolo('XPTO', 'CRYPTO')).toBe('XPTO-USD');
  });

  it('sem tipo, o catálogo é o palpite — melhor que a concatenação crua', () => {
    expect(simbolo('TAO', null)).toBe('TAO22974-USD');
  });

  it('não mexe no que já vem no formato do provedor', () => {
    expect(simbolo('BTC-USD', null)).toBe('BTC-USD');
  });

  it('B3 continua ganhando .SA e classe US continua virando hífen', () => {
    expect(simbolo('PETR4', 'STOCK')).toBe('PETR4.SA');
    expect(simbolo('BRK.B', 'STOCK_US')).toBe('BRK-B');
  });
});

describe('volta do símbolo para o nosso ticker', () => {
  it('o desempate da CoinMarketCap volta a ser o ticker do banco', async () => {
    yahoo.quote.mockResolvedValue([
      { symbol: 'TAO22974-USD', regularMarketPrice: 229.25, longName: 'Bittensor USD' },
    ]);
    const res = await externalMarketService.getQuotes(['TAO'], { typeByTicker: { TAO: 'CRYPTO' } });
    expect(yahoo.quote.mock.calls[0][0]).toEqual(['TAO22974-USD']);
    expect(res[0].ticker).toBe('TAO');
    expect(res[0].price).toBe(229.25);
  });

  it('preço que chegou não pode contar como falha (sem escalar para a reserva)', async () => {
    const reserva = vi.spyOn(externalMarketService, 'recoverQuote');
    yahoo.quote.mockResolvedValue([
      { symbol: 'ARB11841-USD', regularMarketPrice: 0.1311 },
    ]);
    await externalMarketService.getQuotes(['ARB'], { typeByTicker: { ARB: 'CRYPTO' } });
    expect(reserva).not.toHaveBeenCalled();
    reserva.mockRestore();
  });

  it('ação de classe segue voltando na forma canônica do banco', async () => {
    yahoo.quote.mockResolvedValue([{ symbol: 'BRK-B', regularMarketPrice: 480 }]);
    const res = await externalMarketService.getQuotes(['BRK.B'], { typeByTicker: { 'BRK.B': 'STOCK_US' } });
    expect(res[0].ticker).toBe('BRK.B');
  });
});
