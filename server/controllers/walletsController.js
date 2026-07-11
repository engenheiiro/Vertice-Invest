
import crypto from 'crypto';
import Wallet from '../models/Wallet.js';
import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import InvestmentGoal from '../models/InvestmentGoal.js';
import GoalContribution from '../models/GoalContribution.js';
import { runTransaction, txError } from '../utils/dbTransaction.js';
import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';

// Teto de carteiras por usuário — não é um limite de produto anunciado, só uma
// rede de segurança contra abuso/loop client-side (cada carteira nova é uma
// escrita real: Wallet + índices; sem teto, um bug no front poderia spammar).
const MAX_WALLETS_PER_USER = 15;

// GET /wallets — lista as carteiras do usuário + qual é a ativa.
export const listWallets = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const [wallets, user] = await Promise.all([
            Wallet.find({ user: userId }).sort({ createdAt: 1 }).lean(),
            User.findById(userId).select('activeWalletId').lean(),
        ]);

        // Fallback de exibição: se activeWalletId estiver ausente/órfão (carteira
        // apagada), reporta a primeira como ativa — mesma regra do resolveWallet.
        const activeExists = wallets.some((w) => String(w._id) === String(user?.activeWalletId));
        const activeWalletId = activeExists ? String(user.activeWalletId) : String(wallets[0]?._id || '');

        res.json({
            wallets: wallets.map((w) => ({
                id: w._id,
                name: w.name,
                isDefault: !!w.isDefault,
                createdAt: w.createdAt,
                // (C4) Estado de compartilhamento público — o front monta o link
                // a partir do publicToken (só presente quando isPublic).
                isPublic: !!w.isPublic,
                publicToken: w.isPublic ? (w.publicToken || null) : null,
                publicShowValues: !!w.publicShowValues,
            })),
            activeWalletId,
        });
    } catch (error) {
        next(error);
    }
};

// POST /wallets — cria uma carteira vazia (nasce com os defaults de alocação-alvo
// do schema Wallet). Não mexe em qual carteira está ativa.
export const createWallet = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const count = await Wallet.countDocuments({ user: userId });
        if (count >= MAX_WALLETS_PER_USER) {
            return next(AppError.badRequest(`Limite de ${MAX_WALLETS_PER_USER} carteiras por conta atingido.`));
        }

        const wallet = await Wallet.create({ user: userId, name: req.body.name.trim() });
        res.status(201).json({ message: 'Carteira criada.', wallet: { id: wallet._id, name: wallet.name, isDefault: false, createdAt: wallet.createdAt } });
    } catch (error) {
        next(error);
    }
};

// PUT /wallets/:walletId — renomear.
export const renameWallet = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { walletId } = req.params;

        const wallet = await Wallet.findOneAndUpdate(
            { _id: walletId, user: userId },
            { $set: { name: req.body.name.trim() } },
            { new: true },
        );
        if (!wallet) return next(AppError.notFound('Carteira não encontrada.'));

        res.json({ message: 'Carteira renomeada.', wallet: { id: wallet._id, name: wallet.name, isDefault: !!wallet.isDefault, createdAt: wallet.createdAt } });
    } catch (error) {
        next(error);
    }
};

// DELETE /wallets/:walletId — apaga a carteira e TODO o seu conteúdo (ativos,
// lançamentos, histórico, metas). Espelha o "Excluir Carteira Permanentemente"
// que já existia (Fase 1: wipe da conta inteira), agora escopado a uma carteira.
// Bloqueia se for a última carteira do usuário — toda conta mantém ao menos uma.
export const deleteWallet = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { walletId } = req.params;

        const totalWallets = await Wallet.countDocuments({ user: userId });
        if (totalWallets <= 1) {
            return next(AppError.badRequest('Você precisa manter ao menos uma carteira.'));
        }

        // Devolvida ao front pra ele atualizar activeWalletId direto (sem esperar
        // um segundo round-trip de GET /wallets pra descobrir a realocação — evita
        // flash de loading numa query key nova quando a carteira apagada era a ativa).
        let newActiveWalletId;

        await runTransaction(async (session) => {
            const wallet = await Wallet.findOne({ _id: walletId, user: userId }).session(session);
            if (!wallet) throw txError(404, 'Carteira não encontrada.');

            await UserAsset.deleteMany({ user: userId, wallet: walletId }).session(session);
            await AssetTransaction.deleteMany({ user: userId, wallet: walletId }).session(session);
            await WalletSnapshot.deleteMany({ user: userId, wallet: walletId }).session(session);
            await GoalContribution.deleteMany({ user: userId, wallet: walletId }).session(session);
            await InvestmentGoal.deleteMany({ user: userId, wallet: walletId }).session(session);
            await Wallet.deleteOne({ _id: walletId }).session(session);

            // Se a carteira apagada era a ativa, realoca para a mais antiga restante
            // — na MESMA transação, pra nunca deixar o usuário sem carteira ativa válida.
            // updateOne (não .save() num doc parcialmente carregado) evita revalidar
            // campos do User não selecionados aqui (name/email/password required).
            const user = await User.findById(userId).select('activeWalletId').session(session).lean();
            if (user && String(user.activeWalletId) === String(walletId)) {
                const fallback = await Wallet.findOne({ user: userId }).sort({ createdAt: 1 }).session(session).lean();
                newActiveWalletId = String(fallback?._id || '');
                await User.updateOne({ _id: userId }, { $set: { activeWalletId: fallback?._id || null } }, { session });
            }
        });

        logger.info(`[Wallets] Carteira ${walletId} excluída (user ${userId}).`);
        res.json({ message: 'Carteira excluída.', activeWalletId: newActiveWalletId });
    } catch (error) {
        if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
        next(error);
    }
};

// POST /wallets/:walletId/share — (C4) liga/atualiza o compartilhamento público
// (opt-in). Gera um publicToken aleatório na primeira vez; `regenerate:true`
// rotaciona o token (invalida o link antigo). `showValues` controla se a página
// pública exibe valores em R$ (default false: só % e composição).
export const shareWallet = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { walletId } = req.params;
        const { showValues = false, regenerate = false } = req.body || {};

        const wallet = await Wallet.findOne({ _id: walletId, user: userId });
        if (!wallet) return next(AppError.notFound('Carteira não encontrada.'));

        // randomBytes(24)→32 chars base64url: espaço de busca inviável de varrer.
        if (!wallet.publicToken || regenerate) {
            wallet.publicToken = crypto.randomBytes(24).toString('base64url');
        }
        wallet.isPublic = true;
        wallet.publicShowValues = !!showValues;
        await wallet.save();

        logger.info(`[Wallets] Carteira ${walletId} compartilhada (user ${userId}, showValues=${wallet.publicShowValues}).`);
        res.json({
            message: 'Compartilhamento ativado.',
            isPublic: true,
            publicToken: wallet.publicToken,
            publicShowValues: wallet.publicShowValues,
        });
    } catch (error) {
        next(error);
    }
};

// DELETE /wallets/:walletId/share — revoga o link público (token → null). O link
// antigo passa a não resolver. Mantém a preferência de showValues para um futuro
// re-compartilhamento não perder a escolha do usuário.
export const unshareWallet = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { walletId } = req.params;

        const wallet = await Wallet.findOneAndUpdate(
            { _id: walletId, user: userId },
            { $set: { isPublic: false, publicToken: null } },
            { new: true },
        );
        if (!wallet) return next(AppError.notFound('Carteira não encontrada.'));

        logger.info(`[Wallets] Carteira ${walletId} despublicada (user ${userId}).`);
        res.json({ message: 'Compartilhamento revogado.', isPublic: false });
    } catch (error) {
        next(error);
    }
};

// PUT /wallets/active — troca a carteira ativa do usuário.
export const setActiveWallet = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { walletId } = req.body;

        const owned = await Wallet.exists({ _id: walletId, user: userId });
        if (!owned) return next(AppError.forbidden('Carteira não pertence a este usuário.'));

        await User.updateOne({ _id: userId }, { $set: { activeWalletId: walletId } });
        res.json({ message: 'Carteira ativa atualizada.', activeWalletId: walletId });
    } catch (error) {
        next(error);
    }
};
