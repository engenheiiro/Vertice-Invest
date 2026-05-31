/**
 * Parity / regressão do scoringEngine (guarda do refactor M1).
 *
 * Roda processAsset() numa bateria ampla de cenários (STOCK/FII/CRYPTO em
 * vários tiers, setor financeiro, payout insustentável, sobrevalorização,
 * dados ausentes/stale, aristocrata) e congela a saída via snapshot.
 *
 * Uso: o snapshot é gerado com o comportamento ATUAL antes de decompor
 * calculateProfileScores em helpers por perfil. Após o refactor, este teste
 * deve permanecer verde — qualquer divergência de score/auditLog falha.
 */
import { describe, it, expect } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

const CONTEXT = {
    MACRO: { SELIC: 14.75, IPCA: 4.62, RISK_FREE: 14.75, NTNB_LONG: 6.3 },
};

const baseStockMetrics = {
    pl: 12, pvp: 1.8, roe: 18, roic: 15, netMargin: 22, evEbitda: 7,
    revenueGrowth: 12, debtToEquity: 0.8, netDebt: 500000000, payout: 55,
    dy: 7.5, marketCap: 15000000000, avgLiquidity: 3000000, vacancy: 0,
    capRate: 0, qtdImoveis: 0, volatility: 28, beta: 0.85, sma200: 38, ema50: 39,
    _missing: { pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false, evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false },
    _staleDays: 30,
};

const makeStock = (ticker, sector, price, mOverrides = {}, top = {}) => ({
    ticker, type: 'STOCK', name: ticker, sector, fiiSubType: null, price,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: { ...baseStockMetrics, ...mOverrides, sector, fiiSubType: null },
    ...top,
});

const baseFiiMetrics = {
    pl: 0, pvp: 0.95, roe: 0, netMargin: 0, evEbitda: 0, revenueGrowth: 0,
    debtToEquity: 0, netDebt: 0, payout: 0, dy: 10.5, marketCap: 2000000000,
    avgLiquidity: 4000000, vacancy: 5, capRate: 9, qtdImoveis: 25, volatility: 12,
    beta: 0.5, sma200: 0, ema50: 0,
    _missing: { roe: true, netMargin: true, revenueGrowth: true, payout: true },
    _staleDays: 20,
};

const makeFii = (ticker, sector, price, fiiSubType, mOverrides = {}, top = {}) => ({
    ticker, type: 'FII', name: ticker, sector, fiiSubType, price,
    dbFlags: { isBlacklisted: false, isTier1: top.isTier1 ?? false },
    metrics: { ...baseFiiMetrics, ...mOverrides, sector, fiiSubType },
    ...top,
});

const makeCrypto = (ticker, price, mOverrides = {}) => ({
    ticker, type: 'CRYPTO', name: ticker, sector: 'Crypto', fiiSubType: null, price,
    dbFlags: { isBlacklisted: false },
    metrics: {
        marketCap: 5000000000, avgLiquidity: 500000000, volatility: 60,
        beta: 1.2, sma200: price * 0.9, ema50: price, dy: 0, pvp: 0, pl: 0,
        ...mOverrides,
    },
});

// Normaliza a saída para o snapshot focar no que importa (scores + audit).
const projection = (r) => ({
    ticker: r.ticker,
    scores: r.scores,
    structural: r.metrics?.structural,
    targetPrice: r.targetPrice,
    isDividendAristocrat: r.isDividendAristocrat,
    auditLog: r.auditLog?.map((a) => ({ category: a.category, factor: a.factor, points: a.points, type: a.type })),
    bullThesis: r.bullThesis,
    bearThesis: r.bearThesis,
});

const SCENARIOS = {
    'stock-elite-defensive': makeStock('ELET3', 'Energia Elétrica', 40),
    'stock-financial-sector': makeStock('ITUB4', 'Bancos / Financeiro', 30, { roe: 19, netMargin: 0, revenueGrowth: 45, payout: 60, dy: 6.5, beta: 0.9 }),
    'stock-high-payout': makeStock('XPTO3', 'Energia Elétrica', 25, { payout: 160, dy: 12, roe: 14 }),
    'stock-overvalued': makeStock('OVER3', 'Tecnologia', 200, { pl: 45, pvp: 8, dy: 0.5, revenueGrowth: 5 }),
    'stock-ineligible-smallcap': makeStock('SMAL3', 'Tecnologia', 8, { marketCap: 800000000, beta: 1.6, roe: 4, dy: 1 }),
    'stock-hypergrowth-bold': makeStock('GROW3', 'Tecnologia', 50, { revenueGrowth: 42, pl: 18, roe: 22, dy: 0.5, beta: 1.4, volatility: 50, marketCap: 5000000000 }),
    'stock-missing-data': makeStock('MISS3', 'Energia Elétrica', 40, { _missing: { revenueGrowth: true, roe: true, netMargin: true, payout: false }, _staleDays: 200, avgLiquidity: 800000 }),
    'stock-aristocrat': makeStock('ARIS3', 'Saneamento', 35, { revenueGrowth: 8, roe: 16, dy: 5, netMargin: 15, payout: 55 }),
    'fii-tijolo-defensive': makeFii('HGLG11', 'Logística', 160, 'TIJOLO', {}, { isTier1: true }),
    'fii-papel-defensive': makeFii('KNCR11', 'Papel / Recebíveis', 100, 'PAPEL', { pvp: 1.0, dy: 12, beta: 0.3 }),
    'fii-tijolo-high-vacancy': makeFii('VACA11', 'Lajes Corporativas', 80, 'TIJOLO', { vacancy: 18, dy: 8, pvp: 0.78 }),
    'fii-bold-deep-discount': makeFii('DEEP11', 'Shoppings', 60, 'TIJOLO', { pvp: 0.7, dy: 14, capRate: 13 }),
    'fii-negative-spread': makeFii('LOWY11', 'Híbrido', 110, 'HIBRIDO', { dy: 5, pvp: 1.15 }),
    'crypto-btc': makeCrypto('BTC', 350000, { marketCap: 1200000000000, avgLiquidity: 30000000000, volatility: 45 }),
    'crypto-large': makeCrypto('SOL', 800, { marketCap: 60000000000, avgLiquidity: 3000000000, volatility: 70 }),
    'crypto-mid': makeCrypto('LINK', 80, { marketCap: 8000000000, avgLiquidity: 400000000 }),
    'crypto-small-lowliq': makeCrypto('TINY', 0.5, { marketCap: 300000000, avgLiquidity: 10000000, volatility: 120 }),
};

describe('scoringEngine — parity snapshot (guarda M1)', () => {
    for (const [name, asset] of Object.entries(SCENARIOS)) {
        it(`saída estável: ${name}`, () => {
            const res = scoringEngine.processAsset(asset, CONTEXT);
            expect(projection(res)).toMatchSnapshot();
        });
    }
});
