
import { authService } from './auth';

export const subscriptionService = {
    async initCheckout(planId: string) {
        const response = await authService.api('/api/subscription/checkout', {
            method: 'POST',
            body: JSON.stringify({ planId })
        });
        
        if (!response.ok) throw new Error("Erro ao iniciar checkout");
        return await response.json();
    },

    async confirmPayment(planId: string, paymentMethod: string) {
        const response = await authService.api('/api/subscription/confirm', {
            method: 'POST',
            body: JSON.stringify({ planId, paymentMethod })
        });
        
        if (!response.ok) throw new Error("Falha no pagamento");
        return await response.json();
    },

    // Novo método para forçar a verificação do pagamento
    async syncPayment(paymentId: string) {
        const response = await authService.api('/api/subscription/sync-payment', {
            method: 'POST',
            body: JSON.stringify({ paymentId })
        });
        
        if (!response.ok) throw new Error("Não foi possível verificar o pagamento.");
        return await response.json();
    },

    async getStatus() {
        const response = await authService.api('/api/subscription/status');
        if (!response.ok) return null;
        return await response.json();
    }
};
