
import { MercadoPagoConfig, PreApproval } from 'mercadopago';
import logger from '../config/logger.js';

// Inicializa o cliente MP apenas se o token existir
const accessToken = process.env.MP_ACCESS_TOKEN;
const client = accessToken ? new MercadoPagoConfig({ accessToken }) : null;

// --- PREÇOS DE TESTE ---
const PLANS_CONFIG = {
    'ESSENTIAL': { 
        price: 1.00, 
        title: 'Vértice Essential - Assinatura Mensal',
        description: 'Acesso básico ao Terminal e Carteira.'
    },
    'PRO': { 
        price: 1.50, 
        title: 'Vértice Pro - Assinatura Mensal',
        description: 'Acesso completo ao Research e Sinais em Tempo Real.'
    },
    'BLACK': { 
        price: 2.00, 
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

        const userId = user.id || user._id;

        if (!userId) {
            throw new Error("ID do usuário não identificado para criar assinatura.");
        }

        const preApproval = new PreApproval(client);

        try {
            // URL de retorno (Backend que redireciona para Frontend)
            const apiUrl = (process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
            const backUrl = `${apiUrl}/api/subscription/return?plan=${planKey}`;
            
            // --- LÓGICA ANTI-TRAVA SANDBOX (Mantida por segurança, só ativa se detectar TEST-) ---
            let payerEmail = user.email;
            
            if (accessToken && accessToken.startsWith('TEST-')) {
                const randomId = Math.floor(Math.random() * 1000000);
                payerEmail = `test_user_${randomId}@test.com`;
                logger.info(`🧪 [MP Sandbox] Email substituído por '${payerEmail}' para evitar conflito.`);
            }

            // --- CORREÇÃO DE DATA (BUFFER DE SEGURANÇA) ---
            // Adiciona 1 hora ao tempo atual.
            // Motivo: Se houver latência de rede ou diferença de relógio entre servidor (Render) e MP,
            // enviar "agora" exato causa erro "cannot be a past date".
            const futureDate = new Date();
            futureDate.setHours(futureDate.getHours() + 1);
            const startDate = futureDate.toISOString();

            const body = {
                reason: planConfig.title,
                external_reference: userId.toString(),
                payer_email: payerEmail,
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: planConfig.price,
                    currency_id: 'BRL',
                    start_date: startDate // Data segura no futuro
                },
                back_url: backUrl,
                status: 'pending'
            };

            const response = await preApproval.create({ body });
            
            logger.info(`💳 Assinatura MP Criada (${planKey} - R$ ${planConfig.price}): ${response.init_point}`);
            
            return {
                init_point: response.init_point,
                id: response.id
            };

        } catch (error) {
            logger.error(`❌ Erro Mercado Pago: ${error.message}`);
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
