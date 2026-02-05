
import { Asset } from '../contexts/WalletContext';

// Simulação: Aporte Único em 01/01/2024 (1 Cota de cada ativo)
// Objetivo: Total Equity ~517.24, Total Invested ~369.06

export const DEMO_ASSETS: Asset[] = [
    // 1. SABESP
    {
        id: 'demo-sbsp3', ticker: 'SBSP3', name: 'Sabesp', type: 'STOCK',
        quantity: 1, averagePrice: 70.27, currentPrice: 142.53, 
        totalValue: 142.53, totalCost: 70.27, profit: 72.26, profitPercent: 102.83, 
        currency: 'BRL', sector: 'Saneamento', dayChangePct: 1.5
    },
    // 2. VALE
    {
        id: 'demo-vale3', ticker: 'VALE3', name: 'Vale', type: 'STOCK',
        quantity: 1, averagePrice: 74.65, currentPrice: 88.83, 
        totalValue: 88.83, totalCost: 74.65, profit: 14.18, profitPercent: 19.00, 
        currency: 'BRL', sector: 'Mineração', dayChangePct: -0.5
    },
    // 3. COPASA
    {
        id: 'demo-csmg3', ticker: 'CSMG3', name: 'Copasa', type: 'STOCK',
        quantity: 1, averagePrice: 20.61, currentPrice: 52.75, 
        totalValue: 52.75, totalCost: 20.61, profit: 32.14, profitPercent: 155.94, 
        currency: 'BRL', sector: 'Saneamento', dayChangePct: 0.8
    },
    // 4. ENERGISA
    {
        id: 'demo-engi11', ticker: 'ENGI11', name: 'Energisa', type: 'STOCK',
        quantity: 1, averagePrice: 47.64, currentPrice: 49.68, 
        totalValue: 49.68, totalCost: 47.64, profit: 2.04, profitPercent: 4.28, 
        currency: 'BRL', sector: 'Elétricas', dayChangePct: 0.1
    },
    // 5. SANEPAR
    {
        id: 'demo-sapr11', ticker: 'SAPR11', name: 'Sanepar Unit', type: 'STOCK',
        quantity: 1, averagePrice: 27.66, currentPrice: 45.58, 
        totalValue: 45.58, totalCost: 27.66, profit: 17.92, profitPercent: 64.79, 
        currency: 'BRL', sector: 'Saneamento', dayChangePct: -0.2
    },
    // 6. TAESA
    {
        id: 'demo-taee11', ticker: 'TAEE11', name: 'Taesa', type: 'STOCK',
        quantity: 1, averagePrice: 37.60, currentPrice: 40.95, 
        totalValue: 40.95, totalCost: 37.60, profit: 3.35, profitPercent: 8.91, 
        currency: 'BRL', sector: 'Elétricas', dayChangePct: 0.1
    },
    // 7. EQUATORIAL
    {
        id: 'demo-eqtl3', ticker: 'EQTL3', name: 'Equatorial', type: 'STOCK',
        quantity: 1, averagePrice: 34.54, currentPrice: 39.93, 
        totalValue: 39.93, totalCost: 34.54, profit: 5.39, profitPercent: 15.61, 
        currency: 'BRL', sector: 'Elétricas', dayChangePct: 0.4
    },
    // 8. PETROBRAS
    {
        id: 'demo-petr4', ticker: 'PETR4', name: 'Petrobras PN', type: 'STOCK',
        quantity: 1, averagePrice: 38.72, currentPrice: 37.30, 
        totalValue: 37.30, totalCost: 38.72, profit: -1.42, profitPercent: -3.67, 
        currency: 'BRL', sector: 'Petróleo', dayChangePct: 1.2
    },
    // 9. ITAÚSA
    {
        id: 'demo-itsa4', ticker: 'ITSA4', name: 'Itaúsa', type: 'STOCK',
        quantity: 1, averagePrice: 17.37, currentPrice: 19.69, 
        totalValue: 19.69, totalCost: 17.37, profit: 2.32, profitPercent: 13.36, 
        currency: 'BRL', sector: 'Bancos', dayChangePct: -0.3
    }
];

export const DEMO_KPIS = {
    totalEquity: 517.24, 
    totalInvested: 369.06,
    totalResult: 148.18, 
    totalResultPercent: 40.15, 
    dayVariation: 4.12, 
    dayVariationPercent: 0.80,
    totalDividends: 46.71, 
    projectedDividends: 3.00,
    weightedRentability: 40.15 
};

export const DEMO_HISTORY = [
    { date: '2024-01-01', totalEquity: 369.06, totalInvested: 369.06, profit: 0 },
    { date: '2024-02-01', totalEquity: 375.20, totalInvested: 369.06, profit: 6.14 },
    { date: '2024-03-01', totalEquity: 382.50, totalInvested: 369.06, profit: 13.44 },
    { date: '2024-04-01', totalEquity: 395.10, totalInvested: 369.06, profit: 26.04 },
    { date: '2024-05-01', totalEquity: 410.80, totalInvested: 369.06, profit: 41.74 },
    { date: '2024-06-01', totalEquity: 405.50, totalInvested: 369.06, profit: 36.44 },
    { date: '2024-07-01', totalEquity: 422.30, totalInvested: 369.06, profit: 53.24 },
    { date: '2024-08-01', totalEquity: 445.60, totalInvested: 369.06, profit: 76.54 },
    { date: '2024-09-01', totalEquity: 468.90, totalInvested: 369.06, profit: 99.84 },
    { date: '2024-10-01', totalEquity: 480.10, totalInvested: 369.06, profit: 111.04 },
    { date: '2024-11-01', totalEquity: 498.50, totalInvested: 369.06, profit: 129.44 },
    { date: '2024-12-01', totalEquity: 517.24, totalInvested: 369.06, profit: 148.18 },
];

// Dados para Gráfico de Rentabilidade (vs CDI/Ibov)
export const DEMO_PERFORMANCE = [
    { date: '2024-01-01', wallet: 0, walletRoi: 0, cdi: 0.8, ibov: -4.8 },
    { date: '2024-02-01', wallet: 1.6, walletRoi: 1.6, cdi: 1.6, ibov: -1.0 },
    { date: '2024-03-01', wallet: 3.6, walletRoi: 3.6, cdi: 2.5, ibov: -1.9 },
    { date: '2024-04-01', wallet: 7.0, walletRoi: 7.0, cdi: 3.4, ibov: -3.6 },
    { date: '2024-05-01', wallet: 11.3, walletRoi: 11.3, cdi: 4.3, ibov: -6.0 },
    { date: '2024-06-01', wallet: 9.8, walletRoi: 9.8, cdi: 5.2, ibov: -4.5 },
    { date: '2024-07-01', wallet: 14.4, walletRoi: 14.4, cdi: 6.1, ibov: -1.5 },
    { date: '2024-08-01', wallet: 20.7, walletRoi: 20.7, cdi: 7.0, ibov: 5.0 },
    { date: '2024-09-01', wallet: 27.0, walletRoi: 27.0, cdi: 7.9, ibov: 4.0 },
    { date: '2024-10-01', wallet: 30.1, walletRoi: 30.1, cdi: 8.8, ibov: 3.5 },
    { date: '2024-11-01', wallet: 35.0, walletRoi: 35.0, cdi: 9.7, ibov: 1.5 },
    { date: '2024-12-01', wallet: 40.15, walletRoi: 40.15, cdi: 10.8, ibov: -2.0 },
];

// Dados para Dividendos (Histórico + Provisões)
export const DEMO_DIVIDENDS = {
    history: [
        { month: '2024-02', value: 2.15, breakdown: [{ ticker: 'SBSP3', amount: 1.15 }, { ticker: 'TAEE11', amount: 1.00 }] },
        { month: '2024-03', value: 3.40, breakdown: [{ ticker: 'VALE3', amount: 2.40 }, { ticker: 'ITSA4', amount: 1.00 }] },
        { month: '2024-04', value: 1.80, breakdown: [{ ticker: 'PETR4', amount: 1.80 }] },
        { month: '2024-05', value: 4.20, breakdown: [{ ticker: 'SAPR11', amount: 4.20 }] },
        { month: '2024-06', value: 2.50, breakdown: [{ ticker: 'ENGI11', amount: 2.50 }] },
        { month: '2024-07', value: 3.10, breakdown: [{ ticker: 'TAEE11', amount: 3.10 }] },
        { month: '2024-08', value: 5.50, breakdown: [{ ticker: 'PETR4', amount: 5.50 }] },
        { month: '2024-09', value: 2.90, breakdown: [{ ticker: 'CSMG3', amount: 2.90 }] },
        { month: '2024-10', value: 4.10, breakdown: [{ ticker: 'VALE3', amount: 4.10 }] },
        { month: '2024-11', value: 3.80, breakdown: [{ ticker: 'EQTL3', amount: 3.80 }] },
        { month: '2024-12', value: 13.26, breakdown: [{ ticker: 'SBSP3', amount: 13.26 }] },
    ],
    provisioned: [
        { ticker: 'PETR4', date: '2025-01-20', amount: 4.50 },
        { ticker: 'VALE3', date: '2025-02-15', amount: 3.20 },
        { ticker: 'TAEE11', date: '2025-02-28', amount: 1.80 }
    ],
    totalAllTime: 46.71,
    projectedMonthly: 3.89
};

// Dados para Extrato (Transações)
export const DEMO_TRANSACTIONS = {
    transactions: DEMO_ASSETS.map((asset, index) => ({
        _id: `tx-${index}`,
        type: 'BUY',
        ticker: asset.ticker,
        quantity: asset.quantity,
        price: asset.averagePrice,
        totalValue: asset.totalCost,
        date: '2024-01-05', // Data de compra simulada
        isCashOp: false
    })),
    pagination: { hasMore: false, currentPage: 1, totalPages: 1, totalItems: DEMO_ASSETS.length }
};
