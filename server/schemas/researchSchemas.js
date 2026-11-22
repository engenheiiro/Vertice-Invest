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

// --- Rotas admin que entravam sem schema ---
// Mesmo sendo admin-only, corpo cru ia direto para o banco: `days` aceitava
// string/objeto e gravava `backtestHorizon: "abc"` no MACRO_INDICATORS (o motor
// de sinais lê o campo como número); `analysisId` não-string virava CastError → 500.

// Horizonte do backtest de sinais. O painel oferece 3/7/15/30; o teto deixa
// folga sem permitir um horizonte que nenhum sinal alcança.
export const backtestConfigSchema = z.object({
  body: z.object({
    days: z.number({ error: 'Informe o horizonte em dias.' })
      .int('O horizonte deve ser um número inteiro de dias.')
      .min(1, 'Horizonte mínimo: 1 dia.')
      .max(90, 'Horizonte máximo: 90 dias.'),
  }).strict(),
});

export const narrativeSchema = z.object({
  body: z.object({ analysisId: objectId }).strict(),
});

export const explainableSchema = z.object({
  body: z.object({
    analysisId: objectId,
    // Texto editado à mão pelo admin. Teto contra payload que estouraria o
    // documento da análise (limite de 16MB do Mongo) ou a tela que o exibe.
    customText: z.string({ error: 'Texto inválido.' }).max(20_000, 'Texto longo demais (máx. 20.000 caracteres).').optional(),
    profile: z.enum(['DEFENSIVE', 'MODERATE', 'BOLD'], { error: 'Perfil inválido.' }).optional(),
  }).strict(),
});

// ErrorLog: :id precisa ser ObjectId. O controller já confere, mas a recusa
// agora acontece antes do handler, no mesmo formato das demais rotas.
export const errorIdParamSchema = z.object({
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Id inválido.') }),
});
