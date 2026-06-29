
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '../contexts/WalletContext';
import { researchService, RankingItem } from '../services/research';
import { walletService } from '../services/wallet';
import { authService } from '../services/auth';
import { STALE_TIME } from '../config/queryConfig';
import { useFeatureAccess } from './useFeatureAccess';
import { DividendGoal } from '../types/dividends';

export interface PortfolioItem {
    ticker: string;
    name: string;
    shares: number;
    avgPrice: number;
    currentPrice: number;
    type: string;
    sector?: string;
    aiScore: number;
    aiSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface AiSignal {
    id: string;
    ticker: string;
    type: 'OPPORTUNITY' | 'RISK' | 'NEUTRAL' | 'DELAYED';
    signalType?: 'RSI_OVERSOLD' | 'DEEP_VALUE' | 'SUPPORT_ZONE' | 'VOLUME_SPIKE' | 'BULLISH_DIVERGENCE';
    assetType: string;
    message: string;
    time: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    probability?: number;
    thesis?: string;
    score?: number;
    value?: number;
    urgencyLevel?: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    riskProfile?: 'DEFENSIVE' | 'MODERATE' | 'BOLD';
    source: 'ALGO' | 'RESEARCH';
    quality?: 'GOLD' | 'SILVER';
}

export interface RadarMeta {
    lastScanAt: string | null;
    nextScanAt: string | null;
    assetsScanned: number;
    assetsWithHistory: number;
    activeSignalsTotal: number;
    scanIntervalMinutes: number;
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

interface QuantSignal {
    _id: string;
    ticker: string;
    assetType: string;
    riskProfile: 'DEFENSIVE' | 'MODERATE' | 'BOLD';
    type: 'RSI_OVERSOLD' | 'VOLUME_SPIKE' | 'DEEP_VALUE' | 'SUPPORT_ZONE' | 'BULLISH_DIVERGENCE';
    quality?: 'GOLD' | 'SILVER';
    urgencyLevel?: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    value: number;
    message: string;
    timestamp: string;
}

export const useDashboardData = () => {
    const { hasPlan } = useFeatureAccess();
    const { assets, kpis, isLoading: isWalletLoading } = useWallet();

    // 1. Dados Macro
    const macroQuery = useQuery({
        queryKey: ['macroData'],
        queryFn: researchService.getMacroData,
        staleTime: STALE_TIME.LONG,
    });

    // 2. Dividendos
    const dividendsQuery = useQuery({
        queryKey: ['dividends'],
        queryFn: walletService.getDividends,
        staleTime: STALE_TIME.SHORT,
    });

    // 3. Sinais Quantitativos — agora retorna { signals, meta }
    const signalsQuery = useQuery({
        queryKey: ['quantSignals'],
        queryFn: async () => {
            const res = await authService.api('/api/research/signals');
            if (!res.ok) return { signals: [], meta: null };
            return await res.json();
        },
        staleTime: STALE_TIME.SHORT,
    });

    // 4. Research Reports (para scoreMap da tabela de carteira)
    const researchQuery = useQuery({
        queryKey: ['dashboardResearch'],
        queryFn: async () => {
            // allSettled: a falha de um relatório não derruba os outros dois.
            const [stock, fii, brasil10] = await Promise.allSettled([
                researchService.getLatest('STOCK', 'BUY_HOLD'),
                researchService.getLatest('FII', 'BUY_HOLD'),
                researchService.getLatest('BRASIL_10', 'BUY_HOLD')
            ]);
            const valueOrNull = (r: PromiseSettledResult<any>) =>
                r.status === 'fulfilled' ? r.value : null;
            return {
                stockReport: valueOrNull(stock),
                fiiReport: valueOrNull(fii),
                brasil10Report: valueOrNull(brasil10),
            };
        },
        staleTime: STALE_TIME.HOURLY,
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

    // Metadata do Radar Alfa (countdown, contexto de scan)
    const radarMeta: RadarMeta | null = useMemo(() => {
        return signalsQuery.data?.meta || null;
    }, [signalsQuery.data]);

    const isProUser = hasPlan('PRO');
    const signals: AiSignal[] = useMemo(() => {
        const rawSignals: QuantSignal[] = signalsQuery.data?.signals || [];

        const mapped = rawSignals.map(sig => {
            let impact: AiSignal['impact'] = 'MEDIUM';
            if (sig.urgencyLevel === 'CRITICAL' || sig.quality === 'GOLD') impact = 'HIGH';
            else if (sig.urgencyLevel === 'HIGH') impact = 'HIGH';

            let score = 75;
            if (sig.type === 'RSI_OVERSOLD') score = Math.round(100 - sig.value);
            if (sig.type === 'BULLISH_DIVERGENCE') score = Math.round(100 - sig.value);
            if (sig.type === 'DEEP_VALUE') score = 95;
            if (sig.type === 'SUPPORT_ZONE') score = 80;
            if (sig.quality === 'SILVER') score -= 10;
            score = Math.max(0, Math.min(100, score));

            return {
                id: sig._id,
                ticker: sig.ticker,
                assetType: sig.assetType || 'STOCK',
                type: 'OPPORTUNITY' as const,
                signalType: sig.type,
                message: sig.message,
                time: new Date(sig.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                impact,
                score,
                value: sig.value,
                urgencyLevel: sig.urgencyLevel || (sig.quality === 'GOLD' ? 'HIGH' : 'MEDIUM'),
                riskProfile: sig.riskProfile || 'MODERATE',
                source: 'ALGO' as const,
                quality: sig.quality || 'GOLD'
            };
        });

        if (!isProUser) {
            return mapped.map(s => ({
                ...s,
                type: 'DELAYED' as const,
                message: `[SINAL QUANT PRO] ${s.ticker}: Oportunidade Técnica Detectada.`
            }));
        }

        return mapped;
    }, [signalsQuery.data, isProUser]);

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
                name: asset.name || asset.ticker,
                shares: asset.quantity,
                avgPrice: asset.averagePrice,
                currentPrice: asset.currentPrice,
                type: asset.type,
                sector: asset.sector,
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

    const dividendGoal: DividendGoal | null = dividendsQuery.data?.goal ?? null;

    return {
        portfolio,
        signals,
        radarMeta,
        equity,
        dividends: totalDividends,
        dividendGoal,
        marketIndices,
        systemHealth,
        isLoading: isWalletLoading || macroQuery.isLoading,
        isResearchLoading: researchQuery.isLoading
    };
};
