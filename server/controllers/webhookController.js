
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import logger from '../config/logger.js';
import { paymentService } from '../services/paymentService.js';

export const handleMercadoPagoWebhook = async (req, res) => {
    try {
        const { type, data } = req.body;
        
        // No Checkout Pro, o tópico principal é 'payment'
        // O MP pode enviar 'type' no body ou 'topic' na query string
        const topic = type || req.query.topic;
        const resourceId = (data && data.id) || req.query.id;

        logger.info(`🔔 Webhook MP Recebido: Tópico [${topic}] ID [${resourceId}]`);

        // Ignora tópicos que não sejam pagamento (ex: merchant_order criado)
        if (topic === 'payment') {
            
            // Busca detalhes do pagamento na API do MP para garantir segurança
            const payment = await paymentService.getPaymentStatus(resourceId);
            
            if (!payment) {
                logger.warn(`Webhook: Pagamento ${resourceId} não encontrado na API.`);
                return res.status(200).send('OK');
            }

            const status = payment.status; // approved, pending, rejected
            const userId = payment.external_reference; // Recuperamos o ID do usuário daqui
            
            // Descobre qual plano foi comprado baseado no valor
            // Lógica ajustada para PREÇOS DE PRODUÇÃO
            const amount = payment.transaction_amount;
            let plan = 'ESSENTIAL'; // Default
            
            // Faixas de segurança para evitar erro de float ou pequenas taxas
            if (amount >= 340) plan = 'BLACK';      // R$ 349,90
            else if (amount >= 110) plan = 'PRO';   // R$ 119,90
            else if (amount >= 30) plan = 'ESSENTIAL'; // R$ 39,90

            // Logs de Diagnóstico
            logger.info(`💰 Pagamento ${resourceId}: Status=${status} | User=${userId} | Valor=${amount} | Plano Detectado=${plan}`);

            if (status === 'approved' && userId) {
                const user = await User.findById(userId);
                
                if (user) {
                    // --- LÓGICA DE RENOVAÇÃO (MODELO PRÉ-PAGO) ---
                    // Adiciona 30 dias a partir de HOJE ou a partir do vencimento atual se ainda for válido
                    const now = new Date();
                    let newValidUntil = new Date(); // Começa com agora

                    // Se o usuário já tem uma assinatura válida no futuro, estendemos ela
                    if (user.validUntil && new Date(user.validUntil) > now) {
                        newValidUntil = new Date(user.validUntil);
                    }

                    // Adiciona 30 dias
                    newValidUntil.setDate(newValidUntil.getDate() + 30);

                    user.plan = plan;
                    user.subscriptionStatus = 'ACTIVE';
                    user.validUntil = newValidUntil;
                    user.mpSubscriptionId = resourceId.toString(); // Salva ID do pagamento como ref
                    
                    await user.save();
                    
                    logger.info(`✅ Acesso liberado para ${user.email} até ${newValidUntil.toISOString()}`);

                    // Registra Transação no Histórico
                    await Transaction.create({
                        user: user._id,
                        plan: plan,
                        amount: amount,
                        status: 'PAID',
                        method: payment.payment_type_id === 'bank_transfer' ? 'PIX' : 'CREDIT_CARD', // Detecta se foi PIX
                        gatewayId: resourceId.toString()
                    });
                } else {
                    logger.error(`❌ Usuário ${userId} não encontrado para liberar acesso.`);
                }
            }
        }

        // Responde 200 OK rapidamente para o Mercado Pago não reenviar
        res.status(200).send('OK');

    } catch (error) {
        logger.error(`🔥 Erro Webhook MP: ${error.message}`);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
