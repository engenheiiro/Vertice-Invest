/**
 * CAMADA DE PUBLICAÇÃO da estratégia âncora `BUY_AND_HOLD` (ações + FIIs).
 *
 * Tira os dois motores do shadow: gera o ranking a partir dos dados atuais,
 * aplica a HISTERESE contra a publicação anterior da MESMA estratégia e classe,
 * persiste um `MarketAnalysis` e ativa a seção RANKING pelo mesmo fluxo
 * transacional do Research semanal (`researchPublicationService`).
 *
 * ISOLAMENTO DA ESTRATÉGIA LEGADA — a regra que atravessa tudo:
 * `PublishedResearchPointer` é único por `(assetClass, strategy, section)` e
 * `getLatestReport` filtra por strategy, então `BUY_HOLD` (semanal, 3 perfis) e
 * `BUY_AND_HOLD` (âncora, perfil único) coexistem sem se tocar. Nada aqui lê,
 * escreve ou invalida documento, ponteiro ou cálculo da estratégia legada.
 * Não há migração de banco.
 */

import MarketAnalysis from '../models/MarketAnalysis.js';
import PublishedResearchPointer from '../models/PublishedResearchPointer.js';
import SystemConfig from '../models/SystemConfig.js';
import logger from '../config/logger.js';
import { buyAndHoldService } from './buyAndHoldService.js';
import { fiiBuyAndHoldService } from './fiiBuyAndHoldService.js';
import { activateResearchSections } from './researchPublicationService.js';
import { applyAnchorHysteresis, toHysteresisBaseline } from '../utils/anchorHysteresis.js';
import { validateFundamentalsPublicationHealth } from '../utils/ingestionHealth.js';
import {
  ANCHOR_ASSET_CLASSES,
  ANCHOR_DISCLAIMER,
  ANCHOR_HYSTERESIS,
  ANCHOR_PUBLICATION_GATE,
  ANCHOR_RISK_PROFILE,
  ANCHOR_STRATEGY,
} from '../config/buyAndHoldPublication.js';

/**
 * Adaptadores por classe. Cada um sabe traduzir a saída do SEU motor para a
 * forma que a histerese consome — em especial o `blocked`, que separa "AGUARDAR
 * porque o score caiu" (onde a histerese cede) de "AGUARDAR por fato novo sobre
 * o ativo" (onde ela não cede). Só o adaptador conhece os campos do motor.
 */
const ADAPTERS = Object.freeze({
  STOCK: Object.freeze({
    label: 'Ações',
    generate: opts => buyAndHoldService.generateBuyAndHoldRanking(opts),
    blockersOf: row => (row.expensive
      ? { blocked: true, blockReason: 'preço subiu acima do valor justo — a âncora segue boa, o ponto de entrada é que não está' }
      : { blocked: false, blockReason: null }),
    anchorPayload: row => ({
      archetype: row.archetype ?? null,
      premiumPct: row.premiumPct ?? null,
      expensive: !!row.expensive,
    }),
  }),
  FII: Object.freeze({
    label: 'FIIs',
    generate: opts => fiiBuyAndHoldService.generateFiiBuyAndHoldRanking(opts),
    blockersOf: (row) => {
      if (row.payoutUncovered) {
        return { blocked: true, blockReason: 'distribuição deixou de ser coberta pelo FFO — a renda não é operacional' };
      }
      if (row.publicationLimit) {
        return { blocked: true, blockReason: 'saiu do COMPRAR pelo teto de composição da carteira publicável, não por demérito do fundo' };
      }
      if (row.expensive) {
        return { blocked: true, blockReason: 'preço subiu acima do valor justo — a âncora segue boa, o ponto de entrada é que não está' };
      }
      return { blocked: false, blockReason: null };
    },
    anchorPayload: row => ({
      subType: row.subType ?? null,
      manager: row.manager ?? null,
      spreadPp: row.spreadPp ?? null,
      pFfo: row.pFfo ?? null,
      ffoCoverage: row.ffoCoverage ?? null,
      vacancy: row.vacancy ?? null,
      publicationLimit: row.publicationLimit ?? null,
      expensive: !!row.expensive,
      payoutUncovered: !!row.payoutUncovered,
    }),
  }),
});

export const anchorAssetClasses = () => [...ANCHOR_ASSET_CLASSES];

/**
 * Baseline de histerese: o ranking ATUALMENTE PUBLICADO desta classe sob a
 * estratégia âncora. `null` = nunca houve publicação (bootstrap): sem lista
 * anterior, vale o limiar de entrada para todo mundo.
 */
export const loadPublishedAnchorRanking = async (assetClass) => {
  const pointer = await PublishedResearchPointer.findOne({
    assetClass,
    strategy: ANCHOR_STRATEGY,
    section: 'RANKING',
  }).lean();
  if (!pointer) return null;

  const analysis = await MarketAnalysis.findById(pointer.analysis)
    .select('content.ranking createdAt')
    .lean();
  if (!analysis) return null;

  return {
    analysisId: String(pointer.analysis),
    activatedAt: pointer.activatedAt,
    baseline: toHysteresisBaseline(analysis.content?.ranking || []),
  };
};

const asRankingItem = (row, { assetClass, adapter, version }) => ({
  position: row.position,
  ticker: row.ticker,
  name: row.name,
  sector: row.sector,
  type: assetClass,
  allocationClass: assetClass,
  currency: 'BRL',
  action: row.action,
  score: row.score,
  currentPrice: row.currentPrice ?? null,
  targetPrice: row.targetPrice ?? null,
  // Perfil ÚNICO: a lista âncora não tem os três perfis do semanal.
  riskProfile: ANCHOR_RISK_PROFILE,
  reason: row.reason,
  thesis: row.reason,
  anchor: {
    version,
    axes: row.axes,
    composite: row.composite ?? null,
    hysteresis: row.hysteresis || null,
    exitReason: row.exitReason || null,
    ...adapter.anchorPayload(row),
  },
});

/**
 * Monta o ranking âncora publicável de uma classe. READ-ONLY: não persiste nada,
 * não toca em ponteiro. É o mesmo caminho que o cron usa, para que a prévia do
 * admin e o que vai ao ar sejam literalmente o mesmo cálculo.
 */
export const buildAnchorRanking = async (assetClass) => {
  const adapter = ADAPTERS[assetClass];
  if (!adapter) throw new Error(`Classe sem estratégia âncora: ${assetClass}`);

  // `includeExcluded` é o que permite explicar quem SUMIU da lista: sem os
  // motivos de portão dos excluídos, um ticker que perdeu o gate desapareceria
  // da tela sem uma linha dizendo por quê.
  const result = await adapter.generate({ includeExcluded: true });
  const gateFailuresByTicker = new Map(
    (result.excluded || []).map(item => [item.ticker, item.failures]),
  );

  const published = await loadPublishedAnchorRanking(assetClass);

  const hysteresis = applyAnchorHysteresis({
    current: result.ranking.map(row => ({ ...row, ...adapter.blockersOf(row) })),
    previous: published ? published.baseline : null,
    gateFailuresByTicker,
  });

  const version = result.version;
  const ranking = hysteresis.ranking.map(row => asRankingItem(row, { assetClass, adapter, version }));

  return {
    assetClass,
    label: adapter.label,
    strategy: ANCHOR_STRATEGY,
    version,
    generatedAt: result.generatedAt,
    macro: result.macro,
    config: result.config,
    thresholds: { ...ANCHOR_HYSTERESIS },
    disclaimer: ANCHOR_DISCLAIMER,
    bootstrap: hysteresis.bootstrap,
    previousAnalysisId: published?.analysisId || null,
    ranking,
    exits: hysteresis.exits,
    excludedByReason: result.excludedByReason,
    counts: {
      ...result.counts,
      // `buy` do motor não conhece a histerese; o que vale é a lista final.
      buy: ranking.filter(item => item.action === 'BUY').length,
      wait: ranking.filter(item => item.action !== 'BUY').length,
      held: hysteresis.counts.held,
      entered: hysteresis.counts.entered,
      exits: hysteresis.counts.exits,
    },
  };
};

/**
 * Gate de qualidade. O cron publica sem ninguém olhar, então uma base degradada
 * (sync quebrado, fundamentos velhos) não pode ir ao ar como lista de
 * aposentadoria. Espelha `validateAutoPublish` do semanal, com números próprios
 * — a lista âncora é curta de propósito e exigir 5 COMPRAR reprovaria uma lista
 * saudável. O que precisa de piso é o UNIVERSO avaliado, não o resultado.
 */
export const validateAnchorPublication = (built, lastSyncStats = null, now = new Date()) => {
  const analyzed = built?.counts?.analyzed || 0;
  const eligible = built?.counts?.eligible || 0;
  if (analyzed < ANCHOR_PUBLICATION_GATE.minAnalyzed) {
    return { ok: false, reason: `apenas ${analyzed} ativos avaliados (mínimo ${ANCHOR_PUBLICATION_GATE.minAnalyzed})` };
  }
  if (eligible < ANCHOR_PUBLICATION_GATE.minEligible) {
    return { ok: false, reason: `apenas ${eligible} ativos elegíveis (mínimo ${ANCHOR_PUBLICATION_GATE.minEligible})` };
  }
  return validateFundamentalsPublicationHealth(built.assetClass, lastSyncStats, now);
};

/**
 * Gera, valida e publica a lista âncora de UMA classe.
 * @param {object} params
 * @param {string} params.assetClass STOCK ou FII
 * @param {boolean} [params.dryRun] calcula e valida sem escrever nada.
 */
export const publishAnchorRanking = async ({
  assetClass,
  activatedBy = null,
  dryRun = false,
  lastSyncStats = null,
} = {}) => {
  const built = await buildAnchorRanking(assetClass);
  // Chamada avulsa (rota admin) não traz o `lastSyncStats`; sem carregá-lo o
  // gate de fundamentos reprovaria SEMPRE, e a válvula manual nunca publicaria.
  const syncStats = lastSyncStats
    ?? (await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean())?.lastSyncStats
    ?? null;
  const gate = validateAnchorPublication(built, syncStats);
  if (!gate.ok) return { assetClass, published: false, blocked: true, reason: gate.reason, built };
  if (dryRun) return { assetClass, published: false, dryRun: true, built };

  const analysis = await MarketAnalysis.create({
    assetClass,
    strategy: ANCHOR_STRATEGY,
    algorithmVersion: built.version,
    calculatedAt: new Date(),
    inputManifest: {
      macro: built.macro,
      thresholds: built.thresholds,
      counts: built.counts,
      bootstrap: built.bootstrap,
      previousAnalysis: built.previousAnalysisId,
      disclaimer: built.disclaimer,
    },
    anchorExits: built.exits,
    content: { ranking: built.ranking, morningCall: '' },
    generatedBy: activatedBy,
  });

  await activateResearchSections({
    analysis,
    sections: ['RANKING'],
    activatedBy,
    requireAll: true,
  });

  return {
    assetClass,
    published: true,
    analysisId: String(analysis._id),
    counts: built.counts,
    exits: built.exits,
    bootstrap: built.bootstrap,
  };
};

/** Roda a publicação âncora de todas as classes. Uma falha não derruba as outras. */
export const runAnchorPublication = async ({ activatedBy = null, dryRun = false } = {}) => {
  const systemConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean();
  const lastSyncStats = systemConfig?.lastSyncStats || null;

  const results = [];
  for (const assetClass of ANCHOR_ASSET_CLASSES) {
    try {
      const result = await publishAnchorRanking({ assetClass, activatedBy, dryRun, lastSyncStats });
      results.push(result);
      if (result.blocked) {
        logger.warn('Publicação âncora BLOQUEADA pelo gate de qualidade', {
          strategy: ANCHOR_STRATEGY, assetClass, reason: result.reason,
        });
      } else if (result.published) {
        logger.info('Lista âncora publicada', {
          strategy: ANCHOR_STRATEGY,
          assetClass,
          buy: result.counts.buy,
          held: result.counts.held,
          exits: result.exits.length,
          bootstrap: result.bootstrap,
        });
      }
    } catch (error) {
      logger.error('Falha ao publicar lista âncora', {
        strategy: ANCHOR_STRATEGY, assetClass, error: error.message,
      });
      results.push({ assetClass, published: false, error: error.message });
    }
  }
  return { strategy: ANCHOR_STRATEGY, dryRun, results };
};

export const anchorPublicationService = {
  anchorAssetClasses,
  buildAnchorRanking,
  loadPublishedAnchorRanking,
  publishAnchorRanking,
  runAnchorPublication,
  validateAnchorPublication,
};
