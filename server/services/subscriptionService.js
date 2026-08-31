
import Transaction from '../models/Transaction.js';
import logger from '../config/logger.js';
import { PLANS, basePlanOf, RECURRING_GRACE_DAYS } from '../config/subscription.js';
import { paymentService } from './paymentService.js';
import { invalidateUser } from '../utils/userCache.js';

/**
 * Regras de período de acesso da assinatura — fonte única.
 *
 * Existem dois regimes, e a diferença entre eles é deliberada:
 *
 * - ONE_TIME (Pix/boleto): ADITIVO. Cada pagamento aprovado soma `PLANS[plan].days`
 *   ao que ainda resta. A defesa contra crédito duplicado é o índice único em
 *   `Transaction.gatewayId`.
 *
 * - RECURRING (cartão/PreApproval): ABSOLUTO. O período vem sempre do próprio
 *   Mercado Pago (`preapproval.next_payment_date`), nunca de uma soma local. O MP
 *   notifica a mesma cobrança por mais de um tópico (`payment` e
 *   `subscription_authorized_payment`), então somar dias por evento acabaria
 *   creditando dois meses. Sendo absoluto, reprocessar é inofensivo por
 *   construção e o nosso calendário nunca diverge do calendário de cobrança dele.
 */

// Resolve qualquer variante de checkout (ESSENTIAL_TEST, PRO_ANNUAL,
// PRO_ANNUAL_TEST) para o plano real creditado. Chave desconhecida volta como
// veio — external_reference antigo continua sendo lido.
export const resolvePlanKey = (planKey) => basePlanOf(planKey) || planKey || 'ESSENTIAL';

const MS_PER_DAY = 86_400_000;

/**
 * Data em que o acesso realmente cai, incluindo a carência de assinaturas
 * recorrentes. Assinatura cancelada não ganha carência: o usuário já sabe que a
 * cobrança parou e o acesso vale exatamente até o fim do período pago.
 */
export const getAccessDeadline = (user) => {
    if (!user?.validUntil) return null;
    const deadline = new Date(user.validUntil);
    if (user.subscriptionType === 'RECURRING' && user.subscriptionStatus !== 'CANCELED') {
        deadline.setTime(deadline.getTime() + RECURRING_GRACE_DAYS * MS_PER_DAY);
    }
    return deadline;
};

/**
 * Regra única de expiração, usada pelo authMiddleware (cache + downgrade) e pelo
 * cron diário. GUEST não expira (não tem o que perder) e ADMIN nunca é rebaixado.
 */
export const isSubscriptionExpired = (user, now = new Date()) => {
    if (!user) return false;
    if (user.plan === 'GUEST' || user.role === 'ADMIN') return false;
    const deadline = getAccessDeadline(user);
    return !deadline || deadline < now;
};

/**
 * Encerra no Mercado Pago a assinatura mensal de quem acabou de comprar um
 * período avulso (Pix, boleto ou o anual parcelado). Sem isso, quem migra do
 * mensal para o anual fica com o preapproval autorizado e é cobrado DUAS vezes:
 * o anual à vista e a mensalidade de novo no aniversário.
 *
 * Nunca lança: o período já foi pago e creditado, e negar acesso por causa de
 * uma falha no cancelamento seria punir o cliente pelo nosso problema. Falhar
 * aqui vira log de erro — é cobrança indevida esperando alguém agir.
 */
const stopRecurringAfterOneTime = async (user) => {
    const preapprovalId = user.mpPreapprovalId;
    if (!preapprovalId || user.subscriptionStatus === 'CANCELED') return;

    try {
        const canceled = await paymentService.cancelPreapproval(preapprovalId);
        if (canceled) {
            logger.info('🔕 Assinatura mensal encerrada por compra avulsa', {
                userId: user._id.toString(), preapprovalId,
            });
            return;
        }
        logger.error('🔥 Preapproval NÃO cancelado após compra avulsa — risco de cobrança dupla', {
            userId: user._id.toString(), preapprovalId,
        });
    } catch (error) {
        logger.error('🔥 Erro ao cancelar preapproval após compra avulsa — risco de cobrança dupla', {
            userId: user._id.toString(), preapprovalId, error: error.message,
        });
    }
};

/**
 * Credita um período avulso (Pix/boleto/anual parcelado). Cria a Transaction
 * ANTES de estender o plano: o índice único em gatewayId faz a 2ª entrega
 * concorrente do MP falhar com E11000 aqui, nunca creditando os dias duas vezes.
 *
 * @returns {{ credited: boolean, duplicated?: boolean, plan?: string, validUntil?: Date }}
 */
export const grantOneTimePeriod = async (user, planKey, { gatewayId, amount, method }) => {
    const plan = resolvePlanKey(planKey);
    const days = PLANS[planKey]?.days ?? PLANS[plan]?.days ?? 30;

    try {
        await Transaction.create({
            user: user._id,
            plan,
            amount,
            status: 'PAID',
            method,
            gatewayId: gatewayId?.toString(),
        });
    } catch (e) {
        if (e.code === 11000) {
            logger.info(`♻️ Pagamento ${gatewayId} já processado (índice único). Ignorando.`);
            return { credited: false, duplicated: true };
        }
        throw e;
    }

    // Só depois da barreira de idempotência: uma reentrega do mesmo pagamento
    // volta acima e não tenta cancelar duas vezes.
    await stopRecurringAfterOneTime(user);

    const now = new Date();
    const base = user.validUntil && new Date(user.validUntil) > now
        ? new Date(user.validUntil)
        : new Date(now);
    base.setDate(base.getDate() + days);

    user.plan = plan;
    user.subscriptionStatus = 'ACTIVE';
    user.subscriptionType = 'ONE_TIME';
    user.billingCycle = PLANS[planKey]?.cycle ?? 'MONTHLY';
    user.validUntil = base;
    user.mpSubscriptionId = gatewayId?.toString();
    // Compra avulsa não renova: zera o calendário recorrente para a UI não
    // prometer uma cobrança que não vai acontecer.
    user.nextBillingDate = undefined;
    user.lastPaymentFailedAt = undefined;

    await user.save();
    invalidateUser(user._id);

    logger.info('✅ Período avulso creditado', {
        userId: user._id.toString(), plan, days, cycle: user.billingCycle,
        validUntil: base.toISOString(),
    });

    // O ciclo volta junto porque o recibo precisa dele: anual é cobrança única
    // de 12 meses e não pode ser anunciado como mensalidade.
    return { credited: true, plan, validUntil: base, cycle: user.billingCycle };
};

/**
 * Alinha o usuário ao estado autoritativo do preapproval no MP. Idempotente:
 * chamar duas vezes com o mesmo objeto produz exatamente o mesmo `validUntil`.
 *
 * `next_payment_date` é a data da PRÓXIMA cobrança — ou seja, exatamente até
 * quando o período já pago cobre. Por isso vira o `validUntil` diretamente.
 */
export const syncRecurringPeriod = async (user, preapproval) => {
    if (!preapproval) return { synced: false };

    const { planKey } = parseExternalReference(preapproval.external_reference);
    const plan = resolvePlanKey(planKey);
    const nextPayment = preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : null;

    user.plan = plan;
    user.subscriptionType = 'RECURRING';
    // A recorrência do MP (PreApproval) só existe no ciclo mensal — o anual é
    // sempre compra avulsa parcelada.
    user.billingCycle = 'MONTHLY';
    user.subscriptionStatus = 'ACTIVE';
    user.mpPreapprovalId = preapproval.id?.toString();
    if (preapproval.payment_method_id) user.cardBrand = preapproval.payment_method_id;
    user.lastPaymentFailedAt = undefined;

    if (nextPayment && !Number.isNaN(nextPayment.getTime())) {
        user.nextBillingDate = nextPayment;
        user.validUntil = nextPayment;
    } else if (!user.validUntil) {
        // Autorização sem data de próxima cobrança (raro): garante um período
        // mínimo para o assinante não ficar sem acesso enquanto o MP não informa.
        const fallback = new Date();
        fallback.setDate(fallback.getDate() + (PLANS[plan]?.days ?? 30));
        user.validUntil = fallback;
    }

    await user.save();
    invalidateUser(user._id);

    logger.info('🔁 Assinatura recorrente sincronizada', {
        userId: user._id.toString(),
        plan,
        preapprovalId: user.mpPreapprovalId,
        validUntil: user.validUntil?.toISOString(),
    });

    return { synced: true, plan, validUntil: user.validUntil };
};

/**
 * Registra a cobrança recorrente no extrato. Separado de syncRecurringPeriod
 * porque o período é absoluto (vem do preapproval) mas o extrato é aditivo:
 * uma linha por cobrança, com a mesma barreira de idempotência do fluxo avulso.
 *
 * @returns {boolean} false se essa cobrança já estava registrada.
 */
export const recordRecurringCharge = async (user, { gatewayId, amount, plan }) => {
    try {
        await Transaction.create({
            user: user._id,
            plan: resolvePlanKey(plan),
            amount,
            status: 'PAID',
            method: 'CREDIT_CARD',
            gatewayId: gatewayId?.toString(),
        });
        return true;
    } catch (e) {
        if (e.code === 11000) {
            logger.info(`♻️ Cobrança recorrente ${gatewayId} já registrada. Ignorando.`);
            return false;
        }
        throw e;
    }
};

/**
 * Marca falha de cobrança recorrente. NÃO rebaixa o plano: o MP ainda vai
 * retentar ("recycling") e a carência de RECURRING_GRACE_DAYS cobre a janela.
 */
export const markPaymentFailed = async (user) => {
    user.subscriptionStatus = 'PAST_DUE';
    user.lastPaymentFailedAt = new Date();
    await user.save();
    invalidateUser(user._id);
    logger.warn('⚠️ Cobrança recorrente recusada', {
        userId: user._id.toString(), preapprovalId: user.mpPreapprovalId,
    });
};

/**
 * Encerra a recorrência preservando o acesso já pago. O usuário continua com o
 * plano até `validUntil` — cancelar não é estornar.
 */
export const markSubscriptionCanceled = async (user, { status = 'CANCELED' } = {}) => {
    user.subscriptionStatus = status;
    user.nextBillingDate = undefined;
    await user.save();
    invalidateUser(user._id);
    logger.info('🔕 Assinatura encerrada', {
        userId: user._id.toString(),
        status,
        accessUntil: user.validUntil?.toISOString(),
    });
};

// external_reference no formato "{userId}:{planKey}" — compartilhado entre
// Preference (avulso) e PreApproval (recorrente).
export const parseExternalReference = (rawRef) => {
    if (!rawRef) return { userId: null, planKey: null };
    const colonIdx = rawRef.indexOf(':');
    if (colonIdx === -1) return { userId: rawRef, planKey: null };
    return {
        userId: rawRef.substring(0, colonIdx),
        planKey: rawRef.substring(colonIdx + 1),
    };
};
