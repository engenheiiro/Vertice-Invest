import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';

// Interfaces (Mantidas para compatibilidade com os componentes do Dashboard)
export interface PortfolioItem {
    ticker: string;
    name: string;
    shares: number;
    avgPrice: number;
    currentPrice: number;
    aiScore: number; // 0 a 100
    aiSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface AiSignal {
    id: string;
    ticker: string;
    type: 'OPPORTUNITY' | 'RISK' | 'DELAYED';
    message: string;
    time: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface MarketIndex {
    ticker: string;
    value: number;
    changePercent: number;
}

export const useDashboardData = () => {
    const { user } = useAuth();
    const { assets, kpis, isLoading: isWalletLoading } = useWallet(); // Conexão com a Fonte da Verdade
    
    const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
    const [signals, setSignals] = useState<AiSignal[]>([]);
    const [equity, setEquity] = useState({ total: 0, dayChange: 0, dayPercent: 0 });
    const [marketIndices, setMarketIndices] = useState<MarketIndex[]>([]);

    useEffect(() => {
        // 1. Converter Assets do WalletContext para PortfolioItem do Dashboard
        // Isso adapta a estrutura nova para a visualização antiga sem quebrar componentes
        const mappedPortfolio: PortfolioItem[] = assets.map(asset => ({
            ticker: asset.ticker,
            name: asset.name,
            shares: asset.quantity,
            avgPrice: asset.averagePrice,
            currentPrice: asset.currentPrice,
            // Mock de IA Score (futuramente virá do Backend de Research)
            aiScore: Math.floor(Math.random() * (99 - 40) + 40), 
            aiSentiment: Math.random() > 0.5 ? 'BULLISH' : (Math.random() > 0.5 ? 'NEUTRAL' : 'BEARISH')
        }));

        setPortfolio(mappedPortfolio);

        // 2. Usar KPIs reais do Contexto
        setEquity({
            total: kpis.totalEquity,
            dayChange: kpis.dayVariation,
            dayPercent: parseFloat(kpis.dayVariationPercent.toFixed(2))
        });

        // 3. Sinais e Índices continuam mockados aqui pois são dados de MERCADO, não do USUÁRIO
        // (Futuramente mover para um MarketContext se necessário)
        const rawSignals: AiSignal[] = [
            { id: '1', ticker: 'NVDA', type: 'OPPORTUNITY', message: 'Rompimento de máxima histórica com volume anômalo.', time: '2 min', impact: 'HIGH' },
            { id: '2', ticker: 'BRL/USD', type: 'RISK', message: 'Fluxo cambial negativo detectado na abertura.', time: '15 min', impact: 'MEDIUM' },
            { id: '3', ticker: 'ETH', type: 'OPPORTUNITY', message: 'Acumulação de baleias identificada on-chain.', time: '42 min', impact: 'HIGH' },
        ];

        // Lógica de Delay para planos Essential
        if (user?.plan === 'ESSENTIAL') {
            const delayedSignals = rawSignals.map(signal => ({
                ...signal,
                time: '7 dias atrás',
                type: 'DELAYED' as const,
                message: `[SINAL HISTÓRICO] ${signal.message}`
            }));
            setSignals(delayedSignals);
        } else {
            setSignals(rawSignals);
        }

        setMarketIndices([
            { ticker: "IBOV", value: 128500, changePercent: 0.45 },
            { ticker: "S&P 500", value: 5200, changePercent: -0.12 },
            { ticker: "NASDAQ", value: 16400, changePercent: 0.85 },
            { ticker: "USD/BRL", value: 4.98, changePercent: -0.50 },
            { ticker: "BTC/USD", value: 64500, changePercent: 1.25 },
        ]);

    }, [assets, kpis, user?.plan]);

    return {
        portfolio,
        signals,
        equity,
        dividends: kpis.totalDividends, // Agora vem do cálculo real dos ativos
        marketIndices,
        isLoading: isWalletLoading
    };
};