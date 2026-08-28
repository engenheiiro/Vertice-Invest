/**
 * Leitura do retorno do checkout — lógica pura, sem React.
 *
 * Mora fora de `pages/CheckoutSuccess.tsx` porque é a parte testável do fluxo:
 * a página só orquestra polling e renderização, enquanto a decisão de "isto
 * conta como ativado?" é uma função de dados. Manter as duas no mesmo arquivo
 * também quebrava o Fast Refresh da página (módulo com componente + helpers).
 */

export type SubscriptionStatusResponse = {
    current?: { plan?: string; subscriptionType?: string; subscriptionStatus?: string };
    lastPayment?: { gatewayId?: string; status?: string; plan?: string };
};

/** Sufixo dos planos de teste do Mercado Pago — some do plano exibido ao usuário. */
export const TEST_PLAN_SUFFIX = '_TEST';

export const getCheckoutReturnDetails = (params: URLSearchParams) => {
    const paymentId = params.get('payment_id') || params.get('collection_id');
    // Fluxo recorrente: o back_url do PreApproval devolve preapproval_id e nunca
    // um payment_id — a autorização do cartão precede a primeira cobrança.
    const preapprovalId = params.get('preapproval_id');
    const status = (params.get('status') || params.get('collection_status') || params.get('return_status') || 'processing').toLowerCase();
    const rawPlan = params.get('plan');
    const expectedPlan = rawPlan?.endsWith(TEST_PLAN_SUFFIX)
        ? rawPlan.slice(0, -TEST_PLAN_SUFFIX.length)
        : rawPlan;

    return { paymentId, preapprovalId, status, rawPlan, expectedPlan };
};

export const isActivationRecorded = (
    data: SubscriptionStatusResponse,
    paymentId: string,
    expectedPlan: string | null,
) => {
    const transaction = data.lastPayment;
    return transaction?.gatewayId === paymentId
        && transaction.status === 'PAID'
        && (!expectedPlan || (transaction.plan === expectedPlan && data.current?.plan === expectedPlan));
};

/**
 * Confirmação do fluxo recorrente. Não dá para esperar por uma Transaction: o
 * preapproval é autorizado antes da primeira cobrança ser liquidada, e a tela
 * ficaria presa em "processando". O sinal correto é a assinatura estar ativa.
 */
export const isSubscriptionActivated = (
    data: SubscriptionStatusResponse,
    expectedPlan: string | null,
) => {
    const current = data.current;
    return current?.subscriptionType === 'RECURRING'
        && current.subscriptionStatus === 'ACTIVE'
        && (!expectedPlan || current.plan === expectedPlan);
};
