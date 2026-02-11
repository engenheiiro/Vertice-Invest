
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

    async runFullPipeline() {
        const response = await authService.api('/api/research/full-pipeline', {
            method: 'POST'
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro no pipeline completo.");
        }
        return await response.json();
    },

    async enhanceReport(assetClass: string, strategy: string = 'BUY_HOLD') {
        const response = await authService.api('/api/research/enhance', {
            method: 'POST',
            body: JSON.stringify({ assetClass, strategy })
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro ao refinar com IA");
        }
        return await response.json();
    },

    async syncMarketData() {
        const response = await authService.api('/api/research/sync-market', {
            method: 'POST'
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro na sincronização de dados.");
        }
        return await response.json();
    },

    async syncMacro() {
        const response = await authService.api('/api/research/sync-macro', {
            method: 'POST'
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro na sincronização macro.");
        }
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
    },

    async getSignalsHistory() {
        const response = await authService.api('/api/research/signals?history=true');
        if (!response.ok) return [];
        return await response.json();
    },

    async getRadarStats() {
        const response = await authService.api('/api/research/radar-stats');
        if (!response.ok) return null;
        return await response.json();
    },

    async updateBacktestConfig(days: number) {
        const response = await authService.api('/api/research/config/backtest', {
            method: 'POST',
            body: JSON.stringify({ days })
        });
        if (!response.ok) throw new Error("Falha ao atualizar config.");
        return await response.json();
    },

    // Novo: Limpar Histórico Radar
    async clearSignalsHistory() {
        const response = await authService.api('/api/research/signals/history', {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error("Falha ao limpar histórico.");
        return await response.json();
    }
};
