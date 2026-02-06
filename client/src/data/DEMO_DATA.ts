
import { Asset } from '../contexts/WalletContext';

// Simulação: Valores exatos solicitados para o Tutorial
// Objetivo: Total Equity 526.07 | Profit 203.73 | ROI 42.54% | Weighted 96.44%

export const DEMO_ASSETS: Asset[] = [
    // 1. SABESP (Grande vencedor da carteira simulada)
    {
        id: 'demo-sbsp3', ticker: 'SBSP3', name: 'Sabesp', type: 'STOCK',
        quantity: 2, averagePrice: 55.00, currentPrice: 105.50, 
        totalValue: 211.00, totalCost: 110.00, profit: 101.00, profitPercent: 91.81, 
        currency: 'BRL', sector: 'Saneamento', dayChangePct: 1.5
    },
    // 2. WEG (Consistência)
    {
        id: 'demo-wege3', ticker: 'WEGE3', name: 'WEG S.A.', type: 'STOCK',
        quantity: 2, averagePrice: 32.00, currentPrice: 56.50, 
        totalValue: 113.00, totalCost: 64.00, profit: 49.00, profitPercent: 76.56, 
        currency: 'BRL', sector: 'Indústria', dayChangePct: 0.8
    },
    // 3. NVDA (Fracionado BDR ou Stock para caber no valor)
    {
        id: 'demo-nvda', ticker: 'NVDA', name: 'NVIDIA Corp', type: 'STOCK_US',
        quantity: 0.2, averagePrice: 380.00, currentPrice: 820.00, 
        totalValue: 164.00, totalCost: 76.00, profit: 88.00, profitPercent: 115.78, 
        currency: 'USD', sector: 'Tecnologia', dayChangePct: 2.1
    },
    // 4. Tesouro (Caixa/Segurança)
    {
        id: 'demo-selic', ticker: 'TESOURO SELIC', name: 'Tesouro Selic 2029', type: 'FIXED_INCOME',
        quantity: 0.0025, averagePrice: 13500, currentPrice: 15228, 
        totalValue: 38.07, totalCost: 33.75, profit: 4.32, profitPercent: 12.80, 
        currency: 'BRL', sector: 'Governo', dayChangePct: 0.04
    }
];

// Valores KPIs Exatos conforme solicitado
export const DEMO_KPIS = {
    totalEquity: 526.07, 
    totalInvested: 322.34, // (526.07 - 203.73)
    totalResult: 203.73, 
    totalResultPercent: 42.54, // ROI
    dayVariation: 4.12, 
    dayVariationPercent: 0.79,
    totalDividends: 46.72, 
    projectedDividends: 3.89,
    weightedRentability: 96.44 
};

// Histórico ajustado para curva ascendente forte (Simulando o ganho ponderado alto)
export const DEMO_HISTORY = [
    { date: '2024-01-01', totalEquity: 322.34, totalInvested: 322.34, profit: 0 },
    { date: '2024-02-01', totalEquity: 330.50, totalInvested: 322.34, profit: 8.16 },
    { date: '2024-03-01', totalEquity: 345.20, totalInvested: 322.34, profit: 22.86 },
    { date: '2024-04-01', totalEquity: 358.90, totalInvested: 322.34, profit: 36.56 },
    { date: '2024-05-01', totalEquity: 380.40, totalInvested: 322.34, profit: 58.06 },
    { date: '2024-06-01', totalEquity: 375.10, totalInvested: 322.34, profit: 52.76 },
    { date: '2024-07-01', totalEquity: 405.60, totalInvested: 322.34, profit: 83.26 },
    { date: '2024-08-01', totalEquity: 435.80, totalInvested: 322.34, profit: 113.46 },
    { date: '2024-09-01', totalEquity: 460.20, totalInvested: 322.34, profit: 137.86 },
    { date: '2024-10-01', totalEquity: 482.50, totalInvested: 322.34, profit: 160.16 },
    { date: '2024-11-01', totalEquity: 505.30, totalInvested: 322.34, profit: 182.96 },
    { date: '2024-12-01', totalEquity: 526.07, totalInvested: 322.34, profit: 203.73 },
];

export const DEMO_PERFORMANCE = [
    { date: '2024-01-01', wallet: 0, walletRoi: 0, cdi: 0.8, ibov: -1.5 },
    { date: '2024-02-01', wallet: 5.5, walletRoi: 2.5, cdi: 1.6, ibov: -3.2 },
    { date: '2024-03-01', wallet: 12.2, walletRoi: 7.1, cdi: 2.5, ibov: -2.1 },
    { date: '2024-04-01', wallet: 22.5, walletRoi: 11.3, cdi: 3.4, ibov: 0.5 },
    { date: '2024-05-01', wallet: 35.4, walletRoi: 18.0, cdi: 4.3, ibov: -1.8 },
    { date: '2024-06-01', wallet: 31.1, walletRoi: 16.3, cdi: 5.2, ibov: 2.4 },
    { date: '2024-07-01', wallet: 48.6, walletRoi: 25.8, cdi: 6.1, ibov: 4.1 },
    { date: '2024-08-01', wallet: 62.3, walletRoi: 35.2, cdi: 7.0, ibov: 6.5 },
    { date: '2024-09-01', wallet: 75.8, walletRoi: 42.7, cdi: 7.9, ibov: 3.2 },
    { date: '2024-10-01', wallet: 84.2, walletRoi: 49.6, cdi: 8.8, ibov: 1.8 },
    { date: '2024-11-01', wallet: 92.5, walletRoi: 56.7, cdi: 9.7, ibov: 4.5 },
    { date: '2024-12-01', wallet: 96.44, walletRoi: 42.54, cdi: 10.8, ibov: 3.2 }, // Termina positivo
];

export const DEMO_DIVIDENDS = {
    history: [
        { month: '2024-02', value: 2.50, breakdown: [{ ticker: 'SBSP3', amount: 2.50 }] },
        { month: '2024-03', value: 3.80, breakdown: [{ ticker: 'WEGE3', amount: 3.80 }] },
        { month: '2024-04', value: 1.20, breakdown: [{ ticker: 'TESOURO', amount: 1.20 }] },
        { month: '2024-05', value: 5.50, breakdown: [{ ticker: 'NVDA', amount: 5.50 }] },
        { month: '2024-06', value: 3.10, breakdown: [{ ticker: 'SBSP3', amount: 3.10 }] },
        { month: '2024-07', value: 4.20, breakdown: [{ ticker: 'WEGE3', amount: 4.20 }] },
        { month: '2024-08', value: 6.80, breakdown: [{ ticker: 'NVDA', amount: 6.80 }] },
        { month: '2024-09', value: 2.50, breakdown: [{ ticker: 'TESOURO', amount: 2.50 }] },
        { month: '2024-10', value: 4.90, breakdown: [{ ticker: 'SBSP3', amount: 4.90 }] },
        { month: '2024-11', value: 5.10, breakdown: [{ ticker: 'WEGE3', amount: 5.10 }] },
        { month: '2024-12', value: 7.12, breakdown: [{ ticker: 'NVDA', amount: 7.12 }] },
    ],
    provisioned: [
        { ticker: 'WEGE3', date: '2025-01-20', amount: 2.80 },
        { ticker: 'SBSP3', date: '2025-02-15', amount: 3.15 },
        { ticker: 'NVDA', date: '2025-02-28', amount: 5.20 }
    ],
    totalAllTime: 46.72,
    projectedMonthly: 3.89
};

export const DEMO_TRANSACTIONS = {
    transactions: DEMO_ASSETS.map((asset, index) => ({
        _id: `tx-${index}`,
        type: 'BUY',
        ticker: asset.ticker,
        quantity: asset.quantity,
        price: asset.averagePrice,
        totalValue: asset.totalCost,
        date: '2024-01-05',
        isCashOp: false
    })),
    pagination: { hasMore: false, currentPage: 1, totalPages: 1, totalItems: DEMO_ASSETS.length }
};
