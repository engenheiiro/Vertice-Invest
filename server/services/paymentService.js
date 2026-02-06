
import { MercadoPagoConfig, PreApproval } from 'mercadopago';
import logger from '../config/logger.js';

// Inicializa o cliente MP apenas se o token existir
const accessToken = process.env.MP_ACCESS_TOKEN;
const client = accessToken ? new MercadoPagoConfig({ accessToken }) : null;

// --- PREÇOS DE TESTE (PRODUÇÃO) ---
const PLANS_CONFIG = {
    'ESSENTIAL': { 
        price: 0.50, 
        title: 'Vértice Essential - Assinatura Mensal',
        description: 'Acesso básico ao Terminal e Carteira.'
    },
    'PRO': { 
        price: 0.60, 
        title: 'Vértice Pro - Assinatura Mensal',
        description: 'Acesso completo ao Research e Sinais em Tempo Real.'
    },
    'BLACK': { 
        price: 0.70, 
        title: 'Vértice Black - Assinatura Mensal',
        description: 'Gestão Private, Consultoria e Automação Fiscal.'
    }
};

export const paymentService = {
    async createSubscription(user, planKey) {
        if (!client) {
            throw new Error("Mercado Pago Access Token não configurado no servidor.");
        }

        const planConfig = PLANS_CONFIG[planKey];
        if (!planConfig) {
            throw new Error("Plano inválido.");
        }

        // FIX: O objeto user vindo do JWT (req.user) tem a propriedade .id, 
        // enquanto o objeto do banco tem ._id. Verificamos ambos.
        const userId = user.id || user._id;

        if (!userId) {
            throw new Error("ID do usuário não identificado para criar assinatura.");
        }

        const preApproval = new PreApproval(client);

        try {
            // FIX: back_url não pode conter '#' (Hash).
            // Solução: Apontamos para uma rota de API no backend que redireciona para o frontend.
            const apiUrl = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
            const backUrl = `${apiUrl}/api/subscription/return?plan=${planKey}`;
            
            const body = {
                reason: planConfig.title,
                external_reference: userId.toString(), // VITAL: Vincula o pagamento ao usuário no Webhook
                payer_email: user.email,
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: planConfig.price,
                    currency_id: 'BRL'
                },
                back_url: backUrl,
                status: 'pending'
            };

            const response = await preApproval.create({ body });
            
            logger.info(`💳 Assinatura MP criada para ${user.email} - Init Point: ${response.init_point}`);
            
            return {
                init_point: response.init_point, // URL para redirecionar o usuário
                id: response.id
            };

        } catch (error) {
            logger.error(`❌ Erro Mercado Pago: ${error.message}`);
            // Log detalhado para debug se disponível
            if (error.cause) logger.error(JSON.stringify(error.cause));
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
            logger.error(`Erro ao buscar status da assinatura ${preApprovalId}: ${error.message}`);
            return null;
        }
    }
};
