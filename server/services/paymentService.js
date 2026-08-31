
import { MercadoPagoConfig, Preference, PreApproval } from 'mercadopago';
import logger from '../config/logger.js';
import { ANNUAL_INSTALLMENTS, PLANS } from '../config/subscription.js';

// Inicializa o cliente MP
const accessToken = process.env.MP_ACCESS_TOKEN;
const client = accessToken ? new MercadoPagoConfig({ accessToken }) : null;

const getApiBaseUrl = () => {
    const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.API_URL || 'http://localhost:5000';
    return baseUrl.replace(/\/$/, '');
};

export const paymentService = {
    /**
     * Checkout AVULSO (Preference): período fechado, sem renovação.
     *
     * Dois produtos passam por aqui, com regras opostas para o cartão:
     * - MENSAL (Pix/boleto): o cartão é EXCLUÍDO de propósito. Quem paga no
     *   cartão entra pelo PreApproval; deixar as duas portas abertas criaria uma
     *   cobrança avulsa silenciosa, sem renovação e sem preapproval para cancelar.
     * - ANUAL: o cartão é a porta principal, parcelado em até 12×. O PreApproval
     *   do MP não parcela, e é o parcelamento que torna o anual vendável — por
     *   isso o anual é avulso por construção, não por limitação temporária.
     */
    async createOneTimeCheckout(user, planKey) {
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
            const apiUrl = getApiBaseUrl();

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
            const isAnnual = planConfig.cycle === 'ANNUAL';
            const periodLabel = isAnnual ? 'Anual (12 meses)' : 'Mensal (30 dias)';

            const body = {
                items: [
                    {
                        id: planKey,
                        // TÍTULO EXPLÍCITO: Substitui qualquer padrão do painel
                        title: `Vértice Invest - ${planConfig.title || planKey} — ${periodLabel}`,
                        description: `Acesso Premium à plataforma Vértice Invest (${planKey}) · ${planConfig.days} dias`,
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

                payment_methods: isAnnual
                    // `installments` é o TETO de parcelas, não a escolha: o
                    // comprador pode pagar à vista se quiser.
                    ? { installments: ANNUAL_INSTALLMENTS }
                    : { excluded_payment_types: [{ id: 'credit_card' }], installments: 1 },

                // NOME NA FATURA DO CARTÃO (Máx 22 chars)
                statement_descriptor: "VERTICE INVEST"
            };

            logger.info(`💳 Criando Checkout para User ${userId} | Plano: ${planKey} | Valor: ${planConfig.price} | ${periodLabel}`);

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

    /**
     * Assinatura RECORRENTE (PreApproval sem plano associado). O usuário é
     * redirecionado ao `init_point`, cadastra o cartão no ambiente do Mercado
     * Pago e autoriza — nenhum dado de cartão passa pela nossa aplicação.
     *
     * ⚠️ `notification_url` NÃO é aceito no preapproval. Os eventos
     * `subscription_preapproval` e `subscription_authorized_payment` só chegam se
     * estiverem marcados na configuração de Webhooks do painel do Mercado Pago.
     *
     * @param {Date} [startDate] Início da cobrança. Usado na troca de plano para
     *   não cobrar de novo um período que o usuário já pagou.
     */
    async createRecurringSubscription(user, planKey, { startDate } = {}) {
        if (!client) {
            logger.error("❌ MP_ACCESS_TOKEN ausente no .env");
            throw new Error("Configuração de pagamento ausente.");
        }

        const planConfig = PLANS[planKey];
        if (!planConfig) throw new Error("Plano inválido.");
        // Barreira de contrato: o anual não tem caminho recorrente (o PreApproval
        // não parcela). Chegar aqui com uma chave anual significa que alguém
        // roteou errado — cobrar R$598,80 TODO MÊS seria o estrago.
        if (planConfig.cycle === 'ANNUAL') {
            throw new Error("O plano anual é cobrança única e não pode virar assinatura recorrente.");
        }

        const userId = user.id || user._id;
        const apiUrl = getApiBaseUrl();
        const preApproval = new PreApproval(client);

        try {
            const body = {
                reason: `Vértice Invest - ${planConfig.title || planKey}`,
                // Mesmo formato do fluxo avulso: o webhook resolve usuário e plano
                // por aqui, sem depender de valor ou de heurística.
                external_reference: `${userId.toString()}:${planKey}`,
                payer_email: user.email,
                // ⚠️ O back_url do preapproval NÃO pode ter query string. Ao
                // devolver o usuário, o MP concatena "?preapproval_id=..." sem
                // verificar se já existe uma — o que gruda o id dentro do valor do
                // último parâmetro e faz o identificador da assinatura sumir.
                // Por isso o plano viaja no PATH (rota /return/:plan).
                back_url: `${apiUrl}/api/subscription/return/${planKey}`,
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: Number(planConfig.price),
                    currency_id: 'BRL',
                    ...(startDate ? { start_date: new Date(startDate).toISOString() } : {}),
                },
                status: 'pending',
            };

            logger.info('💳 Criando assinatura recorrente', {
                userId: userId.toString(), plan: planKey, amount: planConfig.price,
                startDate: startDate ? new Date(startDate).toISOString() : null,
            });

            const response = await preApproval.create({ body });

            if (!response || !response.init_point) {
                throw new Error("Mercado Pago não retornou link de assinatura.");
            }

            return { init_point: response.init_point, id: response.id };

        } catch (error) {
            logger.error(`❌ Erro MP PreApproval: ${error.message}`);
            throw new Error("Falha ao gerar link de assinatura.");
        }
    },

    /** Estado autoritativo da assinatura no MP (status, next_payment_date). */
    async getPreapproval(preapprovalId) {
        if (!client || !preapprovalId) return null;
        try {
            const preApproval = new PreApproval(client);
            return await preApproval.get({ id: preapprovalId });
        } catch (error) {
            logger.error(`Erro ao consultar preapproval ${preapprovalId}: ${error.message}`);
            return null;
        }
    },

    /**
     * Cobrança individual gerada por uma assinatura. Traz o id do pagamento real,
     * que é o mesmo que chegaria pelo tópico `payment` — usá-lo como gatewayId
     * mantém a idempotência entre os dois tópicos.
     */
    async getAuthorizedPayment(authorizedPaymentId) {
        if (!client || !authorizedPaymentId) return null;
        try {
            const response = await fetch(
                `https://api.mercadopago.com/authorized_payments/${authorizedPaymentId}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!response.ok) {
                logger.error(`Erro authorized_payment ${authorizedPaymentId}: HTTP ${response.status}`);
                return null;
            }
            return await response.json();
        } catch (error) {
            logger.error(`Erro ao consultar authorized_payment ${authorizedPaymentId}: ${error.message}`);
            return null;
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
     * Usado no cancelamento pelo perfil e na exclusão de conta (LGPD Art. 18 VI).
     * Nunca lança: a falha de cancelamento não deve bloquear a exclusão dos dados.
     *
     * Recebe um `preapproval_id` — passar um id de pagamento aqui nunca funciona.
     */
    async cancelPreapproval(preapprovalId) {
        if (!client || !preapprovalId) return false;
        try {
            const preApproval = new PreApproval(client);
            await preApproval.update({ id: preapprovalId, body: { status: 'cancelled' } });
            logger.info(`🔕 Assinatura MP cancelada: ${preapprovalId}`);
            return true;
        } catch (error) {
            logger.error(`⚠️ Falha ao cancelar assinatura MP ${preapprovalId}: ${error.message}`);
            return false;
        }
    }
};
