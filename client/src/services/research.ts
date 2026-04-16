
import { authService } from './auth';

export interface AuditEntry {
    factor: string;
    points: number;
    type: 'base' | 'bonus' | 'penalty';
    category: string;
}

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
    auditLog?: AuditEntry[];
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
        beta?: number;
        volatility?: number;
        sma200?: number;
        ema50?: number;
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

    async clearSignalsHistory() {
        const response = await authService.api('/api/research/signals/history', {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error("Falha ao limpar histórico.");
        return await response.json();
    },

    async getDataQualityStats() {
        const response = await authService.api('/api/research/data-quality');
        if (!response.ok) return null;
        return await response.json();
    },

    async resetAssetHealth() {
        const response = await authService.api('/api/research/reset-health', {
            method: 'POST'
        });
        if (!response.ok) throw new Error("Falha ao resetar saúde.");
        return await response.json();
    },

    async triggerSnapshot(force: boolean = true) {
        const response = await authService.api('/api/wallet/admin/snapshot/force', {
            method: 'POST',
            body: JSON.stringify({ force })
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Falha ao executar snapshot.");
        }
        return await response.json();
    },

    // --- NOVOS MÉTODOS (ACURÁCIA E LOGS) ---
    async getAlgorithmAccuracy(assetClass?: string, days: number = 30) {
        const response = await authService.api(`/api/research/accuracy?assetClass=${assetClass || ''}&days=${days}`);
        if (!response.ok) return [];
        return await response.json();
    },

    async getDiscardLogs() {
        const response = await authService.api('/api/research/discard-logs');
        if (!response.ok) return [];
        return await response.json();
    }
};
