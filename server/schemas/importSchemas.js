import { z } from 'zod';

/**
 * Schemas Zod da importação de carteira.
 *
 * O parsing do arquivo (XLSX da B3, colagem do Investidor10, planilha modelo)
 * acontece INTEIRO no navegador — o servidor nunca vê o arquivo original, só o
 * resultado normalizado. Estes schemas são a fronteira entre os dois mundos:
 * tudo que chega aqui é entrada de usuário e nada foi validado antes.
 */

// Fontes suportadas. Espelha o enum de `AssetTransaction.importSource` e
// `ImportBatch.source` — os três precisam andar juntos.
export const IMPORT_SOURCES = ['B3_MOVIMENTACAO', 'B3_NEGOCIACAO', 'INVESTIDOR10', 'SHEET'];

// Mesma lista de `walletSchemas.js`; duplicada de propósito para não acoplar os
// dois schemas por um import só de constante.
const ASSET_TYPES = ['STOCK', 'FII', 'STOCK_US', 'ETF', 'CRYPTO', 'FIXED_INCOME', 'CASH', 'OURO'];

// Tetos do lote. Não são números arbitrários: o commit dispara um
// `rebuildUserHistory` e um `recalculatePosition` por ticker distinto, e a
// transação do Mongo tem timeout de 30s (utils/dbTransaction.js).
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_TICKERS = 200;

// Uma linha já normalizada pelo parser do cliente.
const importRow = z.object({
  // O teto é generoso de propósito: a coluna Produto do extrato da B3 vem como
  // "PETR4 - PETROLEO BRASILEIRO S.A. PETROBRAS", e recusar isso aqui derrubava
  // o import inteiro com "Ticker muito longo" antes de o `extractTicker` do
  // serviço ter a chance de reduzir o rótulo ao código de negociação.
  ticker: z.string({ required_error: 'Ticker é obrigatório' })
    .min(1, 'Ticker é obrigatório')
    .max(120, 'Ticker muito longo')
    .trim(),
  type: z.enum(ASSET_TYPES, { errorMap: () => ({ message: 'Tipo de ativo inválido' }) }).optional(),
  // Diferente do POST /wallet/add, que infere BUY/SELL pelo SINAL da quantidade:
  // aqui o lado vem explícito do parser, porque "Venda" no extrato da B3 é uma
  // coluna, não um sinal, e reconstruir o sinal só para desmontá-lo de novo
  // seria uma chance a mais de errar.
  side: z.enum(['BUY', 'SELL'], { errorMap: () => ({ message: 'Operação deve ser compra ou venda' }) }),
  quantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' })
    .finite('Quantidade inválida')
    .positive('Quantidade deve ser maior que zero'),
  price: z.coerce.number({ invalid_type_error: 'Preço inválido' })
    .finite('Preço inválido')
    .nonnegative('Preço não pode ser negativo'),
  date: z.coerce.date({ invalid_type_error: 'Data inválida' }),
  currency: z.enum(['BRL', 'USD']).optional(),
  name: z.string().trim().max(120, 'Nome muito longo').optional(),
});

const rowList = z.array(importRow)
  .min(1, 'Nenhuma linha para importar')
  .max(MAX_IMPORT_ROWS, `Máximo de ${MAX_IMPORT_ROWS} lançamentos por importação`)
  .refine(
    (rows) => new Set(rows.map((r) => r.ticker.toUpperCase())).size <= MAX_IMPORT_TICKERS,
    `Máximo de ${MAX_IMPORT_TICKERS} ativos distintos por importação`
  );

// POST /wallet/import/preview — resolve tickers e tipos, não escreve nada.
// `type` é opcional aqui: descobrir o tipo é justamente o trabalho do preview.
export const importPreviewSchema = z.object({
  body: z.object({
    source: z.enum(IMPORT_SOURCES, { errorMap: () => ({ message: 'Fonte de importação inválida' }) }),
    rows: rowList,
  }),
});

// POST /wallet/import/commit — grava. Aqui o `type` é obrigatório: o usuário já
// passou pela tela de conferência, então toda linha que chega tem tipo decidido
// (pelo resolvedor ou por ele). Sem isso, gravaríamos posição sem classe.
export const importCommitSchema = z.object({
  body: z.object({
    source: z.enum(IMPORT_SOURCES, { errorMap: () => ({ message: 'Fonte de importação inválida' }) }),
    rows: z.array(importRow.extend({
      type: z.enum(ASSET_TYPES, { errorMap: () => ({ message: 'Defina o tipo de cada ativo antes de importar' }) }),
    }))
      .min(1, 'Nenhuma linha para importar')
      .max(MAX_IMPORT_ROWS, `Máximo de ${MAX_IMPORT_ROWS} lançamentos por importação`)
      .refine(
        (rows) => new Set(rows.map((r) => r.ticker.toUpperCase())).size <= MAX_IMPORT_TICKERS,
        `Máximo de ${MAX_IMPORT_TICKERS} ativos distintos por importação`
      ),
  }),
});

// DELETE /wallet/import/:batchId — desfaz um lote inteiro.
export const importBatchParamSchema = z.object({
  params: z.object({
    batchId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Lote inválido'),
  }),
});
