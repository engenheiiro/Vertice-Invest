
import mongoose from 'mongoose';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import logger from '../config/logger.js';

// Preços (Hardcoded por enquanto, idealmente viriam do DB ou Config)
const PLANS = {
    'ESSENTIAL': { price: 39.90, days: 30 },
    'PRO': { price: 119.90, days: 30 },
    'BLACK': { price: 349.90, days: 30 }
};

// Definição de limites por feature e plano (Backend Truth)
const LIMITS_CONFIG = {
    'smart_contribution': {
        'GUEST': 0,
        'ESSENTIAL': 1,
        'PRO': 2,
        'BLACK': 9999 
    },
    'report': {
        'GUEST': 0,
        'ESSENTIAL': 1,
        'PRO': 9999,
        'BLACK': 9999 
    }
};

// Mock de armazenamento de uso (Em produção seria Redis ou tabela no Mongo)
// Estrutura: { userId_feature_month: count }
const USAGE_CACHE = {}; 

export const checkAccess = async (req, res, next) => {
    try {
        const { feature } = req.query;
        const user = req.user; // Obtido do authMiddleware
        const plan = user.plan || 'GUEST';

        if (!LIMITS_CONFIG[feature]) {
            return res.status(400).json({ message: "Feature desconhecida." });
        }

        const limit = LIMITS_CONFIG[feature][plan];
        const key = `${user.id}_${feature}_${new Date().getMonth()}`;
        const currentUsage = USAGE_CACHE[key] || 0;

        if (currentUsage >= limit) {
            return res.status(403).json({ 
                allowed: false, 
                currentUsage, 
                limit, 
                plan,
                message: limit === 0 
                    ? `Recurso indisponível no plano ${plan}.` 
                    : `Limite mensal atingido (${currentUsage}/${limit}).`
            });
        }

        return res.json({ allowed: true, currentUsage, limit, plan });

    } catch (error) {
        next(error);
    }
};

export const registerUsage = async (req, res, next) => {
    try {
        const { feature } = req.body;
        const user = req.user;
        const plan = user.plan || 'GUEST';
        
        // Revalida antes de incrementar
        const limit = LIMITS_CONFIG[feature]?.[plan] || 0;
        const key = `${user.id}_${feature}_${new Date().getMonth()}`;
        const currentUsage = USAGE_CACHE[key] || 0;

        if (currentUsage >= limit) {
            return res.status(403).json({ message: "Limite atingido." });
        }

        USAGE_CACHE[key] = currentUsage + 1;
        res.json({ success: true, newUsage: USAGE_CACHE[key] });

    } catch (error) {
        next(error);
    }
};

export const createCheckoutSession = async (req, res, next) => {
    try {
        const { planId } = req.body;
        const userId = req.user.id;

        if (!PLANS[planId]) {
            return res.status(400).json({ message: "Plano inválido." });
        }

        const sessionId = `sess_${new Date().getTime()}_${Math.random().toString(36).substring(7)}`;
        logger.info(`Checkout iniciado: User ${userId} -> Plan ${planId}`);

        res.status(200).json({
            sessionId,
            plan: planId,
            amount: PLANS[planId].price,
            redirectUrl: `/checkout?session_id=${sessionId}&plan=${planId}`
        });

    } catch (error) {
        next(error);
    }
};

export const confirmPayment = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const { planId, paymentMethod } = req.body;
        const userId = req.user.id;

        if (!PLANS[planId]) throw new Error("Plano inválido");

        const transaction = new Transaction({
            user: userId,
            plan: planId,
            amount: PLANS[planId].price,
            status: 'PAID',
            method: paymentMethod || 'CREDIT_CARD',
            gatewayId: `tx_${Math.random().toString(36).substring(2, 15)}`
        });
        await transaction.save({ session });

        const now = new Date();
        const validUntil = new Date(now.setDate(now.getDate() + PLANS[planId].days));

        const updatedUser = await User.findByIdAndUpdate(userId, {
            plan: planId,
            subscriptionStatus: 'ACTIVE',
            validUntil: validUntil
        }, { new: true, session });

        await session.commitTransaction();
        session.endSession();

        logger.info(`Pagamento confirmado: User ${userId} atualizado para ${planId}`);

        res.status(200).json({
            success: true,
            user: {
                plan: updatedUser.plan,
                subscriptionStatus: updatedUser.subscriptionStatus,
                validUntil: updatedUser.validUntil
            }
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        logger.error(`Erro no pagamento: ${error.message}`);
        next(error);
    }
};

export const getSubscriptionStatus = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id).select('plan subscriptionStatus validUntil');
        const lastTransaction = await Transaction.findOne({ user: req.user.id }).sort({ createdAt: -1 });

        res.json({
            current: user,
            lastPayment: lastTransaction
        });
    } catch (error) {
        next(error);
    }
};
