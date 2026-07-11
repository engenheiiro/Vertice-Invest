
import { authService } from './auth';

export interface WalletSummary {
    id: string;
    name: string;
    isDefault: boolean;
    createdAt: string;
}

export interface WalletListResponse {
    wallets: WalletSummary[];
    activeWalletId: string;
}

// CRUD da entidade Carteira (plural) — distinto de walletService (singular),
// que cuida de ativos/transações/metas-alvo de UMA carteira já resolvida.
export const walletsService = {
    async list(): Promise<WalletListResponse> {
        const response = await authService.api('/api/wallets');
        if (!response.ok) throw new Error('Falha ao carregar carteiras');
        return await response.json();
    },

    async create(name: string): Promise<{ message: string; wallet: WalletSummary }> {
        const response = await authService.api('/api/wallets', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao criar carteira');
        }
        return await response.json();
    },

    async rename(walletId: string, name: string): Promise<{ message: string; wallet: WalletSummary }> {
        const response = await authService.api(`/api/wallets/${walletId}`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao renomear carteira');
        }
        return await response.json();
    },

    async remove(walletId: string): Promise<{ message: string; activeWalletId?: string }> {
        const response = await authService.api(`/api/wallets/${walletId}`, { method: 'DELETE' });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao excluir carteira');
        }
        return await response.json();
    },

    async setActive(walletId: string): Promise<{ message: string; activeWalletId: string }> {
        const response = await authService.api('/api/wallets/active', {
            method: 'PUT',
            body: JSON.stringify({ walletId }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Falha ao trocar carteira ativa');
        }
        return await response.json();
    },
};
