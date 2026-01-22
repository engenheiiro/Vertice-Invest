
import { API_URL } from '../config';

export interface RankingItem {
    position: number;
    ticker: string;
    name: string;
    action: 'BUY' | 'SELL' | 'WAIT';
    targetPrice: number;
    score: number;
    probability?: number;
    thesis?: string;
    reason: string;
    // Novo Objeto Detalhado
    detailedAnalysis?: {
        summary: string;
        pros: string[];
        cons: string[];
        valuationMethod: string;
    };
}

export interface ResearchReport {
    _id: string;
    date: string;
    createdAt: string; 
    assetClass: string;
    strategy: string;
    generatedBy: string;
    content: {
        morningCall: string; 
        ranking: RankingItem[];    
    };
}

export const researchService = {
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
        if (!response.ok) throw new Error(data.message || "Erro ao gerar relatório");
        return data;
    },

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

    async getHistory() {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_URL}/api/research/history`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return [];
        return await response.json();
    },

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
