/**
 * Caracterização do AssetSection: para cada cenário semeado de props (tipo,
 * compra/venda, cofrinhos, busca com resultados, mercado do ETF), guarda o hash
 * do HTML e o registro de chamadas de cada interação (digitar, focar, escolher
 * opção, trocar select, clicar no mercado). Prova que a refatoração em partes
 * não mudou nada visível nem nenhum callback.
 */
import React from 'react';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { AssetSection } from './AssetSection';
import type { Asset, AssetType } from '../../../contexts/WalletContext';
import type { AssetFormState } from '../../../utils/assetTransaction';
import type { AssetSearch } from './types';

const mulberry32 = (seed: number) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Rng = () => number;
const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

const TYPES: AssetType[] = ['STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'ETF', 'FIXED_INCOME', 'CASH', 'OURO'];

const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return 'NaN';
        if (!Number.isFinite(value)) return String(value);
        if (Object.is(value, -0)) return '-0';
        return value;
    }
    if (value === undefined) return '__undef__';
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted((value as Record<string, unknown>)[k])]));
    }
    return value;
};

const normalize = (html: string) => html.replace(/:r[0-9a-z]+:/g, ':id:');
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

const makeAsset = (rng: Rng, i: number): Asset => ({
    id: `a${i}`,
    ticker: pick(rng, ['PETR4', 'MXRF11', 'BTC', 'AAPL', 'BOVA11', 'CDB-X', 'RES-1', 'VOO']) + (i % 3),
    type: pick(rng, TYPES),
    quantity: pick(rng, [0, 1, 10.5, -1, 100]),
    averagePrice: 1,
    currentPrice: 1,
    totalValue: 1,
    totalCost: 1,
    profit: 0,
    profitPercent: 0,
    currency: 'BRL',
    name: pick(rng, ['', 'Reserva Viagem', undefined, 'Nome X']),
} as Asset);

const makeResult = (rng: Rng, i: number) => {
    const r: Record<string, unknown> = {
        ticker: pick(rng, ['PETR4', 'TESOURO SELIC 2029', 'CDB BANCO', 'BTC', 'AAPL']) + i,
        name: pick(rng, ['Petrobras', 'Tesouro Selic', 'Criar: cdb', 'Bitcoin', 'Um nome muito longo de produto financeiro']),
        type: pick(rng, ['STOCK', 'FII', 'FIXED_INCOME', 'CRYPTO', 'STOCK_US', 'ETF']),
    };
    if (rng() < 0.3) r.isTreasury = true;
    if (rng() < 0.2) r.isManual = true;
    if (rng() < 0.3) r.rate = pick(rng, [0, 100, 12.5, 6.3]);
    if (rng() < 0.3) r.index = pick(rng, ['IPCA', 'SELIC', '', 'PRE']);
    if (rng() < 0.4) r.maturityDate = pick(rng, ['2029-03-01', '01/01/2035', '']);
    return r;
};

interface Scenario {
    form: AssetFormState;
    transactionType: 'BUY' | 'SELL';
    assets: Asset[];
    reserves: Asset[];
    cashSelection: string;
    etfMarket: 'BR' | 'US';
    results: Record<string, unknown>[];
    showDropdown: boolean;
    isSearching: boolean;
    activeIndex: number;
}

const makeScenario = (rng: Rng): Scenario => {
    const assets = Array.from({ length: Math.floor(rng() * 6) }, (_, i) => makeAsset(rng, i));
    const reserves = Array.from({ length: pick(rng, [0, 0, 1, 3]) }, (_, i) => ({ ...makeAsset(rng, i + 10), type: 'CASH' as AssetType }));
    const results = Array.from({ length: pick(rng, [0, 1, 3, 7]) }, (_, i) => makeResult(rng, i));
    return {
        form: {
            ticker: pick(rng, ['', 'PETR4', 'tesouro', 'BTC']),
            name: pick(rng, ['', 'Petrobras', 'Minha reserva']),
            type: pick(rng, TYPES),
            quantity: '',
            price: '',
            rate: pick(rng, ['', '100', '110']),
            date: '2026-11-20',
            usSubType: pick(rng, [undefined, '', 'REIT', 'DOLLAR', 'STOCK']),
        },
        transactionType: pick(rng, ['BUY', 'SELL'] as const),
        assets,
        reserves,
        cashSelection: pick(rng, ['', '__NEW__', reserves[0]?.ticker ?? 'X']),
        etfMarket: pick(rng, ['BR', 'US'] as const),
        results,
        showDropdown: rng() < 0.6,
        isSearching: rng() < 0.3,
        activeIndex: pick(rng, [-1, 0, 1, 2]),
    };
};

/** Renderiza, interage com tudo que é interativo e devolve HTML + chamadas. */
function exercise(s: Scenario) {
    const log: unknown[] = [];
    const setForm = vi.fn((arg: unknown) => {
        log.push(['setForm', typeof arg === 'function' ? (arg as (p: AssetFormState) => AssetFormState)(s.form) : arg]);
    });
    const search = {
        searchResults: s.results,
        showDropdown: s.showDropdown,
        isSearching: s.isSearching,
        activeIndex: s.activeIndex,
        containerRef: React.createRef<HTMLDivElement>(),
        setShowDropdown: (v: boolean) => log.push(['setShowDropdown', v]),
        setActiveIndex: (v: number) => log.push(['setActiveIndex', v]),
        selectResult: (r: Record<string, unknown>) => log.push(['selectResult', r.ticker]),
        handleKeyDown: (e: React.KeyboardEvent) => log.push(['keyDown', e.key]),
    } as unknown as AssetSearch;

    const { container } = render(
        <AssetSection
            form={s.form}
            setForm={setForm}
            transactionType={s.transactionType}
            assets={s.assets}
            reserves={s.reserves}
            cashSelection={s.cashSelection}
            setCashSelection={(v) => log.push(['setCashSelection', v])}
            search={search}
            etfMarket={s.etfMarket}
            onSelectEtfMarket={(m) => log.push(['etfMarket', m])}
            onTickerChange={(e) => log.push(['tickerChange', e.target.value])}
            onSellAssetSelect={(e) => log.push(['sellSelect', e.target.value])}
        />,
    );
    const initial = normalize(container.innerHTML);

    container.querySelectorAll('input').forEach((input, i) => {
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.change(input, { target: { value: `v${i}x` } });
        fireEvent.blur(input);
    });
    container.querySelectorAll('select').forEach((select) => {
        Array.from(select.options).map((o) => o.value).forEach((value) => {
            fireEvent.change(select, { target: { value } });
        });
    });
    container.querySelectorAll('[role="option"]').forEach((option) => {
        fireEvent.mouseEnter(option);
        fireEvent.mouseDown(option);
    });
    container.querySelectorAll('button').forEach((button) => fireEvent.click(button));

    const final = normalize(container.innerHTML);
    cleanup();
    return { initial, final, log: JSON.stringify(sorted(log)) };
}

const blankForm = (over: Partial<AssetFormState>): AssetFormState => ({
    ticker: '', name: '', type: 'STOCK', quantity: '', price: '', rate: '', date: '2026-11-20', ...over,
});

const FIXED: Record<string, Partial<Scenario>> = {
    cashBuySemReservas: { form: blankForm({ type: 'CASH', rate: '100' }), transactionType: 'BUY' },
    vendaStock: { form: blankForm({ ticker: 'PETR4' }), transactionType: 'SELL' },
    etfUsComBusca: { form: blankForm({ ticker: 'VO', type: 'ETF' }), transactionType: 'BUY', etfMarket: 'US' },
    rendaFixaTesouro: { form: blankForm({ ticker: 'tes', type: 'FIXED_INCOME' }), transactionType: 'BUY' },
};

describe('caracterização do AssetSection', () => {
    it('hash do HTML e das chamadas por cenário semeado', () => {
        const rng = mulberry32(20261123);
        const rows: string[] = [];
        for (let i = 0; i < 400; i += 1) {
            const s = makeScenario(rng);
            const out = exercise(s);
            rows.push(`${i} ${s.form.type}/${s.transactionType}: ${digest(out.initial)} ${digest(out.final)} ${digest(out.log)}`);
        }
        expect(rows).toMatchSnapshot();
    }, 60_000); // 400 cenários com interações: mesmo motivo do DayMoversModal

    it('cenários completos legíveis', () => {
        const rng = mulberry32(7);
        const out: Record<string, unknown> = {};
        for (const [name, over] of Object.entries(FIXED)) {
            const base = makeScenario(rng);
            const s: Scenario = {
                ...base,
                reserves: name === 'cashBuySemReservas' ? [] : base.reserves,
                assets: [
                    { ...makeAsset(rng, 1), ticker: 'PETR4', type: 'STOCK', quantity: 10 },
                    { ...makeAsset(rng, 2), ticker: 'VALE3', type: 'STOCK', quantity: 0 },
                ],
                results: [
                    {
                        ticker: 'TESOURO IPCA+ 2035', name: 'Tesouro IPCA+', type: 'FIXED_INCOME',
                        isTreasury: true, rate: 6.3, index: 'IPCA', maturityDate: '15/05/2035',
                    },
                    { ticker: 'VOO', name: 'Vanguard S&P 500', type: 'ETF' },
                    { ticker: 'CDB X', name: 'Criar: CDB X', type: 'FIXED_INCOME', isManual: true, rate: 110 },
                ],
                showDropdown: true,
                isSearching: true,
                activeIndex: 1,
                ...over,
            };
            const r = exercise(s);
            out[name] = { html: r.initial, log: JSON.parse(r.log) };
        }
        expect(out).toMatchSnapshot();
    });
});
