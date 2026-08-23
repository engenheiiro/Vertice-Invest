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
  // Publicação âncora: mesmo o dryRun é POST e passa pelo researchHeavyLimiter,
  // então um 429 tem de virar exceção — um rascunho que "deu certo" sem calcular
  // nada levaria o dono a publicar às cegas.
  ['publishAnchorRanking (dryRun)', () => researchService.publishAnchorRanking({ assetClass: 'STOCK', dryRun: true })],
  ['publishAnchorRanking (publica)', () => researchService.publishAnchorRanking({ assetClass: 'FII' })],
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
  ['getBuyAndHoldShadow', () => researchService.getBuyAndHoldShadow('FII'), undefined],
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

/**
 * Contrato de REQUISIÇÃO da publicação âncora.
 *
 * O que estes testes travam é a diferença entre "prévia" e "foi ao ar", que no
 * cliente é um único booleano no corpo do POST. Se `dryRun` se perder no
 * caminho, o botão "Ver rascunho" publica de verdade — sem confirmação, sem
 * ninguém ter olhado a lista. É o defeito mais caro que este card pode ter.
 *
 * E `assetClass` precisa ir SEMPRE: o servidor roda as duas classes quando o
 * campo não vem, então omiti-lo transforma "publicar Ações" em "publicar Ações
 * e FIIs". O mesmo default silencioso já escondia os FIIs na leitura do shadow.
 */
describe('researchService.publishAnchorRanking — contrato de requisição', () => {
  let apiSpy: ReturnType<typeof vi.spyOn>;

  const okResponse = (body: unknown = { strategy: 'BUY_AND_HOLD', dryRun: true, results: [] }) => ({
    ok: true,
    status: 200,
    json: async () => body,
  });

  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

  beforeEach(() => {
    apiSpy = vi.spyOn(authService, 'api');
    apiSpy.mockResolvedValue(okResponse() as unknown as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('manda POST para a rota âncora, nunca para a do Research semanal', async () => {
    await researchService.publishAnchorRanking({ assetClass: 'STOCK', dryRun: true });
    const [url, init] = apiSpy.mock.calls[0];
    expect(url).toBe('/api/research/anchor/publish');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('dryRun: true viaja no corpo — é o que separa prévia de publicação', async () => {
    await researchService.publishAnchorRanking({ assetClass: 'STOCK', dryRun: true });
    expect(bodyOf(apiSpy.mock.calls[0])).toEqual({ assetClass: 'STOCK', dryRun: true });
  });

  it('sem dryRun explícito, publica de verdade (dryRun: false)', async () => {
    await researchService.publishAnchorRanking({ assetClass: 'FII' });
    expect(bodyOf(apiSpy.mock.calls[0])).toEqual({ assetClass: 'FII', dryRun: false });
  });

  it('a classe pedida é a classe enviada — FII não pode virar STOCK', async () => {
    await researchService.publishAnchorRanking({ assetClass: 'FII', dryRun: true });
    expect(bodyOf(apiSpy.mock.calls[0]).assetClass).toBe('FII');
  });

  it('sem assetClass, o campo é OMITIDO (servidor roda as duas classes)', async () => {
    await researchService.publishAnchorRanking({ dryRun: true });
    expect(bodyOf(apiSpy.mock.calls[0])).toEqual({ dryRun: true });
  });

  it('devolve o envelope do servidor intacto, com o built da prévia', async () => {
    const payload = {
      strategy: 'BUY_AND_HOLD',
      dryRun: true,
      results: [{ assetClass: 'STOCK', published: false, dryRun: true, built: { counts: { buy: 6 } } }],
    };
    apiSpy.mockResolvedValue(okResponse(payload) as unknown as Response);
    await expect(researchService.publishAnchorRanking({ assetClass: 'STOCK', dryRun: true })).resolves.toEqual(payload);
  });

  it('propaga o bloqueio do portão como resultado, não como exceção', async () => {
    // `blocked` é 200 com corpo — a tela precisa MOSTRAR o motivo, e um throw
    // aqui viraria um toast de erro genérico sem o rascunho que não foi ao ar.
    const payload = {
      strategy: 'BUY_AND_HOLD',
      dryRun: false,
      results: [{ assetClass: 'STOCK', published: false, blocked: true, reason: 'último sync de fundamentos BR não está saudável' }],
    };
    apiSpy.mockResolvedValue(okResponse(payload) as unknown as Response);
    const result = await researchService.publishAnchorRanking({ assetClass: 'STOCK' });
    expect(result.results[0].blocked).toBe(true);
    expect(result.results[0].reason).toContain('fundamentos');
  });
});

describe('researchService.getBuyAndHoldShadow — classe explícita', () => {
  let apiSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiSpy = vi.spyOn(authService, 'api');
    apiSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // O servidor faz default para STOCK quando o parâmetro não vem. Enquanto o
  // cliente o omitia, os FIIs não apareciam em lugar nenhum do Admin.
  it.each(['STOCK', 'FII'] as const)('manda assetClass=%s na query', async (assetClass) => {
    await researchService.getBuyAndHoldShadow(assetClass);
    expect(apiSpy.mock.calls[0][0]).toContain(`assetClass=${assetClass}`);
  });
});
