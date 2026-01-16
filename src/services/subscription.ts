import { API_URL } from '../config';

export const subscriptionService = {
    async initCheckout(planId: string) {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_URL}/api/subscription/checkout`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ planId })
        });
        
        if (!response.ok) throw new Error("Erro ao iniciar checkout");
        return await response.json();
    },

    async confirmPayment(planId: string, paymentMethod: string) {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_URL}/api/subscription/confirm`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ planId, paymentMethod })
        });
        
        if (!response.ok) throw new Error("Falha no pagamento");
        return await response.json();
    },

    async getStatus() {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_URL}/api/subscription/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) return null;
        return await response.json();
    }
};