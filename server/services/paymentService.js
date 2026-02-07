
import { MercadoPagoConfig, PreApproval } from 'mercadopago';
import logger from '../config/logger.js';

// Inicializa o cliente MP apenas se o token existir
const accessToken = process.env.MP_ACCESS_TOKEN;
const client = accessToken ? new MercadoPagoConfig({ accessToken }) : null;

// --- PREÇOS DE TESTE (Valores seguros > R$ 5,00 para evitar recusa bancária) ---
const PLANS_CONFIG = {
    'ESSENTIAL': { 
        price: 5.00, 
        title: 'Vértice Essential - Assinatura Mensal',
        description: 'Acesso básico ao Terminal e Carteira.'
    },
    'PRO': { 
        price: 10.00, 
        title: 'Vértice Pro - Assinatura Mensal',
        description: 'Acesso completo ao Research e Sinais em Tempo Real.'
    },
    'BLACK': { 
        price: 15.00, 
        title: 'Vértice Black - Assinatura Mensal',
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
            // Tenta pegar URL do Render (RENDER_EXTERNAL_URL) ou API_URL configurada, fallback para localhost
            const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.API_URL || 'http://localhost:5000';
            const apiUrl = baseUrl.replace(/\/$/, '');
            const backUrl = `${apiUrl}/api/subscription/return?plan=${planKey}`;
            
            // --- CORREÇÃO DE DATA ---
            // Adiciona 1 hora para evitar conflito de fuso horário "past date"
            const futureDate = new Date();
            futureDate.setHours(futureDate.getHours() + 1);
            const startDate = futureDate.toISOString();

            // Configuração do Corpo da Requisição
            const body = {
                reason: planConfig.title,
                external_reference: userId.toString(),
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: planConfig.price,
                    currency_id: 'BRL',
                    start_date: startDate
                },
                back_url: backUrl,
                status: 'pending'
            };

            // --- LÓGICA CRÍTICA DE E-MAIL ---
            // Se for TEST (Sandbox), precisamos enviar um email fake diferente do vendedor.
            // Se for PROD (APP_USR), NÃO ENVIAMOS payer_email. 
            // Isso permite que o usuário (ou um amigo) digite qualquer email no checkout do MP.
            
            const isSandbox = accessToken.startsWith('TEST-');
            
            if (isSandbox) {
                const randomId = Math.floor(Math.random() * 1000000);
                body.payer_email = `test_user_${randomId}@test.com`;
                logger.info(`🧪 [MP Sandbox] Email fake injetado: ${body.payer_email}`);
            } else {
                // EM PRODUÇÃO: Deixamos o payer_email undefined/vazio.
                // O Mercado Pago coletará o email real no checkout.
                // Isso resolve o problema de "Amigo pagando para Usuário".
                logger.info(`💳 [MP Production] Payer Email omitido para permitir checkout livre.`);
            }

            logger.info(`💳 Criando assinatura ${planKey} (R$ ${planConfig.price}) para User ${userId}...`);

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
