import { z } from 'zod';

/**
 * (I9) Schemas Zod das rotas de escrita da carteira. Centraliza a validação
 * estrutural de input (tipos, obrigatoriedade, faixas) que antes vivia espalhada
 * em checagens ad-hoc nos handlers. Regras de NEGÓCIO (ex.: saldo suficiente,
 * data futura no fuso correto) seguem nos services/controllers.
 */

// ObjectId do Mongo: 24 hex. Evita CastError feio em rotas /:id.
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido');

const ASSET_TYPES = ['STOCK', 'FII', 'STOCK_US', 'ETF', 'CRYPTO', 'FIXED_INCOME', 'CASH', 'OURO'];

// POST /wallet/add — registrar transação (BUY/SELL definido pelo sinal de quantity).
export const addTransactionSchema = z.object({
  body: z.object({
    ticker: z.string({ required_error: 'Ticker é obrigatório' })
      .min(1, 'Ticker é obrigatório')
      .trim(),
    type: z.enum(ASSET_TYPES, { errorMap: () => ({ message: 'Tipo de ativo inválido' }) }).optional(),
    quantity: z.coerce.number({ required_error: 'Quantidade é obrigatória', invalid_type_error: 'Quantidade inválida' })
      .finite('Quantidade inválida')
      .refine((v) => v !== 0, 'Quantidade não pode ser zero'),
    price: z.coerce.number({ required_error: 'Preço é obrigatório', invalid_type_error: 'Preço inválido' })
      .finite('Preço inválido')
      .nonnegative('Preço não pode ser negativo'),
    date: z.coerce.date({ invalid_type_error: 'Data inválida' }).optional(),
    fixedIncomeRate: z.coerce.number().finite('Taxa inválida').optional(),
    // Pós-fixados/indexados: índice + spread a.a. sobre o índice (Tesouro Selic/IPCA).
    fixedIncomeIndex: z.enum(['SELIC', 'CDI', 'IPCA', 'PRE']).optional(),
    fixedIncomeSpread: z.coerce.number().finite('Spread inválido').optional(),
    // C2: vencimento do título (Renda Fixa). No vencimento o accrual congela e o
    // ativo é marcado VENCIDO. Aceita YYYY-MM-DD (input date) ou ISO.
    maturityDate: z.coerce.date({ invalid_type_error: 'Data de vencimento inválida' }).optional(),
    name: z.string().trim().max(120, 'Nome muito longo').optional(),
    // Sub-tipo de Exterior escolhido manualmente no cadastro (Stocks/ETF/REIT/Dólar/Ouro).
    usSubType: z.enum(['STOCK', 'ETF', 'REIT', 'DOLLAR', 'GOLD']).optional(),
    // Moeda do lançamento — autoritativa p/ a classe ETF (nacional R$ vs internacional US$),
    // onde o mesmo tipo pode ser BRL ou USD. Sem ela, cai no default por tipo/MarketAsset.
    currency: z.enum(['BRL', 'USD']).optional(),
    // C1: marca o ativo como Reserva separada (sai da base de alocação). Só faz
    // sentido para FIXED_INCOME/CASH; para os demais o controller ignora.
    isReserve: z.coerce.boolean().optional(),
  }),
});

// PUT /wallet/:id — atualizar tags, nome, sub-tipo de Exterior, alternar reserva
// ou reclassificar um Caixa/Reserva (CASH) em Renda Fixa (FIXED_INCOME).
export const updateAssetSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    tags: z.array(z.string().trim().max(40, 'Tag muito longa')).max(20, 'Máximo de 20 tags').optional(),
    name: z.string().trim().min(1, 'Nome não pode ser vazio').max(120, 'Nome muito longo').optional(),
    // Override manual do sub-tipo de Exterior (Stocks/ETF/REIT/Dólar/Ouro).
    usSubType: z.enum(['STOCK', 'ETF', 'REIT', 'DOLLAR', 'GOLD'], { errorMap: () => ({ message: 'Sub-tipo inválido' }) }).optional(),
    // Reclassificação CASH → FIXED_INCOME (o controller só aceita essa direção).
    type: z.literal('FIXED_INCOME').optional(),
    fixedIncomeRate: z.coerce.number().finite('Taxa inválida').optional(),
    fixedIncomeIndex: z.enum(['SELIC', 'CDI', 'IPCA', 'PRE']).optional(),
    fixedIncomeSpread: z.coerce.number().finite('Spread inválido').optional(),
    maturityDate: z.coerce.date({ invalid_type_error: 'Data de vencimento inválida' }).optional(),
    // Alterna "Reserva separada" (fora da base de alocação) de CASH/Renda Fixa.
    isReserve: z.coerce.boolean().optional(),
  }),
});

// DELETE /wallet/:id e DELETE /wallet/transactions/:id — só precisam do id válido.
export const idParamSchema = z.object({
  params: z.object({ id: objectId }),
});

// PUT /wallet/targets — salvar carteira ideal (alocação-alvo + reserva + sub-metas).
const allocPct = z.coerce.number().finite('Percentual inválido').min(0).max(100).optional();

// Sub-meta de uma classe: percentuais RELATIVOS à fatia da classe (somam ~100%
// DENTRO da classe). Se TODAS as sub-chaves forem 0, considera-se "sem sub-meta"
// (comportamento legado, classe em bloco) e a soma 100% NÃO é exigida.
const subAllocSum100 = (label) => (obj) => {
  if (!obj) return true;
  const sum = Object.values(obj).reduce((a, v) => a + (Number(v) || 0), 0);
  return sum === 0 || Math.abs(sum - 100) <= 0.5;
};

const fixedIncomeSub = z
  .object({ IPCA: allocPct, POS: allocPct, PRE: allocPct })
  .refine(subAllocSum100('FIXED_INCOME'), { message: 'Sub-metas de Renda Fixa devem somar 100%' })
  .optional();

// Exterior ramifica em Stocks/REITs/ETFs/Dólar. ETFs internacionais (e ouro lastreado)
// contam aqui no sub-tipo ETF; a classe própria 'ETF' (ASSET_TYPES) é só p/ nacionais.
const stockUsSub = z
  .object({ STOCK: allocPct, REIT: allocPct, ETF: allocPct, DOLLAR: allocPct })
  .refine(subAllocSum100('STOCK_US'), { message: 'Sub-metas do Exterior devem somar 100%' })
  .optional();

export const updateTargetsSchema = z.object({
  body: z.object({
    targetAllocation: z.object({
      STOCK: allocPct,
      FII: allocPct,
      STOCK_US: allocPct,
      ETF: allocPct,
      CRYPTO: allocPct,
      FIXED_INCOME: allocPct,
      OURO: allocPct,
    }).optional(),
    targetReserve: z.coerce.number().finite('Valor inválido').nonnegative('Reserva não pode ser negativa').optional(),
    targetMonthlyDividendIncome: z.coerce.number().finite('Valor inválido').nonnegative('Meta não pode ser negativa').optional(),
    targetSubAllocation: z.object({
      FIXED_INCOME: fixedIncomeSub,
      STOCK_US: stockUsSub,
    }).optional(),
  }),
});

// POST /wallet/fix-splits — ação corporativa manual.
export const corporateActionSchema = z.object({
  body: z.object({
    ticker: z.string({ required_error: 'Ticker é obrigatório' }).min(1, 'Ticker é obrigatório').trim(),
    type: z.string().trim().optional(),
  }),
});
