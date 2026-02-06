
import mongoose from 'mongoose';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import UsageLog from '../models/UsageLog.js';
import logger from '../config/logger.js';
import { PLANS, LIMITS_CONFIG } from '../config/subscription.js';
import { paymentService } from '../services/paymentService.js';

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

        if (limit === 9999) {
            return res.json({ allowed: true, currentUsage: 0, limit, plan });
        }

        if (limit === 0) {
             return res.status(403).json({ 
                allowed: false, 
                currentUsage: 0, 
                limit, 
                plan,
                message: `Recurso não disponível no plano ${plan}. Faça um upgrade.`
            });
        }

        const usageLog = await UsageLog.findOne({ user: user.id, feature, monthKey });
        const currentUsage = usageLog ? usageLog.count : 0;

        if (['report'].includes(feature) && currentUsage >= limit) {
             return res.status(403).json({ 
                allowed: false, 
                currentUsage, 
                limit, 
                plan,
                message: `Limite mensal atingido (${currentUsage}/${limit}) para o plano ${plan}.`
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

        const usageLog = await UsageLog.findOneAndUpdate(
            { user: user.id, feature, monthKey },
            { $setOnInsert: { count: 0 } },
            { upsert: true, new: true }
        );

        if (limit !== 9999 && usageLog.count >= limit) {
             if (['report'].includes(feature)) {
                 return res.status(403).json({ message: "Limite atingido." });
             }
        }

        usageLog.count += 1;
        usageLog.lastUsed = new Date();
        await usageLog.save();

        res.json({ success: true, newUsage: usageLog.count });

    } catch (error) {
        logger.error(`🔥 [Subscription] Erro em registerUsage: ${error.message}`);
        next(error);
    }
};

// --- ALTERAÇÃO PRINCIPAL: CHECKOUT REAL ---
export const createCheckoutSession = async (req, res, next) => {
    try {
        const { planId } = req.body;
        const user = req.user; // Obtido do middleware authenticateToken

        if (!PLANS[planId]) {
            return res.status(400).json({ message: "Plano inválido." });
        }

        // Chama o serviço do Mercado Pago
        const subscription = await paymentService.createSubscription(user, planId);
        
        res.status(200).json({
            redirectUrl: subscription.init_point, // URL para o frontend redirecionar
            subscriptionId: subscription.id
        });

    } catch (error) {
        logger.error(`Erro ao criar sessão de checkout: ${error.message}`);
        next(error);
    }
};

// --- MANTIDO APENAS PARA COMPATIBILIDADE OU TESTES MANUAIS DE ADMIN ---
export const confirmPayment = async (req, res, next) => {
    // Esta rota agora é secundária, pois o Webhook deve confirmar o pagamento.
    // Pode ser mantida para forçar ativação manual se necessário.
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
            method: paymentMethod || 'MANUAL_CONFIRM',
            gatewayId: `manual_${Math.random().toString(36).substring(2, 15)}`
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
        const user = await User.findById(req.user.id).select('plan subscriptionStatus validUntil mpSubscriptionId');
        const lastTransaction = await Transaction.findOne({ user: req.user.id }).sort({ createdAt: -1 });

        res.json({
            current: user,
            lastPayment: lastTransaction
        });
    } catch (error) {
        next(error);
    }
};
