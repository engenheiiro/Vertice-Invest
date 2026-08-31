
import { authService } from './auth';
import type { BillingCycle } from '../constants/subscription';

// ONE_TIME: Pix/boleto, período fechado sem renovação.
// RECURRING: cartão via PreApproval, o Mercado Pago cobra todo mês.
// O anual ignora o modo e é sempre ONE_TIME — o PreApproval não parcela.
export type BillingMode = 'ONE_TIME' | 'RECURRING';

export const subscriptionService = {
    async initCheckout(planId: string, mode: BillingMode = 'ONE_TIME') {
        const response = await authService.api('/api/subscription/checkout', {
            method: 'POST',
            body: JSON.stringify({ planId, mode })
        });

        if (!response.ok) throw new Error("Erro ao iniciar checkout");
        return await response.json();
    },

    // Redundância ao webhook no fluxo avulso (o retorno traz payment_id).
    async syncPayment(paymentId: string) {
        const response = await authService.api('/api/subscription/sync-payment', {
            method: 'POST',
            body: JSON.stringify({ paymentId })
        });

        if (!response.ok) throw new Error("Não foi possível verificar o pagamento.");
        return await response.json();
    },

    // Redundância ao webhook no fluxo recorrente (o retorno traz preapproval_id).
    async syncPreapproval(preapprovalId: string) {
        const response = await authService.api('/api/subscription/sync-preapproval', {
            method: 'POST',
            body: JSON.stringify({ preapprovalId })
        });

        if (!response.ok) throw new Error("Não foi possível verificar a assinatura.");
        return await response.json();
    },

    async cancelSubscription() {
        const response = await authService.api('/api/subscription/cancel', { method: 'POST' });
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.message || "Não foi possível cancelar a assinatura.");
        }
        return await response.json();
    },

    async changePlan(planId: string) {
        const response = await authService.api('/api/subscription/change-plan', {
            method: 'POST',
            body: JSON.stringify({ planId })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.message || "Não foi possível trocar de plano.");
        }
        return await response.json();
    },

    // `cycle` exercita o caminho anual do MP (Preference com cartão parcelado),
    // que é outro fluxo — aprovar o mensal não dá garantia nenhuma sobre ele.
    async testCheckout(planKey: string, mode: BillingMode = 'ONE_TIME', cycle: BillingCycle = 'MONTHLY') {
        const response = await authService.api('/api/subscription/test-checkout', {
            method: 'POST',
            body: JSON.stringify({ planKey, mode, cycle })
        });

        if (!response.ok) throw new Error("Erro ao iniciar checkout de teste");
        return await response.json();
    },

    async getStatus() {
        const response = await authService.api('/api/subscription/status');
        if (!response.ok) return null;
        return await response.json();
    }
};
