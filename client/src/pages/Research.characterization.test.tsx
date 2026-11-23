import React from 'react';
import { createHash } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Caracterização da página Research antes da quebra em partes: para cada
 * usuário (sem login, planos, plano desconhecido, admin) × aba × modo (Top 10 /
 * Semanal) × variação de relatório (nenhum, não publicado, publicado, narrativa
 * por perfil), o HTML da página vira um resumo sha256. Os componentes pesados
 * são stubs que imprimem as props recebidas.
 */
const { auth, svc, nav } = vi.hoisted(() => ({
    auth: { user: null as null | { plan?: string; role?: string } },
    svc: { report: null as unknown, calls: [] as string[] },
    nav: { state: null as unknown, navigate: [] as string[] },
}));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../services/research', () => ({
    researchService: {
        getLatest: async (cls: string) => { svc.calls.push(cls); return svc.report; },
        getFixedIncomeData: async () => null,
    },
}));
vi.mock('react-router-dom', () => ({
    useNavigate: () => (to: string) => nav.navigate.push(to),
    useLocation: () => ({ state: nav.state, pathname: '/research' }),
}));
vi.mock('../components/dashboard/Header', () => ({ Header: () => <header /> }));
vi.mock('../components/research/ResearchViewer', () => ({
    ResearchViewer: (p: {
        view: string; initialEtfOrigin?: string; onExteriorViewChange?: unknown; onAporte: () => void; onEtfOriginChange: (o: string) => void;
    }) => (
        <div data-viewer={p.view} data-etf={p.initialEtfOrigin ?? ''} data-ext={p.onExteriorViewChange ? 'sim' : 'nao'}>
            <button onClick={p.onAporte}>stub-aporte</button>
            <button onClick={() => p.onEtfOriginChange('BR')}>stub-br</button>
            {p.onExteriorViewChange && <button onClick={() => (p.onExteriorViewChange as (v: string) => void)('REIT')}>stub-reit</button>}
        </div>
    ),
}));
vi.mock('../components/research/AssetDetailModal', () => ({
    AssetDetailModal: ({ isOpen, asset, onClose }: { isOpen: boolean; asset: { ticker: string }; onClose: () => void }) =>
        (isOpen ? <div data-direct={asset.ticker}><button onClick={onClose}>stub-fechar-ativo</button></div> : null),
}));
vi.mock('../components/research/ExplainableAIRenderer', () => ({ ExplainableAIRenderer: ({ text }: { text: string }) => <pre>{text}</pre> }));
vi.mock('../components/research/ResearchAporteModal', () => ({
    ResearchAporteModal: (p: { isOpen: boolean; assetClass: string; etfOrigin: string; initialAmount: number | null; onClose: () => void }) =>
        (p.isOpen ? (
            <div data-aporte={`${p.assetClass}|${p.etfOrigin}|${String(p.initialAmount)}`}>
                <button onClick={p.onClose}>stub-fechar-aporte</button>
            </div>
        ) : null),
}));
vi.mock('../components/research/TreasuryPanel', () => ({ TreasuryPanel: () => <div data-treasury /> }));
vi.mock('../components/ui', () => ({
    SkeletonCard: ({ className }: { className?: string }) => <div data-skel={className} />,
    SkeletonTableRows: ({ rows }: { rows: number }) => <div data-rows={rows} />,
}));

import { Research } from './Research';

const digest = (html: string) => createHash('sha256').update(html).digest('hex').slice(0, 16);
let client: QueryClient;
// Espera determinística: até o React Query não ter busca em voo, e mais um tique para a tela assentar.
const flush = async () => {
    await waitFor(() => expect(client.isFetching()).toBe(0), { interval: 2 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

const RANKING = [{ ticker: 'PETR4' }, { ticker: 'VALE3' }];
const REPORTS: Record<string, unknown> = {
    nenhum: null,
    naoPublicado: { content: { ranking: RANKING }, isRankingPublished: false, isExplainableAIPublished: false },
    publicado: { content: { ranking: RANKING }, isRankingPublished: true, isExplainableAIPublished: true, generatedExplainableAI: 'texto geral' },
    publicadoSemTexto: { content: { ranking: RANKING }, isRankingPublished: true, isExplainableAIPublished: true, generatedExplainableAI: '' },
    porPerfil: {
        content: { ranking: RANKING }, isRankingPublished: true, isExplainableAIPublished: true, generatedExplainableAI: 'geral',
        generatedExplainableAIByProfile: { DEFENSIVE: '  ', MODERATE: 'texto moderado', BOLD: 'texto arrojado' },
    },
    umPerfil: {
        content: {}, isRankingPublished: true, isExplainableAIPublished: true,
        generatedExplainableAIByProfile: { BOLD: 'só arrojado' },
    },
};
// Um usuário por fronteira de plano; as combinações finas ficam no teste das regras (researchPageView).
const USERS: Array<[string, null | { plan?: string; role?: string }]> = [
    ['sem login', null], ['GUEST', { plan: 'GUEST' }], ['ESSENTIAL', { plan: 'ESSENTIAL' }], ['PRO', { plan: 'PRO' }],
    ['ELITE', { plan: 'ELITE' }], ['ADMIN', { plan: 'GUEST', role: 'ADMIN' }],
];
const TABS = ['Brasil 10 (Mix)', 'Ações BR', 'FIIs', 'Cripto', 'Exterior', 'ETFs', 'Renda Fixa'];

const mount = () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><Research /></QueryClientProvider>);
};

beforeEach(() => {
    svc.calls = [];
    nav.state = null;
    nav.navigate = [];
});

describe('Research — caracterização', () => {
    const clickTab = async (label: string) => {
        fireEvent.click(screen.getByText(label).closest('button') as HTMLElement);
        await flush();
    };

    it('acesso: cada usuário × cada aba (relatório publicado)', async () => {
        svc.report = REPORTS.publicado;
        const out: string[] = [];
        for (const [nome, user] of USERS) {
            auth.user = user;
            const { container, unmount } = mount();
            out.push(`carregando:${digest(container.innerHTML)}`);
            await flush();
            out.push(`${nome}:${digest(container.innerHTML)}`);
            for (const tab of TABS) {
                await clickTab(tab);
                out.push(`${tab}:${digest(container.innerHTML)}`);
            }
            out.push(`calls:${svc.calls.join(',')}`);
            svc.calls = [];
            unmount();
        }
        expect(digest(out.join('\n'))).toMatchSnapshot();
    }, 30_000);

    it.each(Object.keys(REPORTS))('conteúdo do relatório %s: abas × Top 10 / Semanal × perfil', async (kind) => {
        svc.report = REPORTS[kind];
        auth.user = { plan: 'GUEST', role: 'ADMIN' };
        const out: string[] = [];
        const { container } = mount();
        await flush();
        // Exterior e ETFs só mudam as props do ranking, já cobertas no teste de fluxo abaixo.
        for (const tab of ['Brasil 10 (Mix)', 'Renda Fixa']) {
            await clickTab(tab);
            out.push(`${tab}:${digest(container.innerHTML)}`);
            await clickTab('Semanal');
            out.push(`semanal:${digest(container.innerHTML)}`);
            const perfil = screen.queryByRole('button', { name: 'Arrojado' });
            if (perfil) { fireEvent.click(perfil); out.push(`perfil:${digest(container.innerHTML)}`); }
            await clickTab('Top 10');
        }
        expect(digest(out.join('\n'))).toMatchSnapshot();
    }, 30_000);

    it('fluxo do Top 10: atualizar, Aporte, origem do ETF e REIT do Exterior', async () => {
        svc.report = REPORTS.publicado;
        auth.user = { plan: 'ELITE' };
        const { container } = mount();
        await flush();
        const shots: string[] = [];
        fireEvent.click(screen.getByRole('button', { name: 'Atualizar dados' }));
        await flush();
        fireEvent.click(screen.getByText('stub-aporte'));
        shots.push(digest(container.innerHTML));
        fireEvent.click(screen.getByText('stub-fechar-aporte'));
        fireEvent.click(screen.getByText('ETFs').closest('button') as HTMLElement);
        await flush();
        fireEvent.click(screen.getByText('stub-br'));
        fireEvent.click(screen.getByText('stub-aporte'));
        shots.push(digest(container.innerHTML));
        fireEvent.click(screen.getByText('stub-fechar-aporte'));
        fireEvent.click(screen.getByText('Exterior').closest('button') as HTMLElement);
        await flush();
        fireEvent.click(screen.getByText('stub-reit'));
        await flush();
        fireEvent.click(screen.getByText('stub-aporte'));
        shots.push(digest(container.innerHTML));
        fireEvent.click(screen.getByText('Cripto').closest('button') as HTMLElement);
        await flush();
        fireEvent.click(screen.getByText('Exterior').closest('button') as HTMLElement);
        await flush();
        shots.push(digest(container.innerHTML));
        shots.push(svc.calls.join(','));
        expect(shots).toMatchSnapshot();
    });

    it('deep links: Aporte da Carteira e ticker direto', async () => {
        svc.report = REPORTS.publicado;
        auth.user = { plan: 'PRO' };
        nav.state = { aporte: { assetClass: 'ETF', etfOrigin: 'BR', amount: 500 } };
        const a = mount();
        await flush();
        const shots = [digest(a.container.innerHTML), svc.calls.join(',')];
        fireEvent.click(screen.getByText('stub-fechar-aporte'));
        shots.push(digest(a.container.innerHTML));
        a.unmount();
        nav.state = { openTicker: 'VALE3' };
        const b = mount();
        await flush();
        shots.push(digest(b.container.innerHTML));
        fireEvent.click(screen.getByText('stub-fechar-ativo'));
        shots.push(digest(b.container.innerHTML));
        b.unmount();
        nav.state = { openTicker: 'NAOEXISTE' };
        const c = mount();
        await flush();
        shots.push(digest(c.container.innerHTML));
        expect(shots).toMatchSnapshot();
    });

    it('upgrade leva ao /pricing', async () => {
        auth.user = { plan: 'GUEST' };
        mount();
        fireEvent.click(screen.getByText('Ações BR').closest('button') as HTMLElement);
        fireEvent.click(screen.getByText('Fazer Upgrade'));
        expect(nav.navigate).toEqual(['/pricing']);
    });
});
