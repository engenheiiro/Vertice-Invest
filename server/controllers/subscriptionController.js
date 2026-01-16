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

export const createCheckoutSession = async (req, res, next) => {
    try {
        const { planId } = req.body;
        const userId = req.user.id;

        if (!PLANS[planId]) {
            return res.status(400).json({ message: "Plano inválido." });
        }

        // Em um cenário real, aqui chamaríamos o Stripe.session.create
        // Aqui, geramos um ID de sessão interno para nosso gateway simulado
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

        // 1. Registrar Transação
        const transaction = new Transaction({
            user: userId,
            plan: planId,
            amount: PLANS[planId].price,
            status: 'PAID',
            method: paymentMethod || 'CREDIT_CARD',
            gatewayId: `tx_${Math.random().toString(36).substring(2, 15)}`
        });
        await transaction.save({ session });

        // 2. Calcular nova validade
        const now = new Date();
        const validUntil = new Date(now.setDate(now.getDate() + PLANS[planId].days));

        // 3. Atualizar Usuário
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
        
        // Verifica histórico recente
        const lastTransaction = await Transaction.findOne({ user: req.user.id }).sort({ createdAt: -1 });

        res.json({
            current: user,
            lastPayment: lastTransaction
        });
    } catch (error) {
        next(error);
    }
};