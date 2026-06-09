import { z } from 'zod';

/**
 * Schemas Zod das rotas de Metas (planejador patrimonial). Validação estrutural
 * de input; regras de negócio (recálculo, espelho da carteira) ficam no
 * controller. Espelha o estilo de walletSchemas.js.
 */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido');

const ICONS = ['target', 'home', 'car', 'plane', 'graduation', 'piggy', 'rocket', 'gift', 'heart', 'shield'];
const COLORS = ['emerald', 'blue', 'purple', 'yellow', 'red', 'cyan'];

// POST /goals — criar meta.
export const createGoalSchema = z.object({
  body: z.object({
    name: z.string({ required_error: 'Nome é obrigatório' }).trim().min(1, 'Nome é obrigatório').max(60, 'Nome muito longo'),
    icon: z.enum(ICONS).optional(),
    color: z.enum(COLORS).optional(),
    targetAmount: z.coerce.number({ required_error: 'Valor-alvo é obrigatório', invalid_type_error: 'Valor-alvo inválido' })
      .finite('Valor-alvo inválido')
      .positive('Valor-alvo deve ser maior que zero'),
    monthlyTarget: z.coerce.number({ invalid_type_error: 'Aporte mensal inválido' })
      .finite('Aporte mensal inválido')
      .nonnegative('Aporte não pode ser negativo')
      .optional(),
    expectedAnnualRate: z.coerce.number({ invalid_type_error: 'Taxa inválida' })
      .finite('Taxa inválida')
      .min(0, 'Taxa não pode ser negativa')
      .max(100, 'Taxa muito alta')
      .optional(),
    startDate: z.coerce.date({ invalid_type_error: 'Data inválida' }).optional(),
    targetDate: z.coerce.date({ invalid_type_error: 'Data inválida' }).optional(),
    mirrorWallet: z.coerce.boolean().optional(),
    manualBalance: z.coerce.number().finite('Saldo inválido').nonnegative().optional(),
  }),
});

// PUT /goals/:id — atualizar meta (todos os campos opcionais).
export const updateGoalSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(60, 'Nome muito longo').optional(),
    icon: z.enum(ICONS).optional(),
    color: z.enum(COLORS).optional(),
    targetAmount: z.coerce.number().finite('Valor-alvo inválido').positive('Valor-alvo deve ser maior que zero').optional(),
    monthlyTarget: z.coerce.number().finite('Aporte mensal inválido').nonnegative('Aporte não pode ser negativo').optional(),
    expectedAnnualRate: z.coerce.number().finite('Taxa inválida').min(0, 'Taxa não pode ser negativa').max(100, 'Taxa muito alta').optional(),
    targetDate: z.coerce.date({ invalid_type_error: 'Data inválida' }).nullable().optional(),
    mirrorWallet: z.coerce.boolean().optional(),
    status: z.enum(['ACTIVE', 'ACHIEVED', 'ARCHIVED']).optional(),
    lastCelebratedMilestone: z.coerce.number().int('Marco inválido').min(0).max(100).optional(),
  }),
});

// POST /goals/:id/contributions — registrar aporte manual avulso.
export const addContributionSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    amount: z.coerce.number({ required_error: 'Valor é obrigatório', invalid_type_error: 'Valor inválido' })
      .finite('Valor inválido')
      .refine((v) => v !== 0, 'Valor não pode ser zero'),
    date: z.coerce.date({ invalid_type_error: 'Data inválida' }).optional(),
    note: z.string().trim().max(120, 'Nota muito longa').optional(),
  }),
});

// DELETE /goals/:id e DELETE /goals/:id/contributions/:cid.
export const goalIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const contributionIdParamSchema = z.object({
  params: z.object({ id: objectId, cid: objectId }),
});
