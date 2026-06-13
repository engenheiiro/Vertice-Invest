
import mongoose from 'mongoose';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import UsageLog from '../models/UsageLog.js';
import logger from '../config/logger.js';
import { PLANS, LIMITS_CONFIG, TEST_PLAN_MAP } from '../config/subscription.js';
import { paymentService } from '../services/paymentService.js';
import { invalidateUser } from '../utils/userCache.js'; // (I6) bust de cache de plano

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

export const createTestCheckoutSession = async (req, res, next) => {
    try {
        const { planKey } = req.body;
        const TESTABLE_PLANS = ['ESSENTIAL', 'PRO', 'ELITE', 'BLACK'];

        if (!TESTABLE_PLANS.includes(planKey)) {
            return res.status(400).json({ message: "Plano inválido para teste. Use ESSENTIAL, PRO, ELITE ou BLACK." });
        }

        // Usa a mesma função do fluxo real — apenas com a variante _TEST (R$0,50, mesmos dias)
        const testPlanKey = `${planKey}_TEST`;
        const subscription = await paymentService.createSubscription(req.user, testPlanKey);

        res.status(200).json({
            redirectUrl: subscription.init_point,
            subscriptionId: subscription.id
        });
    } catch (error) {
        logger.error(`Erro ao criar checkout de teste: ${error.message}`);
        next(error);
    }
};

export const createCheckoutSession = async (req, res, next) => {
    try {
        const { planId } = req.body;
        const user = req.user;

        if (!PLANS[planId]) {
            return res.status(400).json({ message: "Plano inválido." });
        }

        const subscription = await paymentService.createSubscription(user, planId);
        
        res.status(200).json({
            redirectUrl: subscription.init_point, 
            subscriptionId: subscription.id
        });

    } catch (error) {
        logger.error(`Erro ao criar sessão de checkout: ${error.message}`);
        next(error);
    }
};

export const handlePaymentReturn = async (req, res) => {
    try {
        const { plan, ...query } = req.query;
        let clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
        clientUrl = clientUrl.replace(/\/$/, '');
        
        const queryString = new URLSearchParams(query).toString();
        const target = `${clientUrl}/#/checkout/success?plan=${plan}&${queryString}`;
        
        logger.info(`🔄 Redirecionando usuário do MP para: ${target}`);
        res.redirect(target);

    } catch (error) {
        logger.error(`Erro no redirect de retorno: ${error.message}`);
        res.redirect('/');
    }
};

// --- SINCRONIZAÇÃO FORÇADA DE PAGAMENTO (REDUNDÂNCIA AO WEBHOOK) ---
export const syncPayment = async (req, res, next) => {
    try {
        const { paymentId } = req.body;
        const userId = req.user.id;

        if (!paymentId) return res.status(400).json({ message: "ID de pagamento necessário." });

        // Busca status real no Mercado Pago
        const payment = await paymentService.getPaymentStatus(paymentId);

        if (!payment) {
            return res.status(404).json({ message: "Pagamento não encontrado no Mercado Pago." });
        }

        // external_reference no formato "{userId}:{planKey}" — extrai o userId para verificar ownership
        const refUserId = payment.external_reference?.split(':')[0];
        if (refUserId !== userId) {
            return res.status(403).json({ message: "Este pagamento não pertence a este usuário." });
        }

        if (payment.status === 'approved') {
            const user = await User.findById(userId);

            // Extrai planKey do external_reference e resolve teste → real
            const planKey = payment.external_reference?.split(':')[1];
            const plan = TEST_PLAN_MAP[planKey] || planKey || 'ESSENTIAL';

            // Verifica se já não foi processado (Idempotência básica)
            if (user.plan === plan && user.validUntil && new Date(user.validUntil) > new Date()) {
                return res.json({ success: true, message: "Plano já estava ativo." });
            }

            const now = new Date();
            let newValidUntil = new Date();
            if (user.validUntil && new Date(user.validUntil) > now) {
                newValidUntil = new Date(user.validUntil);
            }
            newValidUntil.setDate(newValidUntil.getDate() + 30);

            user.plan = plan;
            user.subscriptionStatus = 'ACTIVE';
            user.validUntil = newValidUntil;
            user.mpSubscriptionId = paymentId.toString();

            await user.save();
            invalidateUser(user._id); // (I6) plano mudou → derruba cache do authMiddleware

            // Salva Transação se não existir
            const existingTx = await Transaction.findOne({ gatewayId: paymentId.toString() });
            if (!existingTx) {
                await Transaction.create({
                    user: user._id,
                    plan: plan,
                    amount: payment.transaction_amount,
                    status: 'PAID',
                    method: payment.payment_type_id === 'bank_transfer' ? 'PIX' : 'CREDIT_CARD',
                    gatewayId: paymentId.toString()
                });
            }

            logger.info(`✅ [Sync] Plano ${plan} ativado manualmente para user ${user._id}`);
            return res.json({ success: true, plan, validUntil: newValidUntil });
        }

        return res.json({ success: false, status: payment.status });

    } catch (error) {
        logger.error(`Erro Sync Payment: ${error.message}`);
        next(error);
    }
};

export const confirmPayment = async (req, res, next) => {
    // Mock legacy - mantido para não quebrar testes
    const session = await mongoose.startSession();
    try {
        session.startTransaction({ maxCommitTimeMS: 30_000 });
        const { planId } = req.body;
        if (!PLANS[planId]) throw new Error("Plano inválido");
        await session.commitTransaction();
        session.endSession();
        res.status(200).json({ success: true });
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
