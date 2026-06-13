import { z } from 'zod';

/**
 * (I9) Schemas Zod das rotas de escrita da carteira. Centraliza a validação
 * estrutural de input (tipos, obrigatoriedade, faixas) que antes vivia espalhada
 * em checagens ad-hoc nos handlers. Regras de NEGÓCIO (ex.: saldo suficiente,
 * data futura no fuso correto) seguem nos services/controllers.
 */

// ObjectId do Mongo: 24 hex. Evita CastError feio em rotas /:id.
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido');

const ASSET_TYPES = ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED_INCOME', 'CASH'];

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
    name: z.string().trim().max(120, 'Nome muito longo').optional(),
  }),
});

// PUT /wallet/:id — atualizar tags e/ou nome do ativo (ex.: renomear cofrinho).
export const updateAssetSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    tags: z.array(z.string().trim().max(40, 'Tag muito longa')).max(20, 'Máximo de 20 tags').optional(),
    name: z.string().trim().min(1, 'Nome não pode ser vazio').max(120, 'Nome muito longo').optional(),
  }),
});

// DELETE /wallet/:id e DELETE /wallet/transactions/:id — só precisam do id válido.
export const idParamSchema = z.object({
  params: z.object({ id: objectId }),
});

// PUT /wallet/targets — salvar carteira ideal (alocação-alvo + reserva).
const allocPct = z.coerce.number().finite('Percentual inválido').min(0).max(100).optional();
export const updateTargetsSchema = z.object({
  body: z.object({
    targetAllocation: z.object({
      STOCK: allocPct,
      FII: allocPct,
      STOCK_US: allocPct,
      CRYPTO: allocPct,
      FIXED_INCOME: allocPct,
    }).optional(),
    targetReserve: z.coerce.number().finite('Valor inválido').nonnegative('Reserva não pode ser negativa').optional(),
  }),
});

// POST /wallet/fix-splits — ação corporativa manual.
export const corporateActionSchema = z.object({
  body: z.object({
    ticker: z.string({ required_error: 'Ticker é obrigatório' }).min(1, 'Ticker é obrigatório').trim(),
    type: z.string().trim().optional(),
  }),
});
