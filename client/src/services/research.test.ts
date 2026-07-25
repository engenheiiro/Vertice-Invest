import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { researchService } from './research';
import { authService } from './auth';

/**
 * Contrato de erro do researchService.
 *
 * Bug de 25/07/2026: `publish()` fazia `return response.json()` sem checar
 * `response.ok`. Um 429 do adminLimiter resolvia como sucesso, o loop de
 * "Publicar Tudo Pendente" terminava sem lançar nada e o painel mostrava toast
 * verde — "publicou" sem publicar nada. O mesmo defeito estava em
 * `crunchNumbers()` e `generateNarrative()`.
 *
 * A invariante que estes testes travam:
 *   - MUTAÇÃO (POST/PUT/DELETE) com resposta não-ok → SEMPRE rejeita, e a
 *     mensagem do servidor chega ao chamador (é ela que vira toast).
 *   - LEITURA com resposta não-ok → pode degradar para um fallback vazio, mas
 *     NUNCA pode devolver o corpo de erro como se fosse dado válido.
 */

// Corpo típico de um 429 dos limiters de `server/middleware/rateLimiters.js`.
const RATE_LIMIT_BODY = { message: 'Muitas operações de administração. Aguarde alguns minutos.' };

const errorResponse = (status = 429, body: unknown = RATE_LIMIT_BODY) => ({
  ok: false,
  status,
  json: async () => body,
});

type Call = () => Promise<unknown>;

// Mutações: qualquer resposta não-ok tem de virar exceção.
const MUTATIONS: [string, Call][] = [
  ['crunchNumbers', () => researchService.crunchNumbers('STOCK')],
  ['runFullPipeline', () => researchService.runFullPipeline()],
  ['enhanceReport', () => researchService.enhanceReport('STOCK')],
  ['syncMarketData', () => researchService.syncMarketData()],
  ['syncMacro', () => researchService.syncMacro()],
  ['generateNarrative', () => researchService.generateNarrative('id')],
  ['publish', () => researchService.publish('id', 'ALL')],
  ['updateBacktestConfig', () => researchService.updateBacktestConfig(30)],
  ['clearSignalsHistory', () => researchService.clearSignalsHistory()],
  ['resetAssetHealth', () => researchService.resetAssetHealth()],
  ['triggerSnapshot', () => researchService.triggerSnapshot()],
  ['syncTimeSeries', () => researchService.syncTimeSeries()],
  ['generateExplainableAI', () => researchService.generateExplainableAI('id')],
];

// Leituras: fallback declarado. `undefined` = também deve lançar (auditoria e
// shadow são telas que precisam distinguir "vazio" de "falhou").
const READS: [string, Call, unknown][] = [
  ['getHistory', () => researchService.getHistory(), []],
  ['getLatest', () => researchService.getLatest('STOCK', 'BUY_HOLD'), null],
  ['getMacroData', () => researchService.getMacroData(), null],
  ['getFixedIncomeData', () => researchService.getFixedIncomeData(), null],
  ['getSignalsHistory', () => researchService.getSignalsHistory(), { signals: [], meta: null }],
  ['getRadarStats', () => researchService.getRadarStats(), null],
  ['getDataQualityStats', () => researchService.getDataQualityStats(), null],
  ['getAlgorithmAccuracy', () => researchService.getAlgorithmAccuracy('STOCK'), []],
  ['getDiscardLogs', () => researchService.getDiscardLogs(), []],
  ['getPublishStatus', () => researchService.getPublishStatus(), []],
  ['getReportDetails', () => researchService.getReportDetails('id'), undefined],
  ['getBuyAndHoldShadow', () => researchService.getBuyAndHoldShadow(), undefined],
];

describe('researchService — contrato de erro HTTP', () => {
  let apiSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiSpy = vi.spyOn(authService, 'api');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mutações rejeitam em resposta não-ok', () => {
    it.each(MUTATIONS)('%s rejeita em 429 (rate limit)', async (_name, call) => {
      apiSpy.mockResolvedValue(errorResponse() as unknown as Response);
      await expect(call()).rejects.toThrow();
    });

    it.each(MUTATIONS)('%s rejeita em 500 (erro do servidor)', async (_name, call) => {
      apiSpy.mockResolvedValue(errorResponse(500, { message: 'Erro interno' }) as unknown as Response);
      await expect(call()).rejects.toThrow();
    });

    it.each(MUTATIONS)('%s propaga a mensagem do servidor', async (_name, call) => {
      apiSpy.mockResolvedValue(errorResponse() as unknown as Response);
      await expect(call()).rejects.toThrow(RATE_LIMIT_BODY.message);
    });

    // Um 429 do express-rate-limit pode vir sem corpo JSON parseável; nem por
    // isso a chamada pode "passar" — tem de rejeitar com a mensagem padrão.
    it.each(MUTATIONS)('%s rejeita mesmo sem corpo JSON válido', async (_name, call) => {
      apiSpy.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
      } as unknown as Response);
      await expect(call()).rejects.toThrow();
    });
  });

  describe('leituras degradam para fallback vazio, nunca para o corpo de erro', () => {
    it.each(READS)('%s trata 429 sem devolver dado falso', async (_name, call, fallback) => {
      apiSpy.mockResolvedValue(errorResponse() as unknown as Response);

      if (fallback === undefined) {
        await expect(call()).rejects.toThrow();
        return;
      }

      const result = await call();
      expect(result).toEqual(fallback);
      // A garantia que importa: o corpo de erro não vaza como se fosse payload.
      expect(result).not.toMatchObject(RATE_LIMIT_BODY);
    });
  });

  it('publish resolve normalmente quando o servidor aceita', async () => {
    apiSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response);

    await expect(researchService.publish('id', 'ALL')).resolves.toEqual({ success: true });
  });
});
