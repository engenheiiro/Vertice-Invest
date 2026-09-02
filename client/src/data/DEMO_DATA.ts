
import { Asset } from '../contexts/WalletContext';

// Simulação: Valores exatos solicitados para o Tutorial
// Objetivo: Total Equity 526.07 | Profit 203.73 | ROI 42.54% | Weighted 96.44%

export const DEMO_ASSETS: Asset[] = [
    // 1. SABESP (Grande vencedor da carteira simulada)
    {
        id: 'demo-sbsp3', ticker: 'SBSP3', name: 'Sabesp', type: 'STOCK',
        quantity: 2, averagePrice: 55.00, currentPrice: 105.50, 
        totalValue: 211.00, totalCost: 110.00, profit: 101.00, profitPercent: 91.81, 
        currency: 'BRL', sector: 'Saneamento', dayChangePct: 1.49, dayChangeValue: 3.10, dayChangeReason: 'ANCHOR_CLOSE'
    },
    // 2. WEG (Consistência)
    {
        id: 'demo-wege3', ticker: 'WEGE3', name: 'WEG S.A.', type: 'STOCK',
        quantity: 2, averagePrice: 32.00, currentPrice: 56.50, 
        totalValue: 113.00, totalCost: 64.00, profit: 49.00, profitPercent: 76.56, 
        currency: 'BRL', sector: 'Indústria', dayChangePct: -0.92, dayChangeValue: -1.05, dayChangeReason: 'ANCHOR_CLOSE'
    },
    // 3. NVDA (Fracionado BDR ou Stock para caber no valor)
    {
        id: 'demo-nvda', ticker: 'NVDA', name: 'NVIDIA Corp', type: 'STOCK_US',
        quantity: 0.2, averagePrice: 380.00, currentPrice: 820.00, 
        totalValue: 164.00, totalCost: 76.00, profit: 88.00, profitPercent: 115.78, 
        currency: 'USD', sector: 'Tecnologia', dayChangePct: 1.27, dayChangeValue: 2.05, dayChangeReason: 'ANCHOR_CLOSE'
    },
    // 4. Tesouro (Caixa/Segurança)
    {
        id: 'demo-selic', ticker: 'TESOURO SELIC', name: 'Tesouro Selic 2029', type: 'FIXED_INCOME',
        quantity: 0.0025, averagePrice: 13500, currentPrice: 15228, 
        totalValue: 38.07, totalCost: 33.75, profit: 4.32, profitPercent: 12.80, 
        currency: 'BRL', sector: 'Governo', dayChangePct: 0.05, dayChangeValue: 0.02, dayChangeReason: 'FIXED_INCOME_MTM'
    }
];

/**
 * Dia útil anterior, para o detalhamento do dia nomear a âncora no tour em vez
 * de exibir uma data fixa que envelhece. Datas locais montadas peça por peça:
 * `toISOString` converte para UTC e devolveria o dia anterior à noite no Brasil.
 */
const previousBusinessDayKey = (): string => {
    const d = new Date();
    do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Valores KPIs Exatos conforme solicitado
export const DEMO_KPIS = {
    totalEquity: 526.07,
    totalInvested: 322.34, // (526.07 - 203.73)
    totalResult: 203.73,
    totalResultPercent: 42.54, // ROI
    // As contribuições por ativo em DEMO_ASSETS somam exatamente este valor
    // (3,10 + 2,05 + 0,02 − 1,05). Mexer num dos lados sem o outro faz o
    // detalhamento do dia abrir no tour com uma conta que não fecha.
    dayVariation: 4.12,
    dayVariationPercent: 0.79,
    dayAnchorDate: previousBusinessDayKey(),
    // Zero de propósito: inventar provento na demo é inventar renda.
    dayDividends: 0,
    totalDividends: 46.72, 
    projectedDividends: 3.89,
    weightedRentability: 96.44 
};

// Histórico DEMO (tour/onboarding/marketing). Gerado em granularidade DIÁRIA para o
// gráfico de Evolução exibir uma curva ondulada e viva — como no protótipo — tanto na
// visão Diária quanto na Mensal (que agrega por mês). NÃO é dado real: a carteira real
// reflete os snapshots do usuário (uma carteira 100% caixa, p.ex., é uma reta correta).
const DEMO_INVESTED = 322.34;
// Âncoras mensais de patrimônio: definem a TENDÊNCIA (inclui a correção de junho).
const DEMO_EQUITY_ANCHORS = [
    322.34, 330.50, 345.20, 358.90, 380.40, 375.10,
    405.60, 435.80, 460.20, 482.50, 505.30, 526.07,
];

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Janela do histórico demo: sempre os últimos 365 dias TERMINANDO HOJE.
 *
 * Antes era fixa em 2024 — o tutorial dizia "como estaria seu patrimônio HOJE"
 * enquanto o eixo do gráfico mostrava jan/24 a dez/24. Ancorar em `hoje` faz a
 * demo envelhecer junto com o produto, sem manutenção.
 */
const DEMO_TOTAL_DAYS = 365;
const demoStartDate = () => {
    const today = new Date();
    const start = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    start.setUTCDate(start.getUTCDate() - (DEMO_TOTAL_DAYS - 1));
    return start;
};

function buildDemoHistory() {
    const points: { date: string; totalEquity: number; totalInvested: number; profit: number }[] = [];
    const start = demoStartDate();
    const totalDays = DEMO_TOTAL_DAYS;

    for (let i = 0; i < totalDays; i++) {
        const d = new Date(start);
        d.setUTCDate(start.getUTCDate() + i);

        // Interpola linearmente entre as âncoras mensais (tendência de fundo).
        const t = i / (totalDays - 1);
        const seg = t * (DEMO_EQUITY_ANCHORS.length - 1);
        const idx = Math.min(DEMO_EQUITY_ANCHORS.length - 2, Math.floor(seg));
        const frac = seg - idx;
        const trend = DEMO_EQUITY_ANCHORS[idx] + (DEMO_EQUITY_ANCHORS[idx + 1] - DEMO_EQUITY_ANCHORS[idx]) * frac;

        // Ondas determinísticas (duas frequências) — oscilação diária de mercado. A
        // amplitude cresce com o tempo (mercado "respira" mais conforme o capital sobe).
        const wave = (Math.sin(i * 0.36) * 3.0 + Math.sin(i * 0.12) * 4.4) * Math.min(1, t * 1.8 + 0.15);
        const equity = trend + wave;

        points.push({
            date: d.toISOString().slice(0, 10),
            totalEquity: round2(equity),
            totalInvested: DEMO_INVESTED,
            profit: round2(equity - DEMO_INVESTED),
        });
    }

    // Fixa o último ponto no KPI atual do demo (coerência com os cards).
    points[points.length - 1] = { date: points[points.length - 1].date, totalEquity: 526.07, totalInvested: DEMO_INVESTED, profit: 203.73 };
    return points;
}

export const DEMO_HISTORY = buildDemoHistory();

// Mesma janela do DEMO_HISTORY: 12 meses terminando no mês corrente, para que a
// aba Rentabilidade não contradiga o gráfico de Evolução da Visão Geral.
const DEMO_PERFORMANCE_POINTS = [
    { wallet: 0,     walletRoi: 0,     cdi: 0.8,  ibov: -1.5, ipca: 0.6,  equity: 322.34 },
    { wallet: 5.5,   walletRoi: 2.5,   cdi: 1.6,  ibov: -3.2, ipca: 1.3,  equity: 340.07 },
    { wallet: 12.2,  walletRoi: 7.1,   cdi: 2.5,  ibov: -2.1, ipca: 2.0,  equity: 361.67 },
    { wallet: 22.5,  walletRoi: 11.3,  cdi: 3.4,  ibov: 0.5,  ipca: 2.8,  equity: 394.87 },
    { wallet: 35.4,  walletRoi: 18.0,  cdi: 4.3,  ibov: -1.8, ipca: 3.6,  equity: 436.45 },
    { wallet: 31.1,  walletRoi: 16.3,  cdi: 5.2,  ibov: 2.4,  ipca: 4.4,  equity: 422.59 },
    { wallet: 48.6,  walletRoi: 25.8,  cdi: 6.1,  ibov: 4.1,  ipca: 5.2,  equity: 479.00 },
    { wallet: 62.3,  walletRoi: 35.2,  cdi: 7.0,  ibov: 6.5,  ipca: 6.1,  equity: 523.16 },
    { wallet: 75.8,  walletRoi: 42.7,  cdi: 7.9,  ibov: 3.2,  ipca: 7.0,  equity: 566.67 },
    { wallet: 84.2,  walletRoi: 49.6,  cdi: 8.8,  ibov: 1.8,  ipca: 7.9,  equity: 593.75 },
    { wallet: 92.5,  walletRoi: 56.7,  cdi: 9.7,  ibov: 4.5,  ipca: 8.8,  equity: 620.50 },
    { wallet: 96.44, walletRoi: 42.54, cdi: 10.8, ibov: 3.2,  ipca: 9.8,  equity: 633.09 },
];

export const DEMO_PERFORMANCE = DEMO_PERFORMANCE_POINTS.map((point, i) => {
    const today = new Date();
    const d = new Date(Date.UTC(today.getFullYear(), today.getMonth() - (DEMO_PERFORMANCE_POINTS.length - 1 - i), 1));
    return { date: d.toISOString().slice(0, 10), ...point };
});

// Meses/datas relativos ao mês corrente: o histórico termina no mês passado e os
// provisionados caem nos próximos meses. Fixá-los em 2024/2025 fazia a demo
// exibir "pagamentos futuros confirmados" com datas já vencidas.
const demoMonthKey = (monthsAgo: number) => {
    const t = new Date();
    return new Date(Date.UTC(t.getFullYear(), t.getMonth() - monthsAgo, 1)).toISOString().slice(0, 7);
};
const demoFutureDate = (monthsAhead: number, day: number) => {
    const t = new Date();
    return new Date(Date.UTC(t.getFullYear(), t.getMonth() + monthsAhead, day)).toISOString().slice(0, 10);
};

export const DEMO_DIVIDENDS = {
    history: [
        { month: demoMonthKey(11), value: 2.50, breakdown: [{ ticker: 'SBSP3', amount: 2.50 }] },
        { month: demoMonthKey(10), value: 3.80, breakdown: [{ ticker: 'WEGE3', amount: 3.80 }] },
        { month: demoMonthKey(9),  value: 1.20, breakdown: [{ ticker: 'TESOURO', amount: 1.20 }] },
        { month: demoMonthKey(8),  value: 5.50, breakdown: [{ ticker: 'NVDA', amount: 5.50 }] },
        { month: demoMonthKey(7),  value: 3.10, breakdown: [{ ticker: 'SBSP3', amount: 3.10 }] },
        { month: demoMonthKey(6),  value: 4.20, breakdown: [{ ticker: 'WEGE3', amount: 4.20 }] },
        { month: demoMonthKey(5),  value: 6.80, breakdown: [{ ticker: 'NVDA', amount: 6.80 }] },
        { month: demoMonthKey(4),  value: 2.50, breakdown: [{ ticker: 'TESOURO', amount: 2.50 }] },
        { month: demoMonthKey(3),  value: 4.90, breakdown: [{ ticker: 'SBSP3', amount: 4.90 }] },
        { month: demoMonthKey(2),  value: 5.10, breakdown: [{ ticker: 'WEGE3', amount: 5.10 }] },
        { month: demoMonthKey(1),  value: 7.12, breakdown: [{ ticker: 'NVDA', amount: 7.12 }] },
    ],
    provisioned: [
        { ticker: 'WEGE3', date: demoFutureDate(1, 20), amount: 2.80 },
        { ticker: 'SBSP3', date: demoFutureDate(2, 15), amount: 3.15 },
        { ticker: 'NVDA', date: demoFutureDate(2, 28), amount: 5.20 }
    ],
    totalAllTime: 46.72,
    projectedMonthly: 3.89,
    yieldOnCost: [
        { ticker: 'WEGE3', receivedLast12Months: 19.90, totalCost: 850, yocPercent: 2.34 },
        { ticker: 'SBSP3', receivedLast12Months: 13.50, totalCost: 620, yocPercent: 2.18 },
        { ticker: 'NVDA', receivedLast12Months: 13.32, totalCost: 1900, yocPercent: 0.70 },
    ],
    goal: { target: 50, current: 3.89, progressPercent: 7.78 },
};

export const DEMO_TRANSACTIONS = {
    transactions: DEMO_ASSETS.map((asset, index) => ({
        _id: `tx-${index}`,
        type: 'BUY',
        ticker: asset.ticker,
        quantity: asset.quantity,
        price: asset.averagePrice,
        totalValue: asset.totalCost,
        // Início da janela demo — coerente com o primeiro ponto do DEMO_HISTORY.
        date: demoStartDate().toISOString().slice(0, 10),
        isCashOp: asset.type === 'CASH' || asset.isReserve === true,
        assetClass: asset.isReserve === true ? 'CASH' : (asset.allocationClass || asset.type),
        assetType: asset.type,
        currency: asset.currency
    })),
    pagination: { hasMore: false, currentPage: 1, totalPages: 1, totalItems: DEMO_ASSETS.length }
};
