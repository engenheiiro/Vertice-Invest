import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'analysisId inválido.');
const assetClass = z.enum(['STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'REIT', 'ETF', 'BRASIL_10']);

export const publishResearchSchema = z.object({
  body: z.object({
    analysisId: objectId,
    type: z.enum(['RANKING', 'MORNING_CALL', 'REPORT', 'EXPLAINABLE_AI', 'BOTH', 'ALL']),
  }).strict(),
});

export const enhanceResearchSchema = z.object({
  body: z.object({
    assetClass,
    strategy: z.literal('BUY_HOLD').default('BUY_HOLD'),
  }).strict(),
});
