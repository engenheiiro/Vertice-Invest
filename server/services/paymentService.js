
import { MercadoPagoConfig, Preference } from 'mercadopago';
import logger from '../config/logger.js';
import { PLANS } from '../config/subscription.js';

// Inicializa o cliente MP
const accessToken = process.env.MP_ACCESS_TOKEN;
const client = accessToken ? new MercadoPagoConfig({ accessToken }) : null;

export const paymentService = {
    async createSubscription(user, planKey) {
        if (!client) {
            logger.error("❌ MP_ACCESS_TOKEN ausente no .env");
            throw new Error("Configuração de pagamento ausente.");
        }

        const planConfig = PLANS[planKey];
        if (!planConfig) {
            throw new Error("Plano inválido.");
        }

        const userId = user.id || user._id;

        // Usa Preference (Checkout API)
        const preference = new Preference(client);

        try {
            // URLs de Retorno
            const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.API_URL || 'http://localhost:5000';
            const apiUrl = baseUrl.replace(/\/$/, '');

            // `status` é adicionado pelo próprio Mercado Pago no retorno. Usar
            // `return_status` para o nosso fallback evita duplicar a chave e
            // preserva o estado autoritativo devolvido pelo gateway.
            const successUrl = `${apiUrl}/api/subscription/return?plan=${planKey}&return_status=success`;
            const failureUrl = `${apiUrl}/api/subscription/return?plan=${planKey}&return_status=failure`;
            const pendingUrl = `${apiUrl}/api/subscription/return?plan=${planKey}&return_status=pending`;

            // --- DETECÇÃO DE AMBIENTE SANDBOX ---
            const isSandbox = accessToken.startsWith('TEST-');

            // Em Sandbox, não podemos usar o mesmo e-mail do vendedor (Seller) como comprador (Buyer).
            let payerEmail = user.email;
            if (isSandbox) {
                const randomId = Math.floor(Math.random() * 1000000);
                payerEmail = `test_user_${randomId}@test.com`;
                logger.info(`🧪 [MP Sandbox] Email fake gerado para evitar conflito: ${payerEmail}`);
            }

            // --- CRIAÇÃO DA PREFERÊNCIA (CHECKOUT API) ---
            const body = {
                items: [
                    {
                        id: planKey,
                        // TÍTULO EXPLÍCITO: Substitui qualquer padrão do painel
                        title: `Vértice Invest - ${planConfig.title || planKey}`,
                        description: `Acesso Premium à plataforma Vértice Invest (${planKey})`,
                        quantity: 1,
                        unit_price: Number(planConfig.price),
                        currency_id: 'BRL',
                        category_id: 'services' // Categoria correta para evitar confusão
                    }
                ],
                // Encoda o planKey para o webhook não depender de threshold de preço
                external_reference: `${userId.toString()}:${planKey}`,

                // NOTIFICAÇÃO WEBHOOK (Ação Obrigatória do Mercado Pago)
                notification_url: `${apiUrl}/api/webhooks/mercadopago`,

                back_urls: {
                    success: successUrl,
                    failure: failureUrl,
                    pending: pendingUrl
                },
                auto_return: 'approved',

                payer: {
                    name: user.name,
                    email: payerEmail
                },

                payment_methods: {
                    excluded_payment_types: [], // Aceita tudo (PIX, Cartão, Boleto)
                    installments: 1 // Assinatura mensal = 1x
                },

                // NOME NA FATURA DO CARTÃO (Máx 22 chars)
                statement_descriptor: "VERTICE INVEST"
            };

            logger.info(`💳 Criando Checkout para User ${userId} | Plano: ${planKey} | Valor: ${planConfig.price}`);

            const response = await preference.create({ body });

            if (!response || !response.init_point) {
                throw new Error("Mercado Pago não retornou link de checkout.");
            }

            logger.info(`✅ Link de Pagamento Gerado: ${response.init_point}`);

            return {
                init_point: response.init_point,
                id: response.id
            };

        } catch (error) {
            logger.error(`❌ Erro MP Preference: ${error.message}`);
            throw new Error("Falha ao gerar link de pagamento.");
        }
    },

    async getPaymentStatus(paymentId) {
        if (!client) return null;
        try {
            const { Payment } = await import('mercadopago');
            const payment = new Payment(client);
            return await payment.get({ id: paymentId });
        } catch (error) {
            logger.error(`Erro status Pagamento MP: ${error.message}`);
            return null;
        }
    },

    /**
     * Cancela uma assinatura recorrente no Mercado Pago (best-effort).
     * Usado na exclusão de conta (LGPD Art. 18 VI) para interromper cobranças.
     * Nunca lança: a falha de cancelamento não deve bloquear a exclusão dos dados.
     */
    async cancelSubscription(subscriptionId) {
        if (!client || !subscriptionId) return false;
        try {
            const { PreApproval } = await import('mercadopago');
            const preApproval = new PreApproval(client);
            await preApproval.update({ id: subscriptionId, body: { status: 'cancelled' } });
            logger.info(`🔕 Assinatura MP cancelada: ${subscriptionId}`);
            return true;
        } catch (error) {
            logger.error(`⚠️ Falha ao cancelar assinatura MP ${subscriptionId}: ${error.message}`);
            return false;
        }
    }
};
