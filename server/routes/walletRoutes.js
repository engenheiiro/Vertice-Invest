
import express from 'express';
import { walletWriteLimiter } from '../middleware/rateLimiters.js';
import {
    getWalletData,
    getWalletHistory, 
    addAssetTransaction, 
    removeAsset, 
    updateAsset, 
    searchAssets,
    resetWallet,
    updateWalletTargets,
    getAssetTransactions,
    deleteTransaction,
    getWalletPerformance, 
    getWalletDividends,
    getCashFlow,
    runCorporateAction,
    fixWalletSnapshots,
    getSnapshotHealth,
    forceSnapshot // Importado
} from '../controllers/walletController.js';
import { authenticateToken, requireAdmin, requireElitePlan, requireBlackPlan } from '../middleware/authMiddleware.js';
import { resolveWallet } from '../middleware/resolveWallet.js';
import { researchHeavyLimiter } from '../middleware/rateLimiters.js';
import { getTaxReport, getTaxReportPdf } from '../controllers/taxController.js';
import validate from '../middleware/validateResource.js';
import {
    addTransactionSchema,
    updateAssetSchema,
    idParamSchema,
    corporateActionSchema,
    updateTargetsSchema,
} from '../schemas/walletSchemas.js';
import { rebalanceSchema } from '../schemas/rebalanceSchemas.js';
import { generateRebalancePlan } from '../controllers/rebalanceController.js';

const router = express.Router();

// (I5) Escrita limitada por USUÁRIO (50/15min) — ver middleware/rateLimiters.js.
// authenticateToken roda antes, então req.user.id está garantido na chave.
const writeLimiter = walletWriteLimiter;

router.use(authenticateToken);

// resolveWallet fica ANTES de cada rota que opera sobre ativos/histórico/metas-
// alvo de UMA carteira — nunca nas rotas admin (system-wide) nem em /search ou
// /tax-report (conta inteira), pra um admin sem carteira própria não ficar
// bloqueado em diagnósticos por um problema alheio ao que ele está operando.
router.get('/', resolveWallet, getWalletData);
router.get('/history', resolveWallet, getWalletHistory);
router.get('/search', searchAssets);

// Rotas de Escrita Protegidas — (I9) validação Zod após limiter, antes do handler.
router.post('/add', writeLimiter, resolveWallet, validate(addTransactionSchema), addAssetTransaction);
router.post('/reset', writeLimiter, resolveWallet, resetWallet);
// Carteira ideal (alocação-alvo) — antes de '/:id' para não cair no matcher de param.
router.put('/targets', writeLimiter, resolveWallet, validate(updateTargetsSchema), updateWalletTargets);
router.delete('/:id', writeLimiter, resolveWallet, validate(idParamSchema), removeAsset);
router.put('/:id', writeLimiter, resolveWallet, validate(updateAssetSchema), updateAsset);

// Rotas de Transações Granulares
router.get('/transactions/:ticker', resolveWallet, getAssetTransactions);
router.delete('/transactions/:id', writeLimiter, resolveWallet, validate(idParamSchema), deleteTransaction);

// Rotas de Inteligência
router.get('/performance', resolveWallet, getWalletPerformance);
router.get('/dividends', resolveWallet, getWalletDividends);

// Rebalanceamento IA (ELITE+): read-only, gera plano de ordens sobre a carteira
// ativa. Cadeia: authenticateToken (router.use) → requireElitePlan → limiter
// pesado → resolveWallet → validate → handler.
router.post('/rebalance', requireElitePlan, researchHeavyLimiter, resolveWallet, validate(rebalanceSchema), generateRebalancePlan);

// Extrato de Conta Corrente (Cash Flow)
router.get('/cashflow', resolveWallet, getCashFlow);

// (7.11) Relatório de Imposto de Renda (BLACK): apuração de renda variável,
// posição 31/12, proventos e DARF. Cadeia: authenticateToken (router.use) →
// requireBlackPlan → limiter pesado (recálculo caro) → handler.
router.get('/tax-report/:year', requireBlackPlan, researchHeavyLimiter, getTaxReport);
router.get('/tax-report/:year/pdf', requireBlackPlan, researchHeavyLimiter, getTaxReportPdf);

// Nova Rota: Correção de Splits (Admin / Manutenção)
router.post('/fix-splits', writeLimiter, validate(corporateActionSchema), runCorporateAction);

// Rotas Admin de Saúde
router.post('/fix-snapshots', requireAdmin, fixWalletSnapshots);
router.get('/snapshot-health', requireAdmin, getSnapshotHealth);
// NOVO: Trigger Manual de Snapshot
router.post('/admin/snapshot/force', requireAdmin, forceSnapshot);

export default router;
