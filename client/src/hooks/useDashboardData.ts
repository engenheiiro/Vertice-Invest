
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { researchService, RankingItem } from '../services/research';

// Interfaces
export interface PortfolioItem {
    ticker: string;
    name: string;
    shares: number;
    avgPrice: number;
    currentPrice: number;
    aiScore: number; 
    aiSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface AiSignal {
    id: string;
    ticker: string;
    type: 'OPPORTUNITY' | 'RISK' | 'NEUTRAL' | 'DELAYED';
    message: string;
    time: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    probability?: number; 
    thesis?: string;      
    // Novos Campos
    score?: number;
    riskProfile?: 'DEFENSIVE' | 'MODERATE' | 'BOLD';
}

export interface MarketIndex {
    ticker: string;
    value: number;
    changePercent: number;
}

export const useDashboardData = () => {
    const { user } = useAuth();
    const { assets, kpis, isLoading: isWalletLoading } = useWallet();
    
    const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
    const [signals, setSignals] = useState<AiSignal[]>([]);
    const [equity, setEquity] = useState({ total: 0, dayChange: 0, dayPercent: 0 });
    const [marketIndices, setMarketIndices] = useState<MarketIndex[]>([]);
    const [isLoadingResearch, setIsLoadingResearch] = useState(true);

    // 1. Carrega Dados da Carteira (WalletContext)
    useEffect(() => {
        const mappedPortfolio: PortfolioItem[] = assets.map(asset => ({
            ticker: asset.ticker,
            name: asset.name,
            shares: asset.quantity,
            avgPrice: asset.averagePrice,
            currentPrice: asset.currentPrice,
            aiScore: Math.floor(Math.random() * (99 - 40) + 40), // Ainda mockado até termos endpoint de score individual
            aiSentiment: Math.random() > 0.5 ? 'BULLISH' : (Math.random() > 0.5 ? 'NEUTRAL' : 'BEARISH')
        }));

        setPortfolio(mappedPortfolio);

        setEquity({
            total: kpis.totalEquity,
            dayChange: kpis.dayVariation,
            dayPercent: parseFloat(kpis.dayVariationPercent.toFixed(2))
        });
    }, [assets, kpis]);

    // 2. Carrega Dados de Research Reais (Neural Engine)
    useEffect(() => {
        const fetchAiSignals = async () => {
            setIsLoadingResearch(true);
            try {
                // Busca o relatório principal (Brasil 10) para popular o Radar
                const report = await researchService.getLatest('BRASIL_10', 'BUY_HOLD');
                
                if (report && report.content && report.content.ranking) {
                    const mappedSignals: AiSignal[] = report.content.ranking
                        .slice(0, 5) // Pega apenas o Top 5 para o Radar
                        .map((item: RankingItem) => {
                            
                            // Mapeia Ação para Tipo de Sinal
                            let type: AiSignal['type'] = 'NEUTRAL';
                            if (item.action === 'BUY') type = 'OPPORTUNITY';
                            if (item.action === 'SELL') type = 'RISK';

                            // Mapeia Score para Impacto
                            let impact: AiSignal['impact'] = 'LOW';
                            if (item.score >= 80) impact = 'HIGH';
                            else if (item.score >= 60) impact = 'MEDIUM';

                            return {
                                id: item.ticker + report._id,
                                ticker: item.ticker,
                                type: type,
                                message: item.reason,
                                time: new Date(report.date || report.createdAt).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'}),
                                impact: impact,
                                probability: item.probability,
                                thesis: item.thesis,
                                score: item.score, // Mapeado
                                riskProfile: item.riskProfile // Mapeado
                            };
                        });

                    // Aplica lógica de Delay para planos inferiores
                    if (user?.plan === 'ESSENTIAL' || user?.plan === 'GUEST') {
                        const delayedSignals = mappedSignals.map(signal => ({
                            ...signal,
                            type: 'DELAYED' as const,
                            message: `[CONTEÚDO PRO BLOQUEADO] ${signal.message.substring(0, 20)}...`
                        }));
                        setSignals(delayedSignals);
                    } else {
                        setSignals(mappedSignals);
                    }
                } else {
                    // Fallback se não houver relatório gerado ainda
                    setSignals([]); 
                }
            } catch (error) {
                console.error("Falha ao carregar sinais do radar:", error);
            } finally {
                setIsLoadingResearch(false);
            }
        };

        fetchAiSignals();
    }, [user?.plan]);

    // 3. Dados de Mercado (Mockados por enquanto, idealmente viriam de uma API de cotação externa)
    useEffect(() => {
        setMarketIndices([
            { ticker: "IBOV", value: 128500, changePercent: 0.45 },
            { ticker: "S&P 500", value: 5200, changePercent: -0.12 },
            { ticker: "NASDAQ", value: 16400, changePercent: 0.85 },
            { ticker: "USD/BRL", value: 4.98, changePercent: -0.50 },
            { ticker: "BTC/USD", value: 64500, changePercent: 1.25 },
        ]);
    }, []);

    return {
        portfolio,
        signals,
        equity,
        dividends: kpis.totalDividends,
        marketIndices,
        isLoading: isWalletLoading || isLoadingResearch
    };
};
