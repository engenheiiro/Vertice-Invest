
import { MercadoPagoConfig, PreApproval } from 'mercadopago';
import logger from '../config/logger.js';

// Inicializa o cliente MP apenas se o token existir
const accessToken = process.env.MP_ACCESS_TOKEN;
const client = accessToken ? new MercadoPagoConfig({ accessToken }) : null;

// --- PREÇOS DE TESTE (Valores seguros > R$ 5,00 para evitar recusa bancária) ---
const PLANS_CONFIG = {
    'ESSENTIAL': { 
        price: 5.00, 
        title: 'Vértice Essential', 
        description: 'Acesso básico ao Terminal e Carteira.'
    },
    'PRO': { 
        price: 10.00, 
        title: 'Vértice Pro', 
        description: 'Acesso completo ao Research e Sinais em Tempo Real.'
    },
    'BLACK': { 
        price: 15.00, 
        title: 'Vértice Black', 
        description: 'Gestão Private, Consultoria e Automação Fiscal.'
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
        if (!userId) {
            throw new Error("ID do usuário não identificado.");
        }

        const preApproval = new PreApproval(client);

        try {
            // URL de retorno
            const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.API_URL || 'http://localhost:5000';
            const apiUrl = baseUrl.replace(/\/$/, '');
            const backUrl = `${apiUrl}/api/subscription/return?plan=${planKey}`;
            
            // --- DETECÇÃO DE AMBIENTE ---
            const isSandbox = accessToken.startsWith('TEST-');
            
            // --- DEFINIÇÃO DO E-MAIL DO PAGADOR ---
            // O campo payer_email é OBRIGATÓRIO na API de Assinaturas (PreApproval).
            // No entanto, em Sandbox, não podemos usar emails de contas reais (Produção), pois gera o erro:
            // "Uma das partes com as quais você está tentando efetuar o pagamento é de teste."
            // Solução: Em Sandbox, geramos um email aleatório. Em Produção, usamos o email real.
            
            let payerEmail = user.email;
            
            if (isSandbox) {
                const randomId = Math.floor(Math.random() * 1000000);
                payerEmail = `test_user_${randomId}@test.com`;
                logger.info(`🧪 [MP Sandbox] Email fake gerado para evitar conflito: ${payerEmail}`);
            } else {
                logger.info(`💳 [MP Production] Usando email real: ${payerEmail}`);
            }

            const body = {
                reason: planConfig.title,
                external_reference: userId.toString(),
                payer_email: payerEmail, // Campo Obrigatório Restaurado
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: planConfig.price,
                    currency_id: 'BRL'
                    // start_date removido para início imediato
                },
                back_url: backUrl,
                status: 'pending'
            };

            logger.info(`💳 Iniciando assinatura ${planKey} para ${userId}...`);

            const response = await preApproval.create({ body });
            
            if (!response || !response.init_point) {
                throw new Error("Mercado Pago não retornou link de pagamento.");
            }

            logger.info(`✅ Link Gerado: ${response.init_point}`);
            
            return {
                init_point: response.init_point,
                id: response.id
            };

        } catch (error) {
            logger.error(`❌ Erro MP Create: ${error.message}`);
            if (error.cause) logger.error(`🔍 Cause: ${JSON.stringify(error.cause)}`);
            throw new Error("Falha ao comunicar com gateway de pagamento.");
        }
    },

    async getSubscriptionStatus(preApprovalId) {
        if (!client) return null;
        try {
            const preApproval = new PreApproval(client);
            const response = await preApproval.get({ id: preApprovalId });
            return response;
        } catch (error) {
            logger.error(`Erro status MP: ${error.message}`);
            return null;
        }
    }
};
