
import crypto from 'crypto';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import logger from '../config/logger.js';
import { paymentService } from '../services/paymentService.js';
import { TEST_PLAN_MAP } from '../config/subscription.js';
import { invalidateUser } from '../utils/userCache.js'; // (I6) bust de cache de plano
import { sendCheckoutConfirmationEmail } from '../services/emailService.js';

// --- MELHORIA 3: VALIDAÇÃO DE ASSINATURA HMAC ---
// Janela fixa, interna ao serviço: não cria nem exige uma nova variável de ambiente.
const WEBHOOK_MAX_AGE_SECONDS = 300;

export const isValidSignature = (req) => {
    const signature = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;

    // Sem secret: fail-CLOSED em produção (rejeita) para impedir spoof de pagamento.
    // Em dev/test, permite passar para não travar setups locais.
    if (!WEBHOOK_SECRET) {
        if (process.env.NODE_ENV === 'production') {
            logger.error("⛔ Webhook MP rejeitado: MP_WEBHOOK_SECRET não configurado em produção.");
            return false;
        }
        logger.warn("⚠️ Webhook sem segredo (MP_WEBHOOK_SECRET) — liberado apenas em ambiente não-produção.");
        return true;
    }

    if (!signature || !requestId) return false;

    // Formato x-signature: "ts=123456789,v1=hash..."
    const parts = signature.split(',');
    let ts = null;
    let v1 = null;

    parts.forEach(p => {
        const [k, v] = p.split('=');
        if (k === 'ts') ts = v;
        if (k === 'v1') v1 = v;
    });

    if (!ts || !v1) return false;

    // A assinatura também precisa ser recente. Sem essa janela, uma requisição
    // legítima capturada poderia ser repetida indefinidamente.
    const timestamp = Number(ts);
    if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_MAX_AGE_SECONDS) {
        return false;
    }

    // Template assinado: "id:[data.id];request-id:[x-request-id];ts:[ts];"
    const dataId = req.body?.data?.id || req.query.id;
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;

    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
    hmac.update(manifest);
    const calculatedSignature = hmac.digest('hex');

    // Comparação constant-time (evita timing attack na verificação da assinatura).
    try {
        const a = Buffer.from(calculatedSignature, 'hex');
        const b = Buffer.from(v1, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
};

// Extrai userId e planKey do external_reference no formato "{userId}:{planKey}"
const parseExternalReference = (rawRef) => {
    if (!rawRef) return { userId: null, planKey: null };
    const colonIdx = rawRef.indexOf(':');
    if (colonIdx === -1) return { userId: rawRef, planKey: null };
    return {
        userId: rawRef.substring(0, colonIdx),
        planKey: rawRef.substring(colonIdx + 1),
    };
};

export const handleMercadoPagoWebhook = async (req, res) => {
    try {
        const { type, data } = req.body;

        // Toda variação de notificação (body ou query) precisa de assinatura.
        // Nunca processe um id de pagamento antes de validar o HMAC e o timestamp.
        if (!isValidSignature(req)) {
            logger.warn(`⛔ Webhook MP rejeitado: assinatura inválida ou expirada. IP: ${req.ip}`);
            return res.status(401).send('Invalid signature');
        }

        const topic = type || req.query.topic;
        const resourceId = (data && data.id) || req.query.id;

        if (!topic || !resourceId) {
            logger.warn(`Webhook MP rejeitado: tópico ou recurso ausente. IP: ${req.ip}`);
            return res.status(400).send('Invalid notification');
        }

        logger.info(`🔔 Webhook MP Recebido: Tópico [${topic}] ID [${resourceId}]`);

        if (topic === 'payment') {

            // 1. IDEMPOTÊNCIA: Verifica se já processamos essa transação
            const existingTransaction = await Transaction.findOne({ gatewayId: resourceId.toString() });
            if (existingTransaction) {
                logger.info(`♻️ Pagamento ${resourceId} já processado anteriormente. Ignorando.`);
                return res.status(200).send('OK');
            }

            // 2. Busca status real na API
            const payment = await paymentService.getPaymentStatus(resourceId);

            if (!payment) {
                logger.warn(`Webhook: Pagamento ${resourceId} não encontrado na API.`);
                return res.status(200).send('OK');
            }

            const status = payment.status;
            const amount = payment.transaction_amount;

            // external_reference no formato "{userId}:{planKey}" (ex: "abc123:ESSENTIAL_TEST")
            const { userId, planKey } = parseExternalReference(payment.external_reference);

            // Resolve plano de teste → plano real (ex: ESSENTIAL_TEST → ESSENTIAL)
            const plan = TEST_PLAN_MAP[planKey] || planKey || 'ESSENTIAL';

            logger.info(`💰 Pagamento ${resourceId}: Status=${status} | User=${userId} | Valor=${amount} | Plano=${plan}${TEST_PLAN_MAP[planKey] ? ' (teste)' : ''}`);

            if (status === 'approved' && userId) {
                const user = await User.findById(userId);

                if (user) {
                    // Barreira de idempotência ATÔMICA: cria a Transaction ANTES de
                    // estender o plano. O índice único em gatewayId faz a 2ª entrega
                    // concorrente do MP falhar com E11000 aqui — nunca creditando +30
                    // dias duas vezes nem duplicando o registro de cobrança. O findOne
                    // acima é apenas fast-path; esta é a garantia real.
                    try {
                        await Transaction.create({
                            user: user._id,
                            plan: plan,
                            amount: amount,
                            status: 'PAID',
                            method: payment.payment_type_id === 'bank_transfer' ? 'PIX' : 'CREDIT_CARD',
                            gatewayId: resourceId.toString()
                        });
                    } catch (e) {
                        if (e.code === 11000) {
                            logger.info(`♻️ Pagamento ${resourceId} já processado (índice único). Ignorando.`);
                            return res.status(200).send('OK');
                        }
                        throw e;
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
                    user.mpSubscriptionId = resourceId.toString();

                    await user.save();
                    invalidateUser(user._id); // (I6) plano mudou → derruba cache do authMiddleware

                    await sendCheckoutConfirmationEmail(user.email, plan, newValidUntil);

                    logger.info(`✅ Acesso liberado para user ${user._id} até ${newValidUntil.toISOString()}`);
                } else {
                    logger.error(`❌ Usuário ${userId} não encontrado para liberar acesso.`);
                }
            }
        }

        res.status(200).send('OK');

    } catch (error) {
        logger.error(`🔥 Erro Webhook MP: ${error.message}`);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
