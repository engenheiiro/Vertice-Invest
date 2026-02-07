
import { MercadoPagoConfig, Preference } from 'mercadopago';
import logger from '../config/logger.js';

// Inicializa o cliente MP
const accessToken = process.env.MP_ACCESS_TOKEN;
const client = accessToken ? new MercadoPagoConfig({ accessToken }) : null;

// Configuração dos Planos (Tratados como "Produtos" de 30 dias)
const PLANS_CONFIG = {
    'ESSENTIAL': { 
        price: 5.00, 
        title: 'Vértice Essential (30 Dias)', 
        description: 'Acesso mensal ao Terminal e Carteira.'
    },
    'PRO': { 
        price: 10.00, 
        title: 'Vértice Pro (30 Dias)', 
        description: 'Acesso mensal completo ao Research e Sinais.'
    },
    'BLACK': { 
        price: 15.00, 
        title: 'Vértice Black (30 Dias)', 
        description: 'Acesso mensal VIP com Consultoria.'
    }
};

export const paymentService = {
    async createSubscription(user, planKey) {
        if (!client) {
            logger.error("❌ MP_ACCESS_TOKEN ausente no .env");
            throw new Error("Configuração de pagamento ausente.");
        }

        const planConfig = PLANS_CONFIG[planKey];
        if (!planConfig) {
            throw new Error("Plano inválido.");
        }

        const userId = user.id || user._id;
        
        // MUDANÇA: Usamos 'Preference' (Checkout Pro) em vez de 'PreApproval'
        const preference = new Preference(client);

        try {
            // URLs de Retorno
            const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.API_URL || 'http://localhost:5000';
            const apiUrl = baseUrl.replace(/\/$/, '');
            
            // O Mercado Pago redirecionará o usuário para cá após o pagamento
            const successUrl = `${apiUrl}/api/subscription/return?plan=${planKey}&status=success`;
            const failureUrl = `${apiUrl}/api/subscription/return?plan=${planKey}&status=failure`;
            const pendingUrl = `${apiUrl}/api/subscription/return?plan=${planKey}&status=pending`;

            // --- CRIAÇÃO DA PREFERÊNCIA (CHECKOUT) ---
            const body = {
                items: [
                    {
                        id: planKey,
                        title: planConfig.title,
                        description: planConfig.description,
                        quantity: 1,
                        unit_price: planConfig.price,
                        currency_id: 'BRL'
                    }
                ],
                // External Reference é CRUCIAL: É como sabemos QUEM pagou quando o Webhook chegar
                external_reference: userId.toString(),
                
                // Configuração de Retorno
                back_urls: {
                    success: successUrl,
                    failure: failureUrl,
                    pending: pendingUrl
                },
                auto_return: 'approved', // Retorna automaticamente se aprovado
                
                // Configuração do Pagador (Opcional no Checkout Pro, mas bom para antifraude)
                payer: {
                    name: user.name,
                    email: user.email // O Checkout Pro preenche isso, mas enviamos para facilitar
                },
                
                // Permite PIX, Cartão, Boleto, Saldo MP
                payment_methods: {
                    excluded_payment_types: [], // Aceita tudo
                    installments: 1 // Plano mensal = 1x (sem parcelamento para valores baixos)
                },
                
                statement_descriptor: "VERTICE INVEST"
            };

            logger.info(`💳 Criando Checkout Pro (Preference) para User ${userId} | Plano: ${planKey}`);

            const response = await preference.create({ body });
            
            if (!response || !response.init_point) {
                throw new Error("Mercado Pago não retornou link de checkout.");
            }

            logger.info(`✅ Checkout Criado: ${response.init_point}`);
            
            // Retorna o mesmo formato esperado pelo controller
            return {
                init_point: response.init_point, // Link para o usuário pagar
                id: response.id // ID da preferência
            };

        } catch (error) {
            logger.error(`❌ Erro MP Preference: ${error.message}`);
            throw new Error("Falha ao gerar link de pagamento.");
        }
    },

    // Método auxiliar para buscar status de PAGAMENTO (não mais assinatura)
    async getPaymentStatus(paymentId) {
        if (!client) return null;
        try {
            // Import dinâmico ou uso direto da lib se já importado Payment
            const { Payment } = await import('mercadopago');
            const payment = new Payment(client);
            return await payment.get({ id: paymentId });
        } catch (error) {
            logger.error(`Erro status Pagamento MP: ${error.message}`);
            return null;
        }
    }
};
