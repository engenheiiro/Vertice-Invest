
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { researchService, RankingItem } from '../services/research';

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
    
    // Cache local de scores para evitar fetch excessivo
    const [scoreMap, setScoreMap] = useState<Map<string, { score: number, action: string }>>(new Map());

    // 1. Fetch Research Data & Build Score Map
    useEffect(() => {
        const fetchResearch = async () => {
            setIsLoadingResearch(true);
            try {
                // Busca os relatórios principais para cruzar dados
                const [stockReport, fiiReport, brasil10Report] = await Promise.all([
                    researchService.getLatest('STOCK', 'BUY_HOLD'),
                    researchService.getLatest('FII', 'BUY_HOLD'),
                    researchService.getLatest('BRASIL_10', 'BUY_HOLD')
                ]);

                const newMap = new Map();
                
                // Helper para popular o mapa
                const processReport = (rep: any) => {
                    if (rep?.content?.ranking) {
                        rep.content.ranking.forEach((item: RankingItem) => {
                            newMap.set(item.ticker, { score: item.score, action: item.action });
                        });
                    }
                };

                processReport(stockReport);
                processReport(fiiReport);
                
                setScoreMap(newMap);

                // --- POPULAR RADAR (Signals) ---
                if (brasil10Report?.content?.ranking) {
                    const mappedSignals: AiSignal[] = brasil10Report.content.ranking
                        .slice(0, 5)
                        .map((item: RankingItem) => {
                            let type: AiSignal['type'] = 'NEUTRAL';
                            if (item.action === 'BUY') type = 'OPPORTUNITY';
                            if (item.action === 'SELL') type = 'RISK';

                            let impact: AiSignal['impact'] = 'LOW';
                            if (item.score >= 80) impact = 'HIGH';
                            else if (item.score >= 60) impact = 'MEDIUM';

                            return {
                                id: item.ticker + brasil10Report._id,
                                ticker: item.ticker,
                                type: type,
                                message: item.reason || item.bullThesis?.[0] || 'Fundamentos sólidos.',
                                time: new Date(brasil10Report.date || brasil10Report.createdAt!).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'}),
                                impact: impact,
                                probability: item.probability,
                                thesis: item.thesis,
                                score: item.score,
                                riskProfile: item.riskProfile
                            };
                        });

                    if (user?.plan === 'ESSENTIAL' || user?.plan === 'GUEST') {
                        setSignals(mappedSignals.map(s => ({
                            ...s,
                            type: 'DELAYED',
                            message: `[CONTEÚDO PRO] ${s.message.substring(0, 15)}...`
                        })));
                    } else {
                        setSignals(mappedSignals);
                    }
                }

            } catch (err) {
                console.error("Erro ao carregar research:", err);
            } finally {
                setIsLoadingResearch(false);
            }
        };

        fetchResearch();
    }, [user?.plan]);

    // 2. Mapeia Carteira com Scores Reais
    useEffect(() => {
        const mappedPortfolio: PortfolioItem[] = assets.map(asset => {
            const researchData = scoreMap.get(asset.ticker);
            
            // Determina sentimento baseado na ação da IA
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
                // Usa o score real se existir, senão usa 50 (Neutro)
                aiScore: researchData ? researchData.score : 50, 
                aiSentiment: sentiment
            };
        });

        setPortfolio(mappedPortfolio);

        setEquity({
            total: kpis.totalEquity,
            dayChange: kpis.dayVariation,
            dayPercent: parseFloat(kpis.dayVariationPercent.toFixed(2))
        });
    }, [assets, kpis, scoreMap]);

    // 3. Dados Macro (Mockados/Placeholder)
    useEffect(() => {
        setMarketIndices([
            { ticker: "IBOV", value: 128500, changePercent: 0.45 },
            { ticker: "CDI", value: 11.15, changePercent: 0.00 },
            { ticker: "USD", value: 5.65, changePercent: -0.50 },
            { ticker: "BTC", value: 64500, changePercent: 1.25 },
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
