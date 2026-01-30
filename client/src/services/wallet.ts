
import { authService } from './auth';

export const walletService = {
    async getWallet() {
        const response = await authService.api('/api/wallet');
        if (!response.ok) throw new Error("Falha ao carregar carteira");
        return await response.json();
    },

    async getHistory() {
        const response = await authService.api('/api/wallet/history');
        if (!response.ok) return [];
        return await response.json();
    },

    async addAsset(data: any) {
        const response = await authService.api('/api/wallet/add', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "Falha ao adicionar ativo");
        }
        return await response.json();
    },

    async removeAsset(id: string) {
        const response = await authService.api(`/api/wallet/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error("Falha ao remover ativo");
        return await response.json();
    },

    async resetWallet() {
        const response = await authService.api('/api/wallet/reset', {
            method: 'POST'
        });
        if (!response.ok) throw new Error("Falha ao resetar carteira");
        return await response.json();
    },

    async searchAsset(query: string) {
        const response = await authService.api(`/api/wallet/search?q=${query}`);
        if (!response.ok) return null;
        return await response.json();
    }
};
