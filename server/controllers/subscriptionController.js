
import mongoose from 'mongoose';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import UsageLog from '../models/UsageLog.js';
import logger from '../config/logger.js';

// Preços
const PLANS = {
    'ESSENTIAL': { price: 39.90, days: 30 },
    'PRO': { price: 119.90, days: 30 },
    'BLACK': { price: 349.90, days: 30 }
};

// Definição de limites por feature e plano
// 9999 = Ilimitado
const LIMITS_CONFIG = {
    'smart_contribution': {
        'GUEST': 0,
        'ESSENTIAL': 1, // Estrito: 1x por mês
        'PRO': 9999,    // Ilimitado
        'BLACK': 9999   // Ilimitado
    },
    'report': {
        'GUEST': 0,
        'ESSENTIAL': 1,
        'PRO': 9999,
        'BLACK': 9999 
    }
};

const getMonthKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}`;
};

export const checkAccess = async (req, res, next) => {
    try {
        const { feature } = req.query;
        const user = req.user;
        
        if (!user) {
            return res.status(401).json({ message: "Não autorizado." });
        }

        const plan = user.plan || 'GUEST';

        if (!LIMITS_CONFIG[feature]) {
            return res.status(400).json({ message: "Feature desconhecida." });
        }

        const limit = LIMITS_CONFIG[feature][plan];
        const monthKey = getMonthKey();

        // Busca uso persistido no banco
        const usageLog = await UsageLog.findOne({ user: user.id, feature, monthKey });
        const currentUsage = usageLog ? usageLog.count : 0;

        // Se o limite for atingido E não for ilimitado (9999)
        if (currentUsage >= limit && limit !== 9999) {
            return res.status(403).json({ 
                allowed: false, 
                currentUsage, 
                limit, 
                plan,
                message: limit === 0 
                    ? `Recurso exclusivo para assinantes PRO ou BLACK.` 
                    : `Você atingiu seu limite mensal (${currentUsage}/${limit}) para o plano ${plan}.`
            });
        }

        return res.json({ allowed: true, currentUsage, limit, plan });

    } catch (error) {
        logger.error(`🔥 [Subscription] Erro em checkAccess: ${error.message}`);
        next(error);
    }
};

export const registerUsage = async (req, res, next) => {
    try {
        const { feature } = req.body;
        const user = req.user;
        const plan = user.plan || 'GUEST';
        
        if (!LIMITS_CONFIG[feature]) {
             return res.status(400).json({ message: "Feature inválida" });
        }

        const limit = LIMITS_CONFIG[feature]?.[plan] || 0;
        const monthKey = getMonthKey();

        // Operação atômica para incrementar e checar limite
        const usageLog = await UsageLog.findOneAndUpdate(
            { user: user.id, feature, monthKey },
            { $setOnInsert: { count: 0 } },
            { upsert: true, new: true }
        );

        // Bloqueio Hard no Backend
        if (usageLog.count >= limit && limit !== 9999) {
            logger.warn(`⛔ [Usage] Tentativa de burlar limite bloqueada. User: ${user.id}, Plan: ${plan}`);
            return res.status(403).json({ message: "Limite mensal atingido. Faça upgrade para continuar." });
        }

        // Incrementa
        usageLog.count += 1;
        usageLog.lastUsed = new Date();
        await usageLog.save();

        logger.info(`✅ [Usage] Uso registrado. User: ${user.id} (${plan}), Feature: ${feature}, Novo Total: ${usageLog.count}`);
        
        res.json({ success: true, newUsage: usageLog.count });

    } catch (error) {
        logger.error(`🔥 [Subscription] Erro em registerUsage: ${error.message}`);
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
