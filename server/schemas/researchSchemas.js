import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'analysisId inválido.');
const assetClass = z.enum(['STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'REIT', 'ETF', 'BRASIL_10']);

export const publishResearchSchema = z.object({
  body: z.object({
    analysisId: objectId,
    type: z.enum(['RANKING', 'MORNING_CALL', 'REPORT', 'EXPLAINABLE_AI', 'BOTH', 'ALL']),
    // Publicação parcial: ativa as seções que já têm conteúdo e pula as vazias,
    // em vez de rejeitar a análise inteira. Usado pelo "Publicar Tudo Pendente",
    // onde a intenção é colocar no ar o que estiver pronto.
    partial: z.boolean().optional().default(false),
  }).strict(),
});

export const enhanceResearchSchema = z.object({
  body: z.object({
    assetClass,
    strategy: z.literal('BUY_HOLD').default('BUY_HOLD'),
  }).strict(),
});

// Publicação sob demanda da estratégia âncora (BUY_AND_HOLD). Só STOCK e FII
// têm motor âncora; `dryRun` calcula e valida sem escrever nada, que é como o
// admin confere o que iria ao ar antes de mandar ao ar.
export const anchorPublishSchema = z.object({
  body: z.object({
    assetClass: z.enum(['STOCK', 'FII']).optional(),
    dryRun: z.boolean().optional().default(false),
  }).strict(),
});
