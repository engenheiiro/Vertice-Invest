
import crypto from 'crypto';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import logger from '../config/logger.js';
import { paymentService } from '../services/paymentService.js';
import {
    grantOneTimePeriod,
    syncRecurringPeriod,
    recordRecurringCharge,
    markPaymentFailed,
    markSubscriptionCanceled,
    parseExternalReference,
    resolvePlanKey,
} from '../services/subscriptionService.js';
import {
    sendCheckoutConfirmationEmail,
    sendSubscriptionCreatedEmail,
    sendRenewalReceiptEmail,
    sendPaymentFailedEmail,
    sendSubscriptionCanceledEmail,
} from '../services/emailService.js';

// --- MELHORIA 3: VALIDAÇÃO DE ASSINATURA HMAC ---
// Janela fixa, interna ao serviço: não cria nem exige uma nova variável de ambiente.
const WEBHOOK_MAX_AGE_SECONDS = 300;

// Idade do `ts` da assinatura, em segundos. Separa "chegou fora da janela de
// replay" (idade > WEBHOOK_MAX_AGE_SECONDS) de "o HMAC não confere".
const describeSignatureAge = (signature) => {
    const ts = Number(/(?:^|,)\s*ts=([^,]+)/.exec(signature ?? '')?.[1]);
    if (!Number.isSafeInteger(ts)) return null;
    return Math.floor(Date.now() / 1000) - ts;
};

// O `sanitizeInput` global apaga de req.query toda chave com ponto (defesa contra
// dotted-path no Mongo) — e `data.id`, o nome oficial do parâmetro no webhook
// moderno, tem ponto. Resultado: `req.query['data.id']` era SEMPRE undefined em
// produção, e o id que o MP assina nunca chegava à verificação. Aqui lemos a
// query crua da URL original, só neste controller e só para estas chaves, sem
// reabrir a chave pontuada para o resto da aplicação. Valor repetido
// (`?data.id=a&data.id=b`) é ambíguo e vira "ausente" — fail-closed.
const readRawQueryParam = (req, name) => {
    const url = typeof req.originalUrl === 'string' ? req.originalUrl : null;
    if (url) {
        try {
            const values = new URL(url, 'http://webhook.local').searchParams.getAll(name);
            return values.length === 1 && values[0] !== '' ? values[0] : null;
        } catch {
            return null;
        }
    }
    // Sem URL original (chamada direta em teste): usa a query já parseada, mas só
    // se for escalar — array/objeto vindo de query nunca é um id válido.
    const value = req.query?.[name];
    return typeof value === 'string' && value !== '' ? value : null;
};

const asIdString = (value) => (
    (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value))
        ? String(value)
        : null
);

/**
 * Id do recurso que a notificação pede para processar. Todas as fontes presentes
 * (body `data.id`, query `data.id`, query `id`) precisam concordar: se divergem,
 * não há um id único que a assinatura possa cobrir e a notificação é recusada.
 */
export const resolveNotificationId = (req) => {
    const bodyId = asIdString(req.body?.data?.id);
    const queryDataId = readRawQueryParam(req, 'data.id');
    const queryId = readRawQueryParam(req, 'id');
    const present = [bodyId, queryDataId, queryId].filter(Boolean);
    const normalized = new Set(present.map((id) => id.toLowerCase()));
    return {
        id: present[0] ?? null,
        conflict: normalized.size > 1,
        hasDataId: Boolean(bodyId || queryDataId),
    };
};

// Assinaturas no formato legado (manifesto SEM o trecho "id:...;") não amarram o
// recurso: o mesmo par (request-id, ts, v1) capturado poderia ser reenviado
// dentro da janela de 5 min com QUALQUER id. Para fechar esse replay, cada
// assinatura sem id fica presa ao primeiro id com que foi usada; reentregas do
// MP com o mesmo id continuam passando, troca de id é recusada. Memória do
// processo, limpa pela própria janela.
const unboundSignatureUse = new Map();

const bindUnboundSignature = (key, id) => {
    const nowMs = Date.now();
    for (const [k, entry] of unboundSignatureUse) {
        if (entry.expiresAt <= nowMs) unboundSignatureUse.delete(k);
    }
    const normalizedId = String(id).toLowerCase();
    const existing = unboundSignatureUse.get(key);
    if (existing) return existing.id === normalizedId;
    unboundSignatureUse.set(key, { id: normalizedId, expiresAt: nowMs + (WEBHOOK_MAX_AGE_SECONDS * 2 * 1000) });
    return true;
};

/**
 * Verifica o HMAC e devolve QUAL id ele autoriza. O handler só processa esse id:
 * antes, a verificação aceitava a assinatura e o handler escolhia o id por conta
 * própria — com o manifesto sem id sempre entre as candidatas, uma assinatura
 * legítima capturada servia para qualquer `data.id`.
 *
 * Retorno: `{ valid, resourceId }`; quando inválida, `resourceId` é null.
 */
export const verifyWebhookSignature = (req) => {
    const signature = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
    const rejected = { valid: false, resourceId: null };

    const { id: notificationId, conflict, hasDataId } = resolveNotificationId(req);
    // Fontes de id que discordam entre si: nenhuma assinatura cobre as duas.
    if (conflict) return rejected;

    // Sem secret: fail-CLOSED em produção (rejeita) para impedir spoof de pagamento.
    // Em dev/test, permite passar para não travar setups locais.
    if (!WEBHOOK_SECRET) {
        if (process.env.NODE_ENV === 'production') {
            logger.error("⛔ Webhook MP rejeitado: MP_WEBHOOK_SECRET não configurado em produção.");
            return rejected;
        }
        logger.warn("⚠️ Webhook sem segredo (MP_WEBHOOK_SECRET) — liberado apenas em ambiente não-produção.");
        return { valid: true, resourceId: notificationId };
    }

    if (typeof signature !== 'string' || typeof requestId !== 'string' || !signature || !requestId) return rejected;

    // Formato x-signature: "ts=123456789,v1=hash..."
    const parts = signature.split(',');
    let ts = null;
    let v1 = null;

    parts.forEach(p => {
        const [k, v] = p.split('=').map((piece) => piece?.trim());
        if (k === 'ts') ts = v;
        if (k === 'v1') v1 = v;
    });

    if (!ts || !v1) return rejected;

    // A assinatura também precisa ser recente. Sem essa janela, uma requisição
    // legítima capturada poderia ser repetida indefinidamente.
    const timestamp = Number(ts);
    if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_MAX_AGE_SECONDS) {
        return rejected;
    }

    const received = Buffer.from(v1, 'hex');

    const matches = (manifest) => {
        const calculated = crypto.createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex');
        const expected = Buffer.from(calculated, 'hex');
        // Comparação constant-time (evita timing attack na verificação).
        return expected.length === received.length && crypto.timingSafeEqual(expected, received);
    };

    // Template assinado: "id:[data.id];request-id:[x-request-id];ts:[ts];". O MP
    // assina ids alfanuméricos em minúsculas, então as duas grafias são testadas
    // — ambas são o MESMO id que vai ser processado.
    if (notificationId) {
        const variants = [...new Set([notificationId, notificationId.toLowerCase()])];
        if (variants.some((id) => matches(`id:${id};request-id:${requestId};ts:${ts};`))) {
            return { valid: true, resourceId: notificationId };
        }
    }

    // Formato legado: a regra do MP é OMITIR o trecho cujo valor não veio na
    // notificação. O IPN legado (?topic=payment&id=X) não traz `data.id`, então é
    // assinado SEM o "id:...;" — rejeitá-lo fazia o MP retentar em loop o mesmo
    // pagamento (visto em produção). Mas só vale para quem de fato NÃO tem
    // `data.id`: uma notificação moderna cujo HMAC só confere sem o id é uma
    // assinatura reaproveitada com o id trocado. E, como esse manifesto não
    // amarra o recurso, a assinatura fica presa ao primeiro id com que chegou.
    if (!hasDataId && matches(`request-id:${requestId};ts:${ts};`)) {
        if (!notificationId) return { valid: true, resourceId: null };
        if (bindUnboundSignature(`${requestId}|${ts}|${v1.toLowerCase()}`, notificationId)) {
            return { valid: true, resourceId: notificationId };
        }
    }

    return rejected;
};

export const isValidSignature = (req) => verifyWebhookSignature(req).valid;

// Meios que o Mercado Pago NÃO consegue cobrar de forma recorrente. Um pagamento
// por aqui é sempre avulso, por definição.
const NON_RECURRING_PAYMENT_TYPES = new Set(['bank_transfer', 'ticket', 'atm']);

/**
 * Descobre se um pagamento nasceu de uma assinatura recorrente e devolve o
 * preapproval de origem. Não dá para confiar só em `user.subscriptionType`: na
 * PRIMEIRA cobrança o tópico `payment` pode chegar antes do
 * `subscription_preapproval`, com o usuário ainda marcado como ONE_TIME — e aí o
 * crédito aditivo somaria 30 dias por cima do calendário do MP.
 *
 * Mas o inverso também morde: sem o corte por meio de pagamento, um Pix avulso de
 * quem JÁ teve assinatura cairia no caminho recorrente e o período viria de um
 * preapproval velho — o cliente pagaria e não receberia dia nenhum.
 */
export const resolvePreapprovalId = (payment, user) => {
    if (NON_RECURRING_PAYMENT_TYPES.has(payment?.payment_type_id)) return null;

    return payment?.metadata?.preapproval_id
        || payment?.metadata?.preapprovalId
        || (payment?.point_of_interaction?.type === 'SUBSCRIPTIONS' ? user?.mpPreapprovalId : null)
        // O estado do usuário só serve de pista enquanto a assinatura governa a
        // conta; uma cancelada não pode sequestrar uma compra avulsa posterior.
        || (user?.subscriptionType === 'RECURRING' && user?.subscriptionStatus !== 'CANCELED'
            ? user?.mpPreapprovalId
            : null)
        || null;
};

// Localiza o assinante de um evento de assinatura: primeiro pelo
// external_reference (fonte primária), depois pelo preapproval já vinculado.
const findSubscriber = async (externalReference, preapprovalId) => {
    const { userId } = parseExternalReference(externalReference);
    if (userId) {
        const byRef = await User.findById(userId).catch(() => null);
        if (byRef) return byRef;
    }
    if (preapprovalId) return User.findOne({ mpPreapprovalId: preapprovalId.toString() });
    return null;
};

// --- TÓPICO: subscription_preapproval (ciclo de vida da assinatura) ---
const handlePreapprovalEvent = async (preapprovalId) => {
    const preapproval = await paymentService.getPreapproval(preapprovalId);
    if (!preapproval) {
        logger.warn(`Webhook: preapproval ${preapprovalId} não encontrado na API.`);
        return;
    }

    const user = await findSubscriber(preapproval.external_reference, preapprovalId);
    if (!user) {
        logger.error(`❌ Assinante não encontrado para preapproval ${preapprovalId}.`);
        return;
    }

    const wasRecurring = user.subscriptionType === 'RECURRING';
    // Só o preapproval que REALMENTE governa a conta pode encerrá-la. Uma
    // tentativa de assinatura que morre antes de ser autorizada (cartão recusado
    // na 1ª cobrança → o MP cancela o preapproval) dispara este mesmo evento; sem
    // esta checagem, ela marcaria como CANCELED a assinatura anterior do usuário
    // — ou um plano que ele nem paga por aqui.
    const isActiveSubscription = user.mpPreapprovalId === preapprovalId.toString();

    switch (preapproval.status) {
        case 'authorized': {
            const { synced } = await syncRecurringPeriod(user, preapproval);
            // Só avisa na estreia — renovações têm o e-mail de recibo próprio. E
            // só se a assinatura de fato passou a governar a conta (um período
            // avulso pago em vigor pode ter prevalecido).
            if (synced && !wasRecurring) {
                await sendSubscriptionCreatedEmail(user.email, user.plan, user.nextBillingDate);
            }
            break;
        }
        case 'paused': {
            if (!isActiveSubscription || user.subscriptionStatus === 'PAUSED') break;
            await markSubscriptionCanceled(user, { status: 'PAUSED' });
            break;
        }
        case 'cancelled': {
            if (!isActiveSubscription) {
                logger.info(`ℹ️ Preapproval ${preapprovalId} cancelado sem nunca ter governado a conta. Assinatura do usuário intacta.`);
                break;
            }
            // O MP reentrega o mesmo evento várias vezes; sem esta guarda o
            // usuário recebe um e-mail de cancelamento por entrega.
            if (user.subscriptionStatus === 'CANCELED') break;

            // Acesso preservado até validUntil: cancelar interrompe a cobrança,
            // não estorna o período já pago.
            await markSubscriptionCanceled(user);
            await sendSubscriptionCanceledEmail(user.email, user.plan, user.validUntil);
            break;
        }
        default:
            logger.info(`ℹ️ Preapproval ${preapprovalId} em status "${preapproval.status}". Nenhuma ação.`);
    }
};

// --- TÓPICO: subscription_authorized_payment (cada cobrança mensal) ---
const handleAuthorizedPaymentEvent = async (authorizedPaymentId) => {
    const authorized = await paymentService.getAuthorizedPayment(authorizedPaymentId);
    if (!authorized) {
        logger.warn(`Webhook: authorized_payment ${authorizedPaymentId} não encontrado na API.`);
        return;
    }

    const preapprovalId = authorized.preapproval_id;
    const user = await findSubscriber(authorized.external_reference, preapprovalId);
    if (!user) {
        logger.error(`❌ Assinante não encontrado para authorized_payment ${authorizedPaymentId}.`);
        return;
    }

    // "processed" = cobrança liquidada. "recycling"/"rejected" = recusada, com
    // retentativas do MP em andamento.
    if (authorized.status !== 'processed') {
        // A recusa só afeta a conta se vier da assinatura que a governa. Uma
        // tentativa nova de assinar que é recusada não pode marcar como PAST_DUE
        // (nem gerar e-mail de) uma assinatura anterior que está saudável.
        if (user.mpPreapprovalId !== preapprovalId?.toString()) {
            logger.info(`ℹ️ Cobrança ${authorizedPaymentId} recusada em assinatura que não governa a conta. Ignorada.`);
            return;
        }
        // O MP reentrega o mesmo evento várias vezes; sem esta guarda o usuário
        // recebe um e-mail de cobrança recusada por entrega.
        if (user.subscriptionStatus === 'PAST_DUE') return;

        await markPaymentFailed(user);
        await sendPaymentFailedEmail(user.email, user.plan, user.validUntil);
        return;
    }

    const preapproval = await paymentService.getPreapproval(preapprovalId);
    const { planKey } = parseExternalReference(authorized.external_reference || preapproval?.external_reference);

    // gatewayId = id do PAGAMENTO real (não do authorized_payment). É o mesmo id
    // que o tópico `payment` usaria, então o índice único cobre os dois caminhos
    // e a cobrança entra no extrato uma única vez.
    const paymentId = authorized.payment?.id || authorizedPaymentId;
    const isNewCharge = await recordRecurringCharge(user, {
        gatewayId: paymentId,
        amount: authorized.transaction_amount ?? authorized.payment?.transaction_amount,
        plan: planKey || user.plan,
    });

    if (preapproval) await syncRecurringPeriod(user, preapproval);

    if (isNewCharge) {
        await sendRenewalReceiptEmail(user.email, user.plan, user.validUntil, authorized.transaction_amount);
    }
};

// --- TÓPICO: payment (avulso Pix/boleto e também cobranças de assinatura) ---
const handlePaymentEvent = async (resourceId) => {
    // Fast-path de idempotência; a garantia real é o índice único em gatewayId.
    const existingTransaction = await Transaction.findOne({ gatewayId: resourceId.toString() });
    if (existingTransaction) {
        logger.info(`♻️ Pagamento ${resourceId} já processado anteriormente. Ignorando.`);
        return;
    }

    const payment = await paymentService.getPaymentStatus(resourceId);
    if (!payment) {
        logger.warn(`Webhook: Pagamento ${resourceId} não encontrado na API.`);
        return;
    }

    const { userId, planKey } = parseExternalReference(payment.external_reference);
    const plan = resolvePlanKey(planKey);

    logger.info(`💰 Pagamento ${resourceId}: Status=${payment.status} | User=${userId} | Valor=${payment.transaction_amount} | Plano=${plan}`);

    if (payment.status !== 'approved' || !userId) return;

    const user = await User.findById(userId);
    if (!user) {
        logger.error(`❌ Usuário ${userId} não encontrado para liberar acesso.`);
        return;
    }

    const preapprovalId = resolvePreapprovalId(payment, user);

    if (preapprovalId) {
        // Cobrança de assinatura: registra o extrato e deixa o PERÍODO vir do MP.
        const isNewCharge = await recordRecurringCharge(user, {
            gatewayId: resourceId,
            amount: payment.transaction_amount,
            plan: planKey || user.plan,
        });
        const preapproval = await paymentService.getPreapproval(preapprovalId);
        if (preapproval) await syncRecurringPeriod(user, preapproval);
        if (isNewCharge) {
            await sendRenewalReceiptEmail(user.email, user.plan, user.validUntil, payment.transaction_amount);
        }
        return;
    }

    const result = await grantOneTimePeriod(user, planKey, {
        gatewayId: resourceId,
        amount: payment.transaction_amount,
        method: payment.payment_type_id === 'bank_transfer' ? 'PIX' : 'CREDIT_CARD',
    });

    if (result.credited) {
        await sendCheckoutConfirmationEmail(user.email, result.plan, result.validUntil, { cycle: result.cycle });
        logger.info(`✅ Acesso liberado para user ${user._id} até ${result.validUntil.toISOString()}`);
    }
};

export const handleMercadoPagoWebhook = async (req, res) => {
    try {
        const { type } = req.body || {};

        // Toda variação de notificação (body ou query) precisa de assinatura.
        // Nunca processe um id de pagamento antes de validar o HMAC e o timestamp.
        // O id processado é o que a assinatura autorizou — nunca outro lido à parte.
        const verification = verifyWebhookSignature(req);
        if (!verification.valid) {
            const rawDataId = readRawQueryParam(req, 'data.id');
            const rawId = readRawQueryParam(req, 'id');
            // Detalha o formato recebido: notificações IPN legadas chegam sem
            // x-signature e são rejeitadas aqui, enquanto o webhook moderno da
            // MESMA cobrança chega assinado logo depois. Sem estes campos, os dois
            // casos ficam indistinguíveis no log e parecem perda de pagamento.
            logger.warn('⛔ Webhook MP rejeitado: assinatura inválida ou expirada.', {
                ip: req.ip,
                topic: req.body?.type || req.query?.topic || null,
                resourceId: req.body?.data?.id || rawDataId || rawId || null,
                hasSignature: Boolean(req.headers['x-signature']),
                hasRequestId: Boolean(req.headers['x-request-id']),
                // Discrimina as duas hipóteses restantes para a MESMA cobrança
                // chegar duas vezes, uma válida e outra não:
                // - formatos diferentes  → a montagem do manifesto é a culpada;
                // - formatos IGUAIS      → o segredo é que diverge (duas
                //   configurações de webhook no painel, cada uma com sua chave,
                //   apontando para a mesma URL).
                idSource: req.body?.data?.id ? 'body'
                    : rawDataId ? 'query:data.id'
                    : rawId ? 'query:id' : 'ausente',
                signatureAgeSeconds: describeSignatureAge(req.headers['x-signature']),
            });
            return res.status(401).send('Invalid signature');
        }

        const topic = type || req.query?.topic;
        const resourceId = verification.resourceId;

        if (!topic || !resourceId) {
            logger.warn(`Webhook MP rejeitado: tópico ou recurso ausente. IP: ${req.ip}`);
            return res.status(400).send('Invalid notification');
        }

        logger.info(`🔔 Webhook MP Recebido: Tópico [${topic}] ID [${resourceId}]`);

        switch (topic) {
            case 'payment':
                await handlePaymentEvent(resourceId);
                break;
            case 'subscription_preapproval':
                await handlePreapprovalEvent(resourceId);
                break;
            case 'subscription_authorized_payment':
                await handleAuthorizedPaymentEvent(resourceId);
                break;
            default:
                // Tópicos não assinados (merchant_order, plan, ...) são apenas ACKados
                // para o MP não ficar reentregando.
                break;
        }

        res.status(200).send('OK');

    } catch (error) {
        logger.error(`🔥 Erro Webhook MP: ${error.message}`);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
