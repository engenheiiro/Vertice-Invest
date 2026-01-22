
import { API_URL } from '../config';

export interface ResearchReport {
    _id: string;
    date: string;
    createdAt: string; 
    assetClass: string;
    strategy: string;
    generatedBy: string;
    content: {
        morningCall: string; 
        ranking: any[];    
    };
}

export const researchService = {
    /**
     * Dispara a geração de um novo relatório via IA (Admin Only)
     */
    async generateReport(assetClass: string, strategy: string) {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_URL}/api/research/generate`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ assetClass, strategy })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || "Erro ao gerar relatório");
        }
        
        return data;
    },

    /**
     * Dispara a rotina diária (Admin Only)
     * Permite forçar a regeração ignorando o cache de 24h
     */
    async triggerRoutine(force = false) {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_URL}/api/research/routine`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ force })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Erro ao disparar rotina");
        return data;
    },

    /**
     * Busca o histórico de gerações (Admin Only)
     */
    async getHistory() {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_URL}/api/research/history`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) return [];
        return await response.json();
    },

    /**
     * Busca o relatório mais recente para consumo (User)
     */
    async getLatest(assetClass: string, strategy: string) {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_URL}/api/research/latest?assetClass=${assetClass}&strategy=${strategy}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error("Erro ao buscar relatório");
        }
        return await response.json();
    }
};
