/**
 * O warn de cotação é do RESULTADO da cadeia de fontes, não da primeira tentativa.
 *
 * Regressão de 30/08/2026: o serviço avisava assim que o Yahoo falhava, antes de
 * tentar Google/Brapi. Como o fallback recuperava a maioria segundos depois, o
 * relatório do sync:prod abria com três avisos por run (EA/AVB/EQR, NGRD3, HSRE11)
 * que já estavam resolvidos na linha seguinte — ruído que empurrava o veredito para
 * "SUCESSO COM AVISOS" sem existir nada a fazer a respeito.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import logger from '../config/logger.js';
import { externalMarketService } from '../services/externalMarketService.js';
import { getEscalations, resetSourceStats } from '../utils/sourceHealth.js';

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

const warnsMatching = (re) => logger.warn.mock.calls.filter(([msg]) => re.test(msg));

beforeEach(() => {
  vi.clearAllMocks();
  // Yahoo responde, mas sem preço → o ticker entra na fila do fallback.
  yahoo.quote.mockResolvedValue([{ symbol: 'NGRD3.SA', regularMarketPrice: 0 }]);
});

describe('getQuotes — aviso só para o que nenhuma fonte recuperou', () => {
  it('fallback recuperou: nada de warn, só debug', async () => {
    const spy = vi.spyOn(externalMarketService, 'recoverQuote')
      .mockResolvedValue({ ticker: 'NGRD3', price: 34.28, change: 0, source: 'GOOGLE_FINANCE_FALLBACK' });

    const res = await externalMarketService.getQuotes(['NGRD3']);

    expect(res.some((r) => r.ticker === 'NGRD3' && r.price === 34.28)).toBe(true);
    expect(warnsMatching(/Sem cotação em nenhuma fonte/)).toHaveLength(0);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Yahoo falhou'));
    spy.mockRestore();
  });

  it('nenhuma fonte recuperou: warn nomeando o ticker', async () => {
    const spy = vi.spyOn(externalMarketService, 'recoverQuote').mockResolvedValue(null);

    await externalMarketService.getQuotes(['NGRD3']);

    const warns = warnsMatching(/Sem cotação em nenhuma fonte/);
    expect(warns).toHaveLength(1);
    expect(warns[0][0]).toContain('NGRD3');
    spy.mockRestore();
  });
});

/**
 * O mesmo caminho, agora GRAVADO por ativo.
 *
 * O log conta o que aconteceu uma vez e some no scroll; o painel precisa
 * responder, horas depois, "quais ativos chegaram até a Brapi?". Sem o registro
 * por ticker, a única evidência era a contagem de chamadas — que não sabe de
 * ativo e confunde "24 papéis falhando" com "um papel morto tentado 24 vezes".
 */
describe('recoverQuote — registro do trajeto de cada ativo', () => {
  beforeEach(() => resetSourceStats());

  it('grava quem tentou e quem entregou quando a Brapi salva o ativo', async () => {
    vi.spyOn(externalMarketService, 'fetchFromGoogleFinance').mockResolvedValue(null);
    vi.spyOn(externalMarketService, 'fetchFromBrapi').mockResolvedValue({ ticker: 'PETR4', price: 38.1 });

    await externalMarketService.recoverQuote('PETR4');

    const [ev] = getEscalations();
    expect(ev.subject).toBe('PETR4');
    expect(ev.tried).toEqual(['yahoo.quotes', 'google.finance', 'brapi']);
    expect(ev.resolvedBy).toBe('brapi');
  });

  // O registro mais valioso do ledger: ativo que a cadeia inteira não precificou
  // carrega preço velho para a carteira do usuário.
  it('grava resolvedBy null quando nenhuma fonte trouxe preço', async () => {
    vi.spyOn(externalMarketService, 'fetchFromGoogleFinance').mockResolvedValue(null);
    vi.spyOn(externalMarketService, 'fetchFromBrapi').mockResolvedValue(null);

    await externalMarketService.recoverQuote('EURP11');

    expect(getEscalations()[0].resolvedBy).toBeNull();
  });

  // Ticker de fora da B3 nunca chega na Brapi — desenhar a Brapi no caminho dele
  // seria dizer que a cobertura existe onde ela não existe.
  it('ativo estrangeiro não registra a Brapi no caminho', async () => {
    vi.spyOn(externalMarketService, 'fetchFromGoogleFinance').mockResolvedValue({ ticker: 'AVB', price: 200 });

    await externalMarketService.recoverQuote('AVB');

    expect(getEscalations()[0].tried).toEqual(['yahoo.quotes', 'google.finance']);
  });

  // Escalada conhecida é ruído permanente: misturá-la com a novidade é o que
  // ensina o operador a ignorar a lista inteira.
  it('marca como esperada a escalada do ticker que sempre falha no Yahoo', async () => {
    vi.spyOn(externalMarketService, 'fetchFromGoogleFinance').mockResolvedValue({ ticker: 'B3SA3', price: 12 });

    await externalMarketService.recoverQuote('B3SA3');

    expect(getEscalations()[0].expected).toBe(true);
  });

  it('a queda TOTAL do Yahoo aparece com motivo próprio no registro', async () => {
    yahoo.quote.mockRejectedValue(new Error('fetch failed'));
    vi.spyOn(externalMarketService, 'fetchFromGoogleFinance').mockResolvedValue({ ticker: 'VALE3', price: 60 });

    await externalMarketService.getQuotes(['VALE3']);

    expect(getEscalations()[0].reason).toMatch(/lote inteiro/);
  });
});
