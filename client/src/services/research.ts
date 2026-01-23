import { authService } from './auth';

export interface RankingItem {
    position: number;
    ticker: string;
    name: string;
    action: 'BUY' | 'SELL' | 'WAIT';
    targetPrice: number;
    score: number;
    probability: number;
    thesis: string;
    reason: string;
    metrics: {
        grahamPrice: number;
        bazinPrice: number;
        pegRatio: number;
        altmanZScore: number;
        sharpeRatio: number;
        volatility: number;
        earningsYield: number;
        roe: number;
        dy: number;
        pl: number;
        pvp: number;
        debtToEquity?: number;
        currentRatio?: number;
    };
}

export interface ResearchReport {
    _id: string;
    date: string;
    createdAt?: string;
    assetClass: string;
    strategy: string;
    isRankingPublished: boolean;
    isMorningCallPublished: boolean;
    content: {
        morningCall: string;
        ranking: RankingItem[];
        fullAuditLog?: RankingItem[]; // Opcional, vem apenas no details
    };
}

export const researchService = {
    async crunchNumbers(assetClass?: string, isBulk: boolean = false) {
        const response = await authService.api('/api/research/crunch', {
            method: 'POST',
            body: JSON.stringify({ assetClass, isBulk })
        });
        return await response.json();
    },

    async generateNarrative(analysisId: string) {
        const response = await authService.api('/api/research/narrative', {
            method: 'POST',
            body: JSON.stringify({ analysisId })
        });
        return await response.json();
    },

    async publish(analysisId: string, type: 'RANKING' | 'MORNING_CALL' | 'BOTH') {
        const response = await authService.api('/api/research/publish', {
            method: 'POST',
            body: JSON.stringify({ analysisId, type })
        });
        return await response.json();
    },

    async getHistory() {
        const response = await authService.api('/api/research/history');
        if (!response.ok) return [];
        return await response.json();
    },

    // Busca detalhes completos para auditoria
    async getReportDetails(id: string) {
        const response = await authService.api(`/api/research/details/${id}`);
        if (!response.ok) throw new Error("Erro ao buscar detalhes");
        return await response.json();
    },

    async getLatest(assetClass: string, strategy: string) {
        const response = await authService.api(`/api/research/latest?assetClass=${assetClass}&strategy=${strategy}`);
        if (!response.ok) return null;
        return await response.json();
    }
};