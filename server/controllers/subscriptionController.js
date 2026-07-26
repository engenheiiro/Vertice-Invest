
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import UsageLog from '../models/UsageLog.js';
import logger from '../config/logger.js';
import { PLANS, LIMITS_CONFIG, isTestPlan } from '../config/subscription.js';
import { paymentService } from '../services/paymentService.js';
import {
    grantOneTimePeriod,
    syncRecurringPeriod,
    markSubscriptionCanceled,
    parseExternalReference,
} from '../services/subscriptionService.js';
import { sendSubscriptionCanceledEmail } from '../services/emailService.js';

// Além deste teto, o saldo restante não é um período comprado e sim um acesso
// concedido à mão (contas internas costumam ter validade em datas distantes).
// Adiar a primeira cobrança para lá deixaria a assinatura sem cobrar por anos.
const MAX_HONORED_REMAINDER_DAYS = 366;

/**
 * Data em que a assinatura deve começar a cobrar. Quem ainda tem dias pagos no
 * saldo (ex.: comprou 30 dias no Pix e resolveu migrar para o cartão no dia 10)
 * não pode ser cobrado na hora — isso descartaria os 20 dias que já pagou.
 */
const resolveRecurringStartDate = (user) => {
    if (!user?.validUntil) return null;
    const validUntil = new Date(user.validUntil);
    const now = new Date();
    if (!(validUntil > now)) return null;

    const remainingDays = (validUntil.getTime() - now.getTime()) / 86_400_000;
    return remainingDays <= MAX_HONORED_REMAINDER_DAYS ? validUntil : null;
};

// Roteia o checkout conforme o modo: cartão nunca é avulso, Pix nunca é recorrente.
const startCheckout = (user, planKey, mode) => (
    mode === 'RECURRING'
        ? paymentService.createRecurringSubscription(user, planKey, { startDate: resolveRecurringStartDate(user) })
        : paymentService.createOneTimeCheckout(user, planKey)
);

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
        const { planKey, mode = 'ONE_TIME' } = req.body;
        const TESTABLE_PLANS = ['ESSENTIAL', 'PRO', 'ELITE', 'BLACK'];

        if (!TESTABLE_PLANS.includes(planKey)) {
            return res.status(400).json({ message: "Plano inválido para teste. Use ESSENTIAL, PRO, ELITE ou BLACK." });
        }

        // Usa a mesma função do fluxo real — apenas com a variante _TEST (R$5,00, mesmos dias)
        const testPlanKey = `${planKey}_TEST`;
        const subscription = await startCheckout(req.user, testPlanKey, mode);

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
        const { planId, mode = 'ONE_TIME' } = req.body;
        const user = req.user;

        if (!PLANS[planId]) {
            return res.status(400).json({ message: "Plano inválido." });
        }

        // Barreira independente do schema: uma variante _TEST cobra R$5,00 e
        // credita o plano real, então o checkout público nunca pode aceitá-la.
        // Só /test-checkout (requireAdmin) cria essas preferências.
        if (isTestPlan(planId)) {
            logger.warn(`⛔ [Subscription] Tentativa de checkout com plano de teste ${planId} pelo user ${user.id}.`);
            return res.status(400).json({ message: "Plano inválido." });
        }

        const subscription = await startCheckout(user, planId, mode);

        res.status(200).json({
            redirectUrl: subscription.init_point,
            subscriptionId: subscription.id
        });

    } catch (error) {
        logger.error(`Erro ao criar sessão de checkout: ${error.message}`);
        next(error);
    }
};

/**
 * Troca de plano com assinatura ativa. Cancela o preapproval atual e cria outro
 * começando em `validUntil` — o período já pago é honrado, sem cobrança dupla.
 */
export const changePlan = async (req, res, next) => {
    try {
        const { planId } = req.body;
        const user = await User.findById(req.user.id);

        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });
        if (!PLANS[planId] || isTestPlan(planId)) {
            return res.status(400).json({ message: "Plano inválido." });
        }
        if (user.subscriptionType !== 'RECURRING' || !user.mpPreapprovalId) {
            return res.status(400).json({ message: "Nenhuma assinatura recorrente ativa para trocar." });
        }
        if (user.plan === planId) {
            return res.status(400).json({ message: "Você já está neste plano." });
        }

        // O MP não altera o valor de um preapproval autorizado de forma confiável;
        // cancelar e recriar mantém o histórico limpo e a data de cobrança correta.
        await paymentService.cancelPreapproval(user.mpPreapprovalId);

        const now = new Date();
        const startDate = user.validUntil && new Date(user.validUntil) > now
            ? new Date(user.validUntil)
            : null;

        const subscription = await paymentService.createRecurringSubscription(user, planId, { startDate });

        logger.info('🔄 Troca de plano iniciada', {
            userId: user._id.toString(), from: user.plan, to: planId,
            startDate: startDate?.toISOString() ?? 'imediato',
        });

        res.status(200).json({
            redirectUrl: subscription.init_point,
            subscriptionId: subscription.id,
        });
    } catch (error) {
        logger.error(`Erro ao trocar de plano: ${error.message}`);
        next(error);
    }
};

/**
 * Cancela a assinatura recorrente. O acesso é preservado até `validUntil`:
 * cancelar interrompe a cobrança futura, não estorna o período já pago.
 */
export const cancelSubscription = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        if (!user.mpPreapprovalId || user.subscriptionType !== 'RECURRING') {
            return res.status(400).json({ message: "Você não possui uma assinatura recorrente ativa." });
        }
        if (user.subscriptionStatus === 'CANCELED') {
            return res.json({ success: true, message: "Assinatura já cancelada.", validUntil: user.validUntil });
        }

        const canceled = await paymentService.cancelPreapproval(user.mpPreapprovalId);
        if (!canceled) {
            return res.status(502).json({ message: "Não foi possível cancelar no Mercado Pago. Tente novamente em instantes." });
        }

        await markSubscriptionCanceled(user);
        await sendSubscriptionCanceledEmail(user.email, user.plan, user.validUntil);

        res.json({
            success: true,
            message: "Assinatura cancelada. Seu acesso continua até o fim do período pago.",
            validUntil: user.validUntil,
        });
    } catch (error) {
        logger.error(`Erro ao cancelar assinatura: ${error.message}`);
        next(error);
    }
};

export const handlePaymentReturn = async (req, res) => {
    try {
        // Checkout Pro devolve payment_id, collection_id, status e
        // collection_status. A SPA os usa apenas para consultar/exibir o
        // pagamento: webhook e sync-payment continuam sendo a fonte de verdade.
        const readSingleQueryValue = (value) => Array.isArray(value) ? value.at(-1) : value;
        // No fluxo recorrente o plano vem pelo PATH (/return/:plan), porque o
        // back_url do preapproval não pode ter query string — ver a nota em
        // paymentService.createRecurringSubscription.
        const rawPlan = req.params?.plan || readSingleQueryValue(req.query.plan);
        const plan = typeof rawPlan === 'string' && PLANS[rawPlan] ? rawPlan : null;
        const allowedParams = [
            'payment_id',
            'collection_id',
            'status',
            'collection_status',
            'return_status',
            // Fluxo recorrente: o back_url do preapproval devolve preapproval_id
            // no lugar de payment_id.
            'preapproval_id',
            'mode',
        ];
        const query = new URLSearchParams();
        if (plan) query.set('plan', plan);

        for (const key of allowedParams) {
            const value = readSingleQueryValue(req.query[key]);
            if (typeof value === 'string' && value.length > 0) query.set(key, value);
        }

        // Resgate defensivo: o Mercado Pago concatena "?preapproval_id=..." no
        // back_url sem checar se já existe query string, grudando o id dentro do
        // valor de outro parâmetro (ex.: return_status="success?preapproval_id=X").
        // O back_url recorrente já não tem query justamente por isso, mas sem esta
        // rede o cliente pagaria e a tela de sucesso não acharia a assinatura.
        if (!query.has('preapproval_id')) {
            for (const [key, value] of [...query.entries()]) {
                const match = /[?&]preapproval_id=([^&]+)/i.exec(value);
                if (!match) continue;
                query.set(key, value.slice(0, match.index));
                query.set('preapproval_id', match[1]);
                break;
            }
        }

        // A presença do preapproval_id é o que identifica o fluxo recorrente.
        if (query.has('preapproval_id')) query.set('mode', 'recurring');

        const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
        const target = new URL('/checkout/success', clientUrl);
        target.search = query.toString();

        logger.info(`🔄 Redirecionando usuário do MP para: ${target.toString()}`);
        res.redirect(target.toString());

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
            const planKey = parseExternalReference(payment.external_reference).planKey;

            // Mesma barreira do webhook (Transaction antes do crédito, índice único
            // em gatewayId): esta rota e o webhook podem correr para o mesmo
            // pagamento e ainda assim creditar o período uma única vez.
            const result = await grantOneTimePeriod(user, planKey, {
                gatewayId: paymentId,
                amount: payment.transaction_amount,
                method: payment.payment_type_id === 'bank_transfer' ? 'PIX' : 'CREDIT_CARD',
            });

            if (!result.credited) {
                return res.json({ success: true, message: "Pagamento já processado." });
            }

            logger.info(`✅ [Sync] Plano ${result.plan} ativado manualmente para user ${user._id}`);
            return res.json({ success: true, plan: result.plan, validUntil: result.validUntil });
        }

        return res.json({ success: false, status: payment.status });

    } catch (error) {
        logger.error(`Erro Sync Payment: ${error.message}`);
        next(error);
    }
};

/**
 * Redundância ao webhook para o retorno da SPA no fluxo recorrente. O back_url do
 * preapproval devolve `preapproval_id`, não `payment_id` — sem isto, a tela de
 * sucesso ficaria presa em "processando" até o webhook chegar.
 */
export const syncPreapproval = async (req, res, next) => {
    try {
        const { preapprovalId } = req.body;
        const userId = req.user.id;

        const preapproval = await paymentService.getPreapproval(preapprovalId);
        if (!preapproval) {
            return res.status(404).json({ message: "Assinatura não encontrada no Mercado Pago." });
        }

        // Mesma verificação de posse do syncPayment: o id vem da query string do
        // browser, então nunca confiar nele sem conferir o external_reference.
        const { userId: refUserId } = parseExternalReference(preapproval.external_reference);
        if (refUserId !== userId) {
            return res.status(403).json({ message: "Esta assinatura não pertence a este usuário." });
        }

        if (preapproval.status !== 'authorized') {
            return res.json({ success: false, status: preapproval.status });
        }

        const user = await User.findById(userId);
        const result = await syncRecurringPeriod(user, preapproval);

        return res.json({
            success: true,
            plan: result.plan,
            validUntil: result.validUntil,
            nextBillingDate: user.nextBillingDate,
        });
    } catch (error) {
        logger.error(`Erro Sync Preapproval: ${error.message}`);
        next(error);
    }
};

export const getSubscriptionStatus = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id)
            .select('plan subscriptionStatus subscriptionType validUntil nextBillingDate cardBrand lastPaymentFailedAt mpSubscriptionId mpPreapprovalId bannerColor');
        const lastTransaction = await Transaction.findOne({ user: req.user.id }).sort({ createdAt: -1 });

        res.json({
            // paymentMethod (3.22): método do último pagamento (CREDIT_CARD|PIX|CRYPTO),
            // exposto p/ a UI escolher o ícone. null quando ainda não houve transação.
            current: { ...user.toObject(), paymentMethod: lastTransaction?.method || null },
            lastPayment: lastTransaction
        });
    } catch (error) {
        next(error);
    }
};
