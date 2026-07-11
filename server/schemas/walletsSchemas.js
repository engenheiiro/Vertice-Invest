import { z } from 'zod';

/**
 * (Fase 2) Schemas Zod do CRUD de carteiras (`/api/wallets`, plural) —
 * distinto de `walletSchemas.js` (singular), que valida as rotas de
 * ativos/transações/metas-alvo de UMA carteira.
 */

// ObjectId do Mongo: 24 hex. Evita CastError feio em rotas /:walletId.
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido');

const walletName = z.string({ required_error: 'Nome é obrigatório' })
    .trim()
    .min(1, 'Nome é obrigatório')
    .max(40, 'Nome muito longo (máx. 40)');

// POST /wallets — criar carteira.
export const createWalletSchema = z.object({
    body: z.object({ name: walletName }),
});

// PUT /wallets/:walletId — renomear carteira.
export const renameWalletSchema = z.object({
    params: z.object({ walletId: objectId }),
    body: z.object({ name: walletName }),
});

// DELETE /wallets/:walletId — só precisa do id válido.
export const walletIdParamSchema = z.object({
    params: z.object({ walletId: objectId }),
});

// PUT /wallets/active — trocar a carteira ativa.
export const setActiveWalletSchema = z.object({
    body: z.object({ walletId: objectId }),
});
