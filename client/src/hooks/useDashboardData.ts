
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { researchService, RankingItem } from '../services/research';
import { walletService } from '../services/wallet';
import { authService } from '../services/auth';

export interface PortfolioItem {
    ticker: string;
    name: string;
    shares: number;
    avgPrice: number;
    currentPrice: number;
    type: string; 
    aiScore: number; 
    aiSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface AiSignal {
    id: string;
    ticker: string;
    type: 'OPPORTUNITY' | 'RISK' | 'NEUTRAL' | 'DELAYED';
    assetType: string;
    message: string;
    time: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    probability?: number; 
    thesis?: string;      
    score?: number;
    riskProfile?: 'DEFENSIVE' | 'MODERATE' | 'BOLD';
    source: 'ALGO' | 'RESEARCH'; // Nova propriedade para distinção visual
}

export interface MarketIndex {
    ticker: string;
    value: number;
    changePercent: number;
    type?: 'INDEX' | 'RATE' | 'CURRENCY';
}

export interface SystemHealth {
    status: 'ONLINE' | 'STALE' | 'OFFLINE';
    lastSync: Date | null;
    latencyMs: number;
    message: string;
}

// Interface do Sinal do Backend (Atualizada)
interface QuantSignal {
    _id: string;
    ticker: string;
    assetType: string;
    riskProfile: 'DEFENSIVE' | 'MODERATE' | 'BOLD';
    type: 'RSI_OVERSOLD' | 'VOLUME_SPIKE' | 'DEEP_VALUE' | 'SUPPORT_ZONE';
    value: number;
    message: string;
    timestamp: string;
}

export const useDashboardData = () => {
    const { user } = useAuth();
    const { assets, kpis, isLoading: isWalletLoading } = useWallet();
    
    // 1. Dados Macro
    const macroQuery = useQuery({
        queryKey: ['macroData'],
        queryFn: researchService.getMacroData,
        staleTime: 1000 * 60 * 15, // 15 min
    });

    // 2. Dividendos
    const dividendsQuery = useQuery({
        queryKey: ['dividends'],
        queryFn: walletService.getDividends,
        staleTime: 1000 * 60 * 5, // 5 min
    });

    // 3. Sinais Quantitativos (NOVO)
    const signalsQuery = useQuery({
        queryKey: ['quantSignals'],
        queryFn: async () => {
            const res = await authService.api('/api/research/signals');
            if (!res.ok) return [];
            return await res.json();
        },
        staleTime: 1000 * 60 * 5, // 5 min
    });

    // 4. Research Reports (Legacy para Carteiras Recomendadas)
    const researchQuery = useQuery({
        queryKey: ['dashboardResearch'],
        queryFn: async () => {
            const [stockReport, fiiReport, brasil10Report] = await Promise.all([
                researchService.getLatest('STOCK', 'BUY_HOLD'),
                researchService.getLatest('FII', 'BUY_HOLD'),
                researchService.getLatest('BRASIL_10', 'BUY_HOLD')
            ]);
            return { stockReport, fiiReport, brasil10Report };
        },
        staleTime: 1000 * 60 * 60, // 1 hora
    });

    // --- PROCESSAMENTO ---

    const marketIndices: MarketIndex[] = useMemo(() => {
        const data = macroQuery.data;
        if (!data) return [];
        return [
            { ticker: "IBOV", value: data.ibov?.value || 0, changePercent: data.ibov?.change || 0, type: 'INDEX' },
            { ticker: "CDI", value: data.cdi?.value || 0, changePercent: 0, type: 'RATE' },
            { ticker: "USD", value: data.usd?.value || 0, changePercent: data.usd?.change || 0, type: 'CURRENCY' },
            { ticker: "BTC", value: data.btc?.value || 0, changePercent: data.btc?.change || 0, type: 'CURRENCY' },
            { ticker: "S&P", value: data.spx?.value || 0, changePercent: data.spx?.change || 0, type: 'INDEX' }
        ];
    }, [macroQuery.data]);

    const systemHealth: SystemHealth = useMemo(() => {
        if (macroQuery.isError) return { status: 'OFFLINE', lastSync: null, latencyMs: 0, message: 'Falha na conexão' };
        if (macroQuery.isLoading) return { status: 'OFFLINE', lastSync: null, latencyMs: 0, message: 'Conectando...' };
        
        const data = macroQuery.data;
        let status: 'ONLINE' | 'STALE' | 'OFFLINE' = 'ONLINE';
        let msg = 'Sistemas Operacionais';
        let date = new Date();

        if (data?.lastUpdated) {
            date = new Date(data.lastUpdated);
            const diff = (new Date().getTime() - date.getTime()) / 60000;
            if (diff > 60) {
                status = 'STALE';
                msg = 'Dados Desatualizados (>1h)';
            }
        }
        return { status, lastSync: date, latencyMs: 45, message: msg };
    }, [macroQuery.data, macroQuery.isError, macroQuery.isLoading]);

    const signals: AiSignal[] = useMemo(() => {
        // Mapeamento dos Sinais Quantitativos do Backend
        const rawSignals: QuantSignal[] = signalsQuery.data || [];
        
        const mapped = rawSignals.map(sig => {
            let type: AiSignal['type'] = 'OPPORTUNITY';
            
            let impact: AiSignal['impact'] = 'MEDIUM';
            if (sig.type === 'DEEP_VALUE' || (sig.type === 'RSI_OVERSOLD' && sig.value < 20)) impact = 'HIGH';

            // Simula um score baseado na intensidade do sinal para exibição
            let score = 75;
            if (sig.type === 'RSI_OVERSOLD') score = Math.round(100 - sig.value); 
            if (sig.type === 'DEEP_VALUE') score = 95; // Deep Value é alta convicção
            if (sig.type === 'SUPPORT_ZONE') score = 80;

            return {
                id: sig._id,
                ticker: sig.ticker,
                assetType: sig.assetType || 'STOCK',
                type: type,
                message: sig.message,
                time: new Date(sig.timestamp).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}),
                impact: impact,
                score: score,
                riskProfile: sig.riskProfile || 'MODERATE',
                source: 'ALGO' as const // Sinal algorítmico real
            };
        });

        // Fallback se não houver sinais reais do Scanner (Para não deixar a UI vazia)
        if (mapped.length === 0) {
            const report = researchQuery.data?.brasil10Report;
            if (report?.content?.ranking) {
                return report.content.ranking.slice(0, 3).map((item: RankingItem) => ({
                    id: item.ticker + 'legacy',
                    ticker: item.ticker,
                    assetType: item.type || 'STOCK',
                    type: 'NEUTRAL',
                    message: `Fundamento Sólido: Score ${item.score} (Carteira Brasil 10)`,
                    time: 'Daily',
                    impact: 'LOW',
                    score: item.score,
                    riskProfile: item.riskProfile,
                    source: 'RESEARCH' as const // Sinal de Fallback
                }));
            }
        }

        if (user?.plan === 'ESSENTIAL' || user?.plan === 'GUEST') {
            return mapped.map(s => ({
                ...s,
                type: 'DELAYED',
                message: `[SINAL QUANT PRO] ${s.ticker}: Oportunidade Técnica Detectada.`
            }));
        }
        return mapped;
    }, [signalsQuery.data, researchQuery.data, user?.plan]);

    // Score Map para enriquecer Portfolio
    const scoreMap = useMemo(() => {
        const map = new Map<string, { score: number, action: string }>();
        const process = (rep: any) => {
            if (rep?.content?.ranking) {
                rep.content.ranking.forEach((item: RankingItem) => {
                    const t = item.ticker.replace('.SA', '').trim().toUpperCase();
                    map.set(t, { score: item.score, action: item.action });
                });
            }
        };
        process(researchQuery.data?.stockReport);
        process(researchQuery.data?.fiiReport);
        process(researchQuery.data?.brasil10Report);
        return map;
    }, [researchQuery.data]);

    const portfolio = useMemo(() => {
        return assets.map(asset => {
            const cleanTicker = asset.ticker.trim().toUpperCase();
            const researchData = scoreMap.get(cleanTicker);
            let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
            
            if (researchData) {
                if (researchData.action === 'BUY') sentiment = 'BULLISH';
                else if (researchData.action === 'SELL') sentiment = 'BEARISH';
            }

            return {
                ticker: asset.ticker,
                name: asset.name,
                shares: asset.quantity,
                avgPrice: asset.averagePrice,
                currentPrice: asset.currentPrice,
                type: asset.type, 
                aiScore: researchData ? researchData.score : 0, 
                aiSentiment: sentiment
            };
        });
    }, [assets, scoreMap]);

    const equity = useMemo(() => {
        const ibov = marketIndices.find(m => m.ticker === 'IBOV');
        const ibovChange = ibov ? ibov.changePercent : 0;
        const myChange = kpis.dayVariationPercent;
        const alpha = myChange - ibovChange;

        return {
            total: kpis.totalEquity,
            dayChange: kpis.dayVariation,
            dayPercent: parseFloat(kpis.dayVariationPercent.toFixed(2)),
            alpha: parseFloat(alpha.toFixed(2))
        };
    }, [kpis, marketIndices]);

    const totalDividends = useMemo(() => {
        const prov = dividendsQuery.data?.provisioned;
        if (!Array.isArray(prov)) return 0;
        return prov.reduce((acc: number, curr: any) => acc + (curr.amount || 0), 0);
    }, [dividendsQuery.data]);

    return {
        portfolio,
        signals,
        equity,
        dividends: totalDividends,
        marketIndices,
        systemHealth, 
        isLoading: isWalletLoading || macroQuery.isLoading,
        isResearchLoading: researchQuery.isLoading 
    };
};
