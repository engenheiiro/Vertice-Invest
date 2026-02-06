
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import logger from '../config/logger.js';
import { paymentService } from '../services/paymentService.js';

export const handleMercadoPagoWebhook = async (req, res) => {
    try {
        const { type, data } = req.body;
        // O Mercado Pago envia o ID do recurso no campo 'data.id' ou diretamente no query param em alguns casos
        // Para preapproval (assinatura), o tópico geralmente é 'subscription_preapproval'
        
        const topic = req.body.type || req.query.topic;
        const resourceId = (data && data.id) || req.query.id;

        logger.info(`🔔 Webhook MP Recebido: Tópico [${topic}] ID [${resourceId}]`);

        if (topic === 'subscription_preapproval') {
            // Verifica o status real na API do Mercado Pago para evitar fraudes de payload
            const subscription = await paymentService.getSubscriptionStatus(resourceId);
            
            if (!subscription) {
                logger.warn(`Webhook: Assinatura ${resourceId} não encontrada na API.`);
                return res.status(200).send('OK'); // Responde OK para parar de receber retentativas
            }

            const userId = subscription.external_reference;
            const status = subscription.status; // authorized, paused, cancelled
            
            // Mapeamento de Planos reverso (simples, baseado no valor ou título)
            // Em produção ideal, teríamos um ID do plano no external_reference composto "USERID|PLANID"
            // Aqui vamos inferir pelo valor para manter compatibilidade com o código anterior
            const amount = subscription.auto_recurring.transaction_amount;
            let plan = 'ESSENTIAL';
            if (amount > 100 && amount < 300) plan = 'PRO';
            if (amount > 300) plan = 'BLACK';

            const user = await User.findById(userId);
            
            if (!user) {
                logger.error(`Webhook: Usuário ${userId} não encontrado.`);
                return res.status(200).send('OK');
            }

            if (status === 'authorized') {
                logger.info(`✅ Assinatura Aprovada para ${user.email}. Plano: ${plan}`);
                
                // Atualiza Usuário
                user.plan = plan;
                user.subscriptionStatus = 'ACTIVE';
                user.mpSubscriptionId = resourceId;
                user.mpCustomerId = subscription.payer_id;
                
                // Define validade para +32 dias (margem de segurança)
                const validUntil = new Date();
                validUntil.setDate(validUntil.getDate() + 32);
                user.validUntil = validUntil;
                
                await user.save();

                // Registra Transação para Histórico
                await Transaction.create({
                    user: user._id,
                    plan: plan,
                    amount: amount,
                    status: 'PAID',
                    method: 'MERCADO_PAGO_SUB',
                    gatewayId: resourceId
                });

            } else if (status === 'cancelled' || status === 'paused') {
                logger.warn(`⚠️ Assinatura Cancelada/Pausada para ${user.email}`);
                user.subscriptionStatus = 'CANCELED'; // Ou PAST_DUE
                await user.save();
            }
        }

        // Responde 200 OK rapidamente para o Mercado Pago não reenviar
        res.status(200).send('OK');

    } catch (error) {
        logger.error(`🔥 Erro Webhook MP: ${error.message}`);
        // Mesmo com erro interno, respondemos 200 ou 500 dependendo da estratégia. 
        // Se for erro de código nosso, 500 fará o MP tentar de novo.
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
