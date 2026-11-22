/**
 * Controller da carteira — fachada.
 *
 * A lógica mora em módulos irmãos (mesma pasta, para que os `vi.mock('../...')`
 * dos testes resolvam igual):
 *   walletAssetProcessor.js       — card de cada posição (preço, variação do dia, RF)
 *   walletKpis.js                 — KPIs live, fluxo do período, TWRR/Sharpe
 *   walletPayload.js              — payload de GET /wallet (compartilhado com o link público)
 *   walletPerformanceController.js — rentabilidade e histórico patrimonial
 *   walletTransactionsController.js — lançamentos, metas, busca e extrato por ativo
 *   walletDividendsController.js  — proventos, extrato de caixa e rotas de snapshot (admin)
 *
 * Este arquivo re-exporta todos os nomes públicos de antes: rotas, serviços e
 * testes continuam importando de `walletController.js`.
 */
import logger from '../config/logger.js';
import { buildWalletPayload } from './walletPayload.js';

export { getDailyFactorForDate, calculateLiveKPIS, sumRealizedProfitBRL, usdRateLoaderOnce } from './walletKpis.js';
export { processWalletAsset } from './walletAssetProcessor.js';
export { buildWalletPayload } from './walletPayload.js';
export {
    buildWalletPerformancePayload,
    getWalletPerformance,
    buildWalletHistoryPayload,
    getWalletHistory,
} from './walletPerformanceController.js';
export {
    addAssetTransaction,
    updateAsset,
    removeAsset,
    resetWallet,
    updateWalletTargets,
    searchAssets,
    ASSET_TRANSACTIONS_MAX_LIMIT,
    getAssetTransactions,
    deleteTransaction,
} from './walletTransactionsController.js';
export {
    buildWalletDividendsPayload,
    getWalletDividends,
    buildCashFlowPayload,
    getCashFlow,
    runCorporateAction,
    fixWalletSnapshots,
    getSnapshotHealth,
    forceSnapshot,
} from './walletDividendsController.js';

// GET /wallet — carteira ativa do usuário autenticado. Casca fina sobre
// buildWalletPayload (a matemática vive lá, compartilhada com a rota pública).
export const getWalletData = async (req, res, next) => {
    try {
        const payload = await buildWalletPayload(req.user.id, req.walletId);
        res.json(payload);
    } catch (error) {
        logger.error(`Erro ao processar carteira: ${error.message}`);
        next(error);
    }
};
