
import { authService } from './auth';

/** Payload do PUT /wallet/:id — edição e reclassificação de ativo. */
export interface UpdateAssetPayload {
    name?: string;
    tags?: string[];
    usSubType?: string;
    // Reclassificação de um Caixa/Reserva (CASH) em Renda Fixa.
    type?: 'FIXED_INCOME';
    fixedIncomeRate?: number;
    fixedIncomeIndex?: 'SELIC' | 'CDI' | 'IPCA' | 'PRE';
    fixedIncomeSpread?: number;
    maturityDate?: string;
    isReserve?: boolean;
}

// Anexa ?walletId= à URL quando informado; omitido, o backend resolve a
// carteira ativa do usuário via middleware resolveWallet.
const withWallet = (path: string, walletId?: string) => {
    if (!walletId) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}walletId=${encodeURIComponent(walletId)}`;
};

export const walletService = {
    async getWallet(walletId?: string) {
        const response = await authService.api(withWallet('/api/wallet', walletId));
        if (!response.ok) throw new Error("Falha ao carregar carteira");
        return await response.json();
    },

    async getHistory(walletId?: string) {
        const response = await authService.api(withWallet('/api/wallet/history', walletId));
        if (!response.ok) return [];
        return await response.json();
    },

    async addAsset(data: any, walletId?: string) {
        const response = await authService.api(withWallet('/api/wallet/add', walletId), {
            method: 'POST',
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "Falha ao adicionar ativo");
        }
        return await response.json();
    },

    async updateAsset(id: string, data: UpdateAssetPayload, walletId?: string) {
        const response = await authService.api(withWallet(`/api/wallet/${id}`, walletId), {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || "Falha ao atualizar ativo");
        }
        return await response.json();
    },

    async removeAsset(id: string, walletId?: string) {
        const response = await authService.api(withWallet(`/api/wallet/${id}`, walletId), {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error("Falha ao remover ativo");
        return await response.json();
    },

    async updateTargets(targetAllocation: Record<string, number>, targetReserve: number, targetSubAllocation?: unknown, targetMonthlyDividendIncome?: number, walletId?: string) {
        const response = await authService.api(withWallet('/api/wallet/targets', walletId), {
            method: 'PUT',
            body: JSON.stringify({ targetAllocation, targetReserve, targetSubAllocation, targetMonthlyDividendIncome })
        });
        if (!response.ok) throw new Error("Falha ao salvar carteira ideal");
        return await response.json();
    },

    async resetWallet(walletId?: string) {
        const response = await authService.api(withWallet('/api/wallet/reset', walletId), {
            method: 'POST'
        });
        if (!response.ok) throw new Error("Falha ao resetar carteira");
        return await response.json();
    },

    async searchAsset(query: string, type?: string) {
        const params = new URLSearchParams({ q: query });
        if (type) params.append('type', type);
        const response = await authService.api(`/api/wallet/search?${params}`);
        if (!response.ok) return null;
        return await response.json();
    },

    async getTransactions(ticker: string, page: number = 1, limit: number = 10, walletId?: string) {
        const response = await authService.api(withWallet(`/api/wallet/transactions/${ticker}?page=${page}&limit=${limit}`, walletId));
        if (!response.ok) throw new Error("Falha ao buscar histórico");
        return await response.json();
    },

    async deleteTransaction(id: string, walletId?: string) {
        const response = await authService.api(withWallet(`/api/wallet/transactions/${id}`, walletId), {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error("Falha ao deletar transação");
        return await response.json();
    },

    async getPerformance(walletId?: string) {
        const response = await authService.api(withWallet('/api/wallet/performance', walletId));
        if (!response.ok) return [];
        return await response.json();
    },

    async getDividends(walletId?: string) {
        const response = await authService.api(withWallet('/api/wallet/dividends', walletId));
        if (!response.ok) return { history: [], provisioned: [], totalAllTime: 0, projectedMonthly: 0, yieldOnCost: [], goal: { target: 0, current: 0, progressPercent: null } };
        return await response.json();
    },

    // Atualizado: Suporte a filtros
    async getCashFlow(page: number = 1, limit: number = 20, filterType: string = 'ALL', walletId?: string) {
        const response = await authService.api(withWallet(`/api/wallet/cashflow?page=${page}&limit=${limit}&filterType=${filterType}`, walletId));
        if (!response.ok) throw new Error("Falha ao buscar extrato");
        return await response.json();
    },

    // (7.11) Relatório de Imposto de Renda (BLACK): JSON estruturado do ano-base.
    async getTaxReport(year: number) {
        const response = await authService.api(`/api/wallet/tax-report/${year}`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || "Falha ao gerar o relatório de IR");
        }
        return await response.json();
    },

    // (7.11) Baixa o PDF do relatório de IR (mesmo padrão de authService.exportData).
    async downloadTaxReportPdf(year: number) {
        const response = await authService.api(`/api/wallet/tax-report/${year}/pdf`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || "Falha ao gerar o PDF");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vertice-ir-${year}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // Rebalanceamento IA (BLACK): gera o plano de ordens para o perfil escolhido.
    async getRebalancePlan(riskProfile: 'DEFENSIVE' | 'MODERATE' | 'BOLD' = 'MODERATE', walletId?: string) {
        const response = await authService.api(withWallet('/api/wallet/rebalance', walletId), {
            method: 'POST',
            body: JSON.stringify({ riskProfile })
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || "Falha ao gerar o rebalanceamento");
        }
        return await response.json();
    }
};
