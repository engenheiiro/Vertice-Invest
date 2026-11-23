/**
 * Caracterização do DayMoversModal: carteiras semeadas (classes, motivos,
 * proventos, Tesouro pendente, valores zero/NaN/ausentes) × KPI (total, âncora,
 * patrimônio) × modo privacidade. Guarda o hash do HTML do portal por cenário e
 * alguns cenários completos, para provar que a divisão do componente em partes
 * não mudou nada visível.
 */
import React from 'react';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { Asset, AssetType, DayChangeReason, WalletKPIs } from '../../contexts/WalletContext';

const { walletState } = vi.hoisted(() => ({
    walletState: {
        assets: [] as Asset[],
        kpis: {} as Partial<WalletKPIs> | null,
        isPrivacyMode: false,
    },
}));

vi.mock('../../contexts/WalletContext', () => ({ useWallet: () => walletState }));

import { DayMoversModal } from './DayMoversModal';

const mulberry32 = (seed: number) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
type Rng = () => number;
const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

const TYPES: AssetType[] = ['STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'ETF', 'FIXED_INCOME', 'CASH', 'OURO'];
const REASONS: (DayChangeReason | undefined)[] = [
    undefined, 'ANCHOR_CLOSE', 'PREVIOUS_CLOSE', 'BOUGHT_TODAY', 'FIXED_INCOME_MTM', 'FIXED_INCOME_MTM_PENDING',
    'FIXED_INCOME_CURVE', 'MATURED', 'STALE_QUOTE', 'NO_QUOTE', 'PROVIDER_WINDOW', 'PROVIDER_SESSION',
];
const VALUES = [undefined, 0, 0.001, -0.004, 0.01, 12.34, -56.78, 1234.5, -9876.54, 214.8, Number.NaN, -0];

const normalize = (html: string) => html.replace(/:r[0-9a-z]+:/g, ':id:');
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

const makeAsset = (rng: Rng, i: number): Asset => {
    const type = pick(rng, TYPES);
    const shared = rng() < 0.15 ? 'STALE_QUOTE' : undefined;
    return {
        id: `id-${i}`,
        ticker: `${pick(rng, ['PETR4', 'VALE3', 'KNCR11', 'BTC', 'AAPL', 'IVVB11', 'TESOURO', 'RES'])}${i}`,
        name: pick(rng, [undefined, '', 'Petrobras', 'Reserva de Emergência', 'Um nome muito longo de ativo']),
        type,
        quantity: 10,
        averagePrice: 1,
        currentPrice: 1,
        totalValue: 1,
        totalCost: 1,
        profit: 0,
        profitPercent: 0,
        currency: type === 'CRYPTO' || type === 'STOCK_US' || rng() < 0.1 ? 'USD' : 'BRL',
        sector: pick(rng, [undefined, null, 'Papel', 'Logística', 'Petróleo']),
        isReserve: pick(rng, [undefined, true, false]),
        dayChangeValue: pick(rng, VALUES),
        dayChangePct: pick(rng, [undefined, 0, 1.62, -1.18, Number.NaN, 12.345, -0.004]),
        dayChangeReason: shared ?? pick(rng, REASONS),
        dayDividends: pick(rng, [undefined, 0, 0, 0, 12.5, 0.4]),
        priceDate: pick(rng, [undefined, null, '2026-11-19', '2026-11-20', 'lixo']),
    } as Asset;
};

const makeKpis = (rng: Rng): Partial<WalletKPIs> | null => {
    if (rng() < 0.05) return null;
    return {
        dayVariation: pick(rng, [undefined, 0, 108.2, -386.42, 0.004, Number.NaN, 12345.67]),
        dayVariationPercent: pick(rng, [undefined, 0, 0.26, -1.5, Number.NaN]),
        dayAnchorDate: pick(rng, [undefined, null, '2026-08-31', '2026-11-20', 'nao-data']),
        dayDividends: pick(rng, [undefined, 0, 25.4, -1]),
        totalEquity: pick(rng, [undefined, 0, -10, 41234.56, Number.NaN]),
    } as Partial<WalletKPIs>;
};

function renderScenario(assets: Asset[], kpis: Partial<WalletKPIs> | null, privacy: boolean, isOpen = true) {
    walletState.assets = assets;
    walletState.kpis = kpis;
    walletState.isPrivacyMode = privacy;
    const onClose = vi.fn();
    render(<DayMoversModal isOpen={isOpen} onClose={onClose} />);
    const html = normalize(document.body.innerHTML);
    const close = document.body.querySelector('button');
    if (close) fireEvent.click(close);
    fireEvent.keyDown(document, { key: 'Escape' });
    const closes = onClose.mock.calls.length;
    cleanup();
    return { html, closes };
}

describe('caracterização do DayMoversModal', () => {
    it('hash do HTML por cenário semeado', () => {
        const rng = mulberry32(5150);
        const rows: string[] = [];
        for (let i = 0; i < 300; i += 1) {
            const size = pick(rng, [0, 0, 1, 2, 3, 5, 8, 14, 25]);
            const assets = Array.from({ length: size }, (_, k) => makeAsset(rng, k));
            const kpis = makeKpis(rng);
            const privacy = rng() < 0.3;
            const isOpen = rng() > 0.03;
            const out = renderScenario(assets, kpis, privacy, isOpen);
            rows.push(`${i} n=${size} p=${privacy ? 1 : 0}: ${digest(out.html)} c=${out.closes}`);
        }
        expect(rows).toMatchSnapshot();
    });

    it('cenários completos legíveis', () => {
        const rng = mulberry32(99);
        const out: Record<string, string> = {};
        const base = Array.from({ length: 10 }, (_, k) => makeAsset(rng, k));
        const stale = base.map((a) => ({ ...a, type: 'STOCK' as AssetType, dayChangeReason: 'STALE_QUOTE' as DayChangeReason, dayChangeValue: 1.5 }));
        const kpis = { dayVariation: 108.2, dayVariationPercent: 0.26, dayAnchorDate: '2026-08-31', dayDividends: 25.4, totalEquity: 41234.56 };
        out.misto = renderScenario(base, kpis, false).html;
        out.mistoPrivado = renderScenario(base, kpis, true).html;
        out.faixaCompartilhada = renderScenario(stale, { ...kpis, dayAnchorDate: null }, false).html;
        out.vazio = renderScenario([], { dayVariation: 0 }, false).html;
        expect(out).toMatchSnapshot();
    });
});
