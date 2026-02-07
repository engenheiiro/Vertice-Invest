
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
            
            const successUrl = `${apiUrl}/api/subscription/return?plan=${planKey}&status=success`;
            const failureUrl = `${apiUrl}/api/subscription/return?plan=${planKey}&status=failure`;
            const pendingUrl = `${apiUrl}/api/subscription/return?plan=${planKey}&status=pending`;

            // --- DETECÇÃO DE AMBIENTE SANDBOX ---
            const isSandbox = accessToken.startsWith('TEST-');
            
            // Em Sandbox, não podemos usar o mesmo e-mail do vendedor (Seller) como comprador (Buyer).
            // Geramos um e-mail fictício para o comprador se estivermos testando.
            let payerEmail = user.email;
            if (isSandbox) {
                const randomId = Math.floor(Math.random() * 1000000);
                payerEmail = `test_user_${randomId}@test.com`;
                logger.info(`🧪 [MP Sandbox] Email fake gerado para evitar conflito Seller-Buyer: ${payerEmail}`);
            }

            // --- CRIAÇÃO DA PREFERÊNCIA (CHECKOUT API) ---
            const body = {
                items: [
                    {
                        id: planKey,
                        title: planConfig.title || `Plano ${planKey}`,
                        description: `Acesso mensal à plataforma Vértice Invest (${planKey})`,
                        quantity: 1,
                        unit_price: Number(planConfig.price),
                        currency_id: 'BRL'
                    }
                ],
                external_reference: userId.toString(),
                
                back_urls: {
                    success: successUrl,
                    failure: failureUrl,
                    pending: pendingUrl
                },
                auto_return: 'approved',
                
                payer: {
                    name: user.name,
                    email: payerEmail // Email seguro (Real ou Fake dependendo do env)
                },
                
                payment_methods: {
                    excluded_payment_types: [], // Aceita tudo (PIX, Cartão, Boleto)
                    installments: 1 // Assinatura mensal = 1x
                },
                
                statement_descriptor: "VERTICE INVEST"
            };

            logger.info(`💳 Criando Checkout (Preference) para User ${userId} | Plano: ${planKey} | Valor: ${planConfig.price}`);

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
    }
};
