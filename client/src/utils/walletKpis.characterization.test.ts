import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Asset, AssetType, DayChangeReason, WalletKPIs } from '../contexts/WalletContext';
import { computeWalletKpis } from './kpiCalculations';
import { buildDayMovers } from './dayMovers';

/**
 * Caracterização de `computeWalletKpis` e `buildDayMovers`, gravada no código
 * de antes da quebra em partes. Carteiras geradas por PRNG semeado cobrem ativos
 * BRL/USD, renda fixa/CASH, cripto, posições zeradas, valores ausentes, zero,
 * negativos, limiar de meio centavo e empates. Qualquer número, arredondamento
 * ou ordem diferente muda o hash.
 */

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type Rng = () => number;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const maybe = <T>(rng: Rng, value: T, p = 0.5): T | undefined => (rng() < p ? value : undefined);

function normalize(value: unknown): unknown {
    if (value === undefined) return '__undefined__';
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return '__NaN__';
        if (value === Infinity) return '__Inf__';
        if (value === -Infinity) return '__-Inf__';
        if (Object.is(value, -0)) return '__-0__';
        return value;
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = normalize((value as Record<string, unknown>)[key]);
        }
        return out;
    }
    return value;
}

const serialize = (value: unknown): string => JSON.stringify(normalize(value));
const hash = (value: unknown): string => createHash('sha256').update(serialize(value)).digest('hex').slice(0, 16);

const TYPES: readonly AssetType[] = ['STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'ETF', 'FIXED_INCOME', 'CASH', 'OURO'];
const REASONS: readonly (DayChangeReason | null | undefined)[] = [
    'ANCHOR_CLOSE', 'PREVIOUS_CLOSE', 'BOUGHT_TODAY', 'FIXED_INCOME_MTM', 'FIXED_INCOME_MTM_PENDING',
    'FIXED_INCOME_CURVE', 'MATURED', 'STALE_QUOTE', 'NO_QUOTE', 'PROVIDER_WINDOW', 'PROVIDER_SESSION',
    null, undefined,
];
const TICKERS = ['PETR4', 'VALE3', 'BTC', 'AAPL', 'KNRI11', 'TESOURO-IPCA-2035', 'CDB-X', 'ITSA4', 'abc', 'Ábaco'];
const DAY_VALUES = [0, -0, 0.004, -0.004, 0.0049999, 0.005, -0.005, 0.01, -0.01, 12.34, -56.78, 1e6, -1e6, 50, 50, Infinity];
const PRICE_DATES = [undefined, null, '', '2026-11-19', '2026-11-20', '2026-11-18', '2025-12-31'];
const MONEY = [0, -0, 100, 1234.56, -50, 0.001, 1e9, 3200, 3000, NaN, Infinity];

function randomAsset(rng: Rng, index: number): Asset {
    const type = pick(rng, TYPES);
    const ticker = pick(rng, TICKERS);
    const scenario = rng();
    const value = scenario < 0.15 ? undefined : scenario < 0.6 ? pick(rng, DAY_VALUES) : Math.round((rng() - 0.5) * 200000) / 100;
    const asset: Asset = {
        id: `id-${index}`,
        ticker,
        type,
        quantity: pick(rng, [0, 1, 100, 0.5]),
        averagePrice: pick(rng, MONEY),
        currentPrice: pick(rng, MONEY),
        totalValue: pick(rng, MONEY),
        totalCost: pick(rng, MONEY),
        profit: 0,
        profitPercent: 0,
        currency: type === 'STOCK_US' || type === 'CRYPTO' ? pick(rng, ['USD', 'USD', 'BRL'] as const) : 'BRL',
        dayChangeValue: value,
        dayChangeReason: pick(rng, REASONS),
        dayDividends: maybe(rng, pick(rng, [0, -1, 0.001, 12.5, 300])),
        dayChangePct: maybe(rng, pick(rng, [0, -0, 1.5, -2.25, NaN])),
        name: pick(rng, [undefined, '', `Nome ${ticker}`]),
        sector: pick(rng, [undefined, 'Energia', '']),
        isReserve: pick(rng, [undefined, true, false]),
        priceDate: pick(rng, PRICE_DATES),
    };
    return asset;
}

const KPI_FIELDS: readonly (keyof WalletKPIs)[] = [
    'totalEquity', 'totalInvested', 'totalResult', 'totalResultPercent', 'dayVariation', 'dayVariationPercent',
    'dayAnchorDate', 'dayDividends', 'totalDividends', 'projectedDividends', 'weightedRentability', 'dataQuality',
    'sharpeRatio', 'sharpeConfidence', 'sharpeStandardError', 'sharpeSample', 'beta',
];

function randomKpiValue(rng: Rng, field: keyof WalletKPIs): unknown {
    if (rng() < 0.2) return null;
    if (field === 'dayAnchorDate') return pick(rng, ['2026-11-20', '', '2026-09-01']);
    if (field === 'dataQuality') return pick(rng, ['AUDITED', 'ESTIMATED']);
    if (field === 'sharpeConfidence') return pick(rng, ['LOW', 'MEDIUM', 'HIGH']);
    return pick(rng, [0, -0, 1.5, -386.42, 1234.5678, NaN]);
}

function randomKpis(rng: Rng): Partial<WalletKPIs> | null | undefined {
    const mode = rng();
    if (mode < 0.1) return undefined;
    if (mode < 0.15) return null;
    if (mode < 0.2) return {};
    const out: Record<string, unknown> = {};
    for (const field of KPI_FIELDS) {
        if (rng() < 0.6) out[field] = randomKpiValue(rng, field);
    }
    return out as Partial<WalletKPIs>;
}

function randomWallet(rng: Rng): Asset[] {
    const size = rng() < 0.12 ? 0 : 1 + Math.floor(rng() * 9);
    return Array.from({ length: size }, (_, i) => randomAsset(rng, i));
}

const SCENARIOS = 400;

function runScenario(seed: number) {
    const rng = mulberry32(seed);
    const assets = randomWallet(rng);
    const kpis = randomKpis(rng);
    return {
        walletKpis: computeWalletKpis(assets, kpis ?? undefined),
        dayMovers: buildDayMovers(assets, kpis),
    };
}

describe('caracterização — computeWalletKpis e buildDayMovers', () => {
    it('hash por cenário de carteira gerada', () => {
        const hashes: Record<string, string> = {};
        for (let seed = 1; seed <= SCENARIOS; seed += 1) hashes[`seed-${seed}`] = hash(runScenario(seed));
        expect(hashes).toMatchSnapshot();
    });

    it('cenários legíveis para diff', () => {
        const readable = [3, 7, 11, 42].map((seed) => serialize(runScenario(seed)));
        expect(readable).toMatchSnapshot();
    });

    it('casos de borda escolhidos à mão', () => {
        const base = randomAsset(mulberry32(99), 0);
        const edge = {
            emptyNoKpis: [computeWalletKpis([]), buildDayMovers([], undefined), buildDayMovers([], null)],
            notArray: buildDayMovers(null as unknown as Asset[], { dayVariation: 5 }),
            zeroedPosition: computeWalletKpis([{ ...base, totalValue: 0, totalCost: 0 }], {}),
            negativeInvested: computeWalletKpis([{ ...base, totalValue: 10, totalCost: -5 }]),
            pendingTreasury: buildDayMovers([
                { ...base, ticker: 'T1', dayChangeReason: 'FIXED_INCOME_MTM_PENDING', dayChangeValue: 0, priceDate: '2026-11-19' },
                { ...base, ticker: 'T2', dayChangeReason: 'FIXED_INCOME_MTM_PENDING', dayChangeValue: 0.0049, priceDate: '2026-11-20' },
                { ...base, ticker: 'T3', dayChangeReason: 'FIXED_INCOME_MTM_PENDING', dayChangeValue: -0.005, priceDate: '2026-11-21' },
                { ...base, ticker: 'T4', dayChangeReason: 'FIXED_INCOME_MTM_PENDING', dayChangeValue: undefined, priceDate: null },
            ], { dayVariation: 1 }),
            tiesAndShared: buildDayMovers([
                { ...base, ticker: 'B', dayChangeReason: 'STALE_QUOTE', dayChangeValue: 50 },
                { ...base, ticker: 'A', dayChangeReason: 'STALE_QUOTE', dayChangeValue: 50 },
                { ...base, ticker: 'C', dayChangeReason: 'FIXED_INCOME_CURVE', dayChangeValue: -1 },
                { ...base, ticker: 'D', dayChangeReason: 'STALE_QUOTE', dayChangeValue: 0 },
            ], {}),
            sharedDefault: buildDayMovers([
                { ...base, ticker: 'B', dayChangeReason: 'ANCHOR_CLOSE', dayChangeValue: 5 },
                { ...base, ticker: 'A', dayChangeReason: 'ANCHOR_CLOSE', dayChangeValue: 7 },
            ], {}),
            cashReserve: buildDayMovers([
                { ...base, ticker: 'CX', type: 'CASH', isReserve: undefined, dayChangeValue: 1, name: '' },
            ], {}),
        };
        expect(serialize(edge)).toMatchSnapshot();
    });
});
