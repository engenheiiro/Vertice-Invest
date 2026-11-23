import React from 'react';
import { createHash } from 'node:crypto';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import type { RankingItem } from '../../services/research';

/**
 * Caracterização do TopPicksCard antes da quebra em partes: rankings gerados
 * por semente (mulberry32) em todas as classes, perfis, origens de ETF,
 * privacidade e posições da carteira (sem posição, abaixo/acima da meta,
 * AGUARDAR possuído). O HTML de cada combinação vira um resumo sha256.
 */
const { walletState } = vi.hoisted(() => ({
    walletState: {
        assets: [] as Array<Record<string, unknown>>,
        kpis: { totalEquity: 0 } as Record<string, number>,
        isPrivacyMode: false,
    },
}));

vi.mock('../../contexts/WalletContext', () => ({ useWallet: () => walletState }));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => undefined }));
vi.mock('../common/AssetLogo', () => ({ default: ({ ticker }: { ticker: string }) => <i data-logo={ticker} /> }));
vi.mock('./AssetDetailModal', () => ({
    AssetDetailModal: ({ isOpen, asset }: { isOpen: boolean; asset: RankingItem | null }) =>
        (isOpen ? <div data-modal={asset?.ticker} /> : null),
}));

import { TopPicksCard } from './TopPicksCard';

const mulberry32 = (seed: number) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SECTORS = ['Bancos', 'Energia', 'Tech', 'Logística', undefined];
const PROFILES = ['DEFENSIVE', 'MODERATE', 'BOLD'] as const;
const TIERS = ['GOLD', 'SILVER', 'BRONZE', undefined];

const genPicks = (seed: number, n: number, kind: string): RankingItem[] => {
    const r = mulberry32(seed);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    return Array.from({ length: n }, (_, i) => {
        const prev = r();
        const item: Record<string, unknown> = {
            position: i + 1,
            previousPosition: prev < 0.2 ? undefined : prev < 0.35 ? null : Math.max(1, i + 1 + Math.floor(r() * 7) - 3),
            ticker: `T${seed}_${i}`,
            name: `Nome ${i}`,
            sector: pick(SECTORS),
            type: kind === 'ETF' ? (r() < 0.5 ? 'ETF' : 'STOCK_US') : kind === 'BRASIL_10' ? pick(['STOCK', 'FII']) : kind,
            action: r() < 0.6 ? 'BUY' : 'WAIT',
            currentPrice: r() < 0.1 ? 0 : Math.round(r() * 20000) / 100,
            targetPrice: r() < 0.15 ? undefined : Math.round(r() * 25000) / 100,
            score: Math.floor(r() * 4) === 0 ? 70 : Math.floor(30 + r() * 70),
            probability: 0.5,
            riskProfile: pick(PROFILES),
            thesis: '',
            reason: '',
            tier: pick(TIERS),
            isDividendAristocrat: r() < 0.2,
            metrics: {
                dy: r() < 0.2 ? 0 : Math.round(r() * 1400) / 100,
                marketCap: r() < 0.2 ? 0 : r() * 5e11,
                structural: r() < 0.15 ? undefined : { quality: Math.floor(r() * 100), valuation: Math.floor(r() * 100), risk: Math.floor(r() * 100) },
            },
        };
        if (r() < 0.2) {
            item.retention = { retained: true, reason: 'Continuidade', previousScore: 72, previousPosition: r() < 0.5 ? 3 : undefined };
        }
        return item as unknown as RankingItem;
    });
};

const genWallet = (picks: RankingItem[], seed: number) => {
    const r = mulberry32(seed + 99);
    const assets = picks
        .filter(() => r() < 0.4)
        .map((p) => ({ ticker: p.ticker, type: p.type, sector: r() < 0.3 ? undefined : p.sector, quantity: r() < 0.15 ? 0 : 10, totalValue: Math.round(r() * 500000) / 100 }));
    assets.push({ ticker: 'EXTRA', type: picks[0]?.type ?? 'STOCK', sector: 'Outro', quantity: 5, totalValue: 1234.5 });
    return { assets, totalEquity: r() < 0.1 ? 0 : 100000 };
};

const digest = (html: string) => createHash('sha256').update(html).digest('hex').slice(0, 16);

const CLASSES = ['STOCK', 'FII', 'CRYPTO', 'BRASIL_10', 'STOCK_US', 'REIT', 'ETF'];

const run = (assetClass: string, seed: number, privacy: boolean, withWallet: boolean) => {
    const picks = genPicks(seed, 14, assetClass);
    const { assets, totalEquity } = genWallet(picks, seed);
    walletState.assets = withWallet ? assets : [];
    walletState.kpis = { totalEquity: withWallet ? totalEquity : 0 };
    walletState.isPrivacyMode = privacy;
    const frozen = JSON.stringify(picks);
    const { container, unmount } = render(
        <TopPicksCard picks={picks} assetClass={assetClass} onAporte={() => undefined} onExteriorViewChange={() => undefined} />,
    );
    const shots: string[] = [digest(container.innerHTML)];
    for (const label of ['Moderado', 'Arrojado', 'Nacional', 'Internacional']) {
        const btn = screen.queryByRole('button', { name: label });
        if (btn) { fireEvent.click(btn); shots.push(`${label}:${digest(container.innerHTML)}`); }
    }
    const row = container.querySelector<HTMLElement>('[role="button"][aria-label^="Ver detalhes"]');
    if (row) { fireEvent.click(row); shots.push(`modal:${digest(container.innerHTML)}`); }
    expect(JSON.stringify(picks)).toBe(frozen); // nunca reordena o array recebido
    unmount();
    return shots.join(' ');
};

describe('TopPicksCard — caracterização', () => {
    it.each(CLASSES)('%s: grade de rankings e carteiras', (assetClass) => {
        const out: string[] = [];
        for (let seed = 1; seed <= 4; seed++) {
            out.push(run(assetClass, seed * 7 + assetClass.length, seed % 2 === 0, seed !== 3));
        }
        expect(digest(out.join('\n'))).toMatchSnapshot();
    });

    it('ranking vazio', () => {
        walletState.assets = [];
        walletState.kpis = { totalEquity: 0 };
        const { container } = render(<TopPicksCard picks={[]} assetClass="STOCK" />);
        expect(digest(container.innerHTML)).toMatchSnapshot();
    });

    it('origem inicial Nacional e aviso ao pai', () => {
        const seen: string[] = [];
        const picks = genPicks(5, 10, 'ETF');
        const { container } = render(<TopPicksCard picks={picks} assetClass="ETF" initialEtfOrigin="BR" onEtfOriginChange={(o) => seen.push(o)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Internacional' }));
        expect(seen).toEqual(['BR', 'US']);
        expect(digest(container.innerHTML)).toMatchSnapshot();
    });

    it('sem violações de acessibilidade', async () => {
        walletState.assets = [];
        const { container } = render(<TopPicksCard picks={genPicks(3, 6, 'STOCK')} assetClass="STOCK" />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
