
import { authService } from './auth';

export interface RankingItem {
    position: number;
    ticker: string;
    name: string;
    sector?: string;
    type?: string; 
    action: 'BUY' | 'SELL' | 'WAIT';
    currentPrice: number; 
    targetPrice: number;
    score: number;
    probability: number;
    
    // Novo Campo de Perfil de Risco
    riskProfile?: 'DEFENSIVE' | 'MODERATE' | 'BOLD';

    thesis: string;
    bullThesis?: string[]; 
    bearThesis?: string[]; 
    reason: string;
    
    metrics: {
        grahamPrice: number;
        bazinPrice: number;
        pegRatio: number;
        altmanZScore: number;
        earningsYield: number;
        roe: number;
        dy: number;
        pl: number;
        pvp: number;
        
        evEbitda?: number;
        psr?: number;
        roic?: number;
        ebitMargin?: number;
        pEbit?: number;
        pAtivos?: number;
        pCapGiro?: number;
        
        // FII Específico
        vacancy?: number;
        capRate?: number;
        ffoYield?: number;
        qtdImoveis?: number;
        vpCota?: number;
        ffoCota?: number;
        
        debtToEquity?: number;
        currentRatio?: number;
        netMargin?: number;
        avgLiquidity?: number;
        mktCap?: number;
        patrimLiq?: number;
        revenueGrowth?: number;
        
        // Novos Campos Calculados
        marketCap?: number;
        netDebt?: number;
        netRevenue?: number;
        netIncome?: number;
        totalAssets?: number;
        
        structural?: {
            quality: number;
            valuation: number;
            risk: number;
        };
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
    generatedBy?: string;
    content: {
        morningCall: string;
        ranking: RankingItem[];
        fullAuditLog?: RankingItem[];
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

    async getReportDetails(id: string) {
        const response = await authService.api(`/api/research/details/${id}`);
        if (!response.ok) throw new Error("Erro ao buscar detalhes");
        return await response.json();
    },

    async getLatest(assetClass: string, strategy: string) {
        const response = await authService.api(`/api/research/latest?assetClass=${assetClass}&strategy=${strategy}`);
        if (!response.ok) return null;
        return await response.json();
    },

    async getMacroData() {
        const response = await authService.api('/api/research/macro');
        if (!response.ok) return null;
        return await response.json();
    }
};
