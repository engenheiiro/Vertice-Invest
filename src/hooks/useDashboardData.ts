import { useState, useEffect } from 'react';

// Interfaces
export interface StockRowProps {
    ticker: string;
    name: string;
    change: string;
    price: string;
    positive: boolean;
}

export const useDashboardData = () => {
    const [marketMovers, setMarketMovers] = useState<StockRowProps[]>([]);
    const [stats, setStats] = useState({ monitored: "1,240", precision: "94.2%" });

    useEffect(() => {
        setMarketMovers([
            { ticker: "NVDA", name: "NVIDIA Corp", change: "+2.4%", price: "845.20", positive: true },
            { ticker: "TSLA", name: "Tesla Inc", change: "-1.2%", price: "172.50", positive: false },
            { ticker: "AMD", name: "Advanced Micro", change: "+0.8%", price: "164.10", positive: true }
        ]);
    }, []);

    return {
        marketMovers,
        stats
    };
};