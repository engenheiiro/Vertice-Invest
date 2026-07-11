
import Wallet from '../models/Wallet.js';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';

/**
 * Resolve qual carteira uma requisição autenticada opera sobre, e anexa o id
 * validado em `req.walletId`. Monta-se DEPOIS de `authenticateToken` (precisa
 * de `req.user.id`).
 *
 * Ordem de resolução:
 *   1. `?walletId=` (query) ou `walletId` no body — SEMPRE valida posse
 *      (`Wallet.exists({_id, user})`) antes de aceitar. Este é o único ponto de
 *      autorização de toda a feature: nenhum controller deve reconfiar em
 *      `req.query.walletId`/`req.body.walletId` crus, só em `req.walletId`.
 *   2. `User.activeWalletId` — se a carteira ainda existir (pode ter sido apagada).
 *   3. Primeira carteira do usuário (`sort({createdAt:1})`) — rede de segurança.
 *
 * 400 se o usuário não tiver nenhuma carteira (não deveria acontecer pós-migração).
 * 403 se o `walletId` explícito não pertencer ao usuário autenticado.
 */
export const resolveWallet = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const requested = req.query?.walletId || req.body?.walletId;

        if (requested) {
            const owned = await Wallet.exists({ _id: requested, user: userId });
            if (!owned) return next(AppError.forbidden('Carteira não pertence a este usuário.'));
            req.walletId = String(requested);
            return next();
        }

        const user = await User.findById(userId).select('activeWalletId').lean();
        let walletId = user?.activeWalletId;

        if (walletId) {
            const stillExists = await Wallet.exists({ _id: walletId, user: userId });
            if (!stillExists) walletId = null; // apagada — cai no fallback abaixo
        }

        if (!walletId) {
            const first = await Wallet.findOne({ user: userId }).sort({ createdAt: 1 }).select('_id').lean();
            walletId = first?._id;
        }

        if (!walletId) return next(AppError.badRequest('Nenhuma carteira encontrada para este usuário.'));

        req.walletId = String(walletId);
        next();
    } catch (error) {
        next(error);
    }
};

export default resolveWallet;
