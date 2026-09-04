import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Asset, WalletKPIs } from '../../contexts/WalletContext';

const { walletState } = vi.hoisted(() => ({
    walletState: {
        assets: [] as Asset[],
        kpis: {} as Partial<WalletKPIs>,
        isPrivacyMode: false,
    },
}));

vi.mock('../../contexts/WalletContext', () => ({ useWallet: () => walletState }));

import { DayMoversModal } from './DayMoversModal';

const asset = (over: Partial<Asset> & { ticker: string }): Asset => ({
    id: `id-${over.ticker}`,
    type: 'STOCK',
    quantity: 100,
    averagePrice: 30,
    currentPrice: 32,
    totalValue: 3200,
    totalCost: 3000,
    profit: 200,
    profitPercent: 6.67,
    currency: 'BRL',
    dayChangeReason: 'ANCHOR_CLOSE',
    ...over,
});

const setWallet = (assets: Asset[], kpis: Partial<WalletKPIs>, isPrivacyMode = false) => {
    walletState.assets = assets;
    walletState.kpis = kpis;
    walletState.isPrivacyMode = isPrivacyMode;
};

const carteira = () => [
    asset({ ticker: 'PETR4', name: 'Petrobras', sector: 'Petróleo e Gás', dayChangeValue: 214.8, dayChangePct: 1.62 }),
    asset({ ticker: 'ITSA4', name: 'Itaúsa', sector: 'Holding', dayChangeValue: 148.3, dayChangePct: 1.04 }),
    asset({ ticker: 'VALE3', name: 'Vale', sector: 'Mineração', dayChangeValue: -96.7, dayChangePct: -1.18 }),
    asset({ ticker: 'KNCR11', name: 'Kinea Rendimentos', sector: 'Papel', type: 'FII', dayChangeValue: -158.2, dayChangePct: -1.45 }),
];

const kpis = (over: Partial<WalletKPIs> = {}): Partial<WalletKPIs> => ({
    dayVariation: 108.2,
    dayVariationPercent: 0.26,
    dayAnchorDate: '2026-08-31',
    dayDividends: 0,
    ...over,
});

beforeEach(() => setWallet(carteira(), kpis()));

describe('DayMoversModal', () => {
    it('não renderiza nada fechado', () => {
        const { container } = render(<DayMoversModal isOpen={false} onClose={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('o cabeçalho traz o total do CARD, não a soma das linhas', () => {
        // As linhas somam 108,20 aqui por coincidência do fixture; o teste trava a
        // fonte: mexer só no KPI tem de mexer no que a tela mostra.
        setWallet(carteira(), kpis({ dayVariation: 386.42 }));
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('+R$ 386,42')).toBeInTheDocument();
        expect(screen.getByText('+0,26%')).toBeInTheDocument();
    });

    it('nomeia o dia da âncora com o dia da semana', () => {
        render(<DayMoversModal isOpen onClose={vi.fn()} />);
        expect(screen.getByText(/desde o fechamento de segunda-feira, 31\/08/)).toBeInTheDocument();
    });

    it('sem âncora, cai no rótulo genérico em vez de inventar uma data', () => {
        setWallet(carteira(), kpis({ dayAnchorDate: null }));
        render(<DayMoversModal isOpen onClose={vi.fn()} />);
        expect(screen.getByText('desde o fechamento anterior')).toBeInTheDocument();
    });

    it('lista da maior alta para a maior queda, com a contagem dos dois lados', () => {
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        const ordem = within(dialog).getAllByText(/^(PETR4|ITSA4|VALE3|KNCR11)$/).map((el) => el.textContent);
        expect(ordem).toEqual([
            'PETR4 · Ação', 'ITSA4 · Ação', 'VALE3 · Ação', 'KNCR11 · FII',
        ]);
        expect(within(dialog).queryByText(/Petrobras|Itaúsa|Kinea Rendimentos/)).not.toBeInTheDocument();

        expect(within(dialog).getByText(/em alta/)).toHaveTextContent('2 em alta');
        expect(within(dialog).getByText(/em queda/)).toHaveTextContent('2 em queda');
    });

    it('mascara os R$ no modo privacidade e preserva a leitura relativa', () => {
        setWallet(carteira(), kpis(), true);
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByText(/R\$ 214,80/)).not.toBeInTheDocument();
        expect(within(dialog).getAllByText('••••••').length).toBeGreaterThan(0);
        // Percentual é razão, não revela patrimônio: segue visível, como na lista
        // de ativos. É o que mantém o painel legível com os valores escondidos.
        expect(within(dialog).getByText('+1,62%')).toBeInTheDocument();
    });
});

describe('DayMoversModal — motivos', () => {
    it('o caso normal não ganha etiqueta', () => {
        render(<DayMoversModal isOpen onClose={vi.fn()} />);
        expect(screen.queryByText('sem negócio hoje')).not.toBeInTheDocument();
        expect(screen.queryByText('na curva')).not.toBeInTheDocument();
    });

    it('não mostra "na curva" nas posições de renda fixa', () => {
        setWallet([
            asset({
                ticker: 'CDB-BANCO-2028', name: 'CDB Banco 2028', type: 'FIXED_INCOME',
                dayChangeValue: 2.5, dayChangePct: 0.04, dayChangeReason: 'FIXED_INCOME_CURVE',
            }),
        ], kpis({ dayVariation: 2.5, dayVariationPercent: 0.04 }));
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('CDB-BANCO-2028')).toBeInTheDocument();
        expect(screen.queryByText('na curva')).not.toBeInTheDocument();
    });

    it('uma posição fora do caso normal ganha a etiqueta na linha', () => {
        setWallet([
            ...carteira(),
            asset({ ticker: 'RECR11', name: 'REC Recebíveis', type: 'FII', dayChangeValue: 0, dayChangeReason: 'STALE_QUOTE' }),
        ], kpis());
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('sem negócio hoje')).toBeInTheDocument();
        // Zero NOSSO permanece listado — não vira contador anônimo.
        expect(screen.getByText('RECR11')).toHaveTextContent('RECR11 · FII');
    });

    it('mercado inteiro parado vira faixa única, sem repetir a etiqueta', () => {
        setWallet(
            carteira().map((a) => ({ ...a, dayChangeValue: 0, dayChangeReason: 'STALE_QUOTE' as const })),
            kpis({ dayVariation: 0, dayVariationPercent: 0 }),
        );
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText(/Nenhum ativo negociou desde o fechamento de segunda-feira, 31\/08/)).toBeInTheDocument();
        expect(screen.queryByText('sem negócio hoje')).not.toBeInTheDocument();
    });

    it('agrupa quem negociou e fechou estável, sem sumir com quem falta dado', () => {
        setWallet([
            asset({ ticker: 'PETR4', dayChangeValue: 214.8 }),
            asset({ ticker: 'WEGE3', dayChangeValue: 0, dayChangeReason: 'ANCHOR_CLOSE' }),
            asset({ ticker: 'BBAS3', dayChangeValue: 0, dayChangeReason: 'ANCHOR_CLOSE' }),
            asset({ ticker: 'XPTO11', dayChangeValue: 0, dayChangeReason: 'NO_QUOTE' }),
        ], kpis());
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('2 ativos negociaram e fecharam estáveis.')).toBeInTheDocument();
        expect(screen.queryByText('WEGE3')).not.toBeInTheDocument();
        expect(screen.getAllByText('XPTO11').length).toBeGreaterThan(0);
        expect(screen.getByText('sem cotação')).toBeInTheDocument();
    });

    it('resume Tesouros sem PU numa nota ao final, sem linhas zeradas', () => {
        setWallet([
            asset({
                ticker: 'TESOURO IPCA+ 2035', name: 'Tesouro IPCA+ 2035', type: 'FIXED_INCOME',
                dayChangeValue: 0, dayChangeReason: 'FIXED_INCOME_MTM_PENDING', priceDate: '2026-09-01',
            }),
            asset({
                ticker: 'TESOURO PREFIXADO 2029', name: 'Tesouro Prefixado 2029', type: 'FIXED_INCOME',
                dayChangeValue: 0, dayChangeReason: 'FIXED_INCOME_MTM_PENDING', priceDate: '2026-09-01',
            }),
        ], kpis({ dayVariation: 0, dayVariationPercent: 0 }));
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.queryByText('TESOURO IPCA+ 2035')).not.toBeInTheDocument();
        expect(screen.getByText(/2 títulos usam o último PU oficial, de 01\/09/)).toBeInTheDocument();
        expect(screen.getByText(/não aparecem na lista de movimentos/)).toBeInTheDocument();
    });

    it('usa os mesmos logos contextuais do Detalhamento da Carteira', () => {
        setWallet([
            asset({ ticker: 'BTC', name: 'Bitcoin', type: 'CRYPTO', currency: 'USD', dayChangeValue: 10 }),
            asset({ ticker: 'KNCR11', name: 'Kinea Rendimentos', type: 'FII', sector: 'Papel', dayChangeValue: -5 }),
            asset({ ticker: 'RESERVA', name: 'Reserva de emergência', type: 'CASH', isReserve: true, dayChangeValue: 1 }),
        ], kpis());
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByRole('img', { name: 'Bitcoin' })).toBeInTheDocument();
        expect(document.querySelector('.lucide-file-text')).toBeInTheDocument();
        expect(document.querySelector('.lucide-piggy-bank')).toBeInTheDocument();
    });

    it('mostra ticker e classe; somente a Reserva mantém o nome amigável', () => {
        setWallet([
            asset({
                ticker: 'RESERVA-RESERVA-DE-EMERGENCIA',
                name: 'Reserva de Emergência',
                type: 'CASH',
                isReserve: true,
                dayChangeValue: 1,
            }),
            asset({
                ticker: 'RESERVA-RESCISAO-HUAWEI',
                name: 'Rescisão Huawei',
                type: 'CASH',
                isReserve: true,
                dayChangeValue: 2,
            }),
            asset({
                ticker: 'PETR4',
                name: 'Petrobras',
                sector: 'Petróleo e Gás',
                dayChangeValue: 3,
            }),
            asset({
                ticker: 'KNCR11',
                name: 'Kinea Rendimentos',
                sector: 'Papel',
                type: 'FII',
                dayChangeValue: 4,
            }),
            asset({
                ticker: 'BTC',
                name: 'Bitcoin',
                type: 'CRYPTO',
                currency: 'USD',
                dayChangeValue: 5,
            }),
        ], kpis());
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Reserva de Emergência')).toBeInTheDocument();
        expect(screen.getByText('Rescisão Huawei')).toBeInTheDocument();
        expect(screen.getByText('PETR4')).toHaveTextContent('PETR4 · Ação');
        expect(screen.getByText('KNCR11')).toHaveTextContent('KNCR11 · FII');
        expect(screen.getByText('BTC')).toHaveTextContent('BTC · Cripto');
        expect(screen.queryByText(/RESERVA-RESERVA-DE-EMERGENCIA/)).not.toBeInTheDocument();
        expect(screen.queryByText(/RESERVA-RESCISAO-HUAWEI/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Petrobras|Kinea Rendimentos|Bitcoin/)).not.toBeInTheDocument();
    });
});

describe('DayMoversModal — proventos do dia-ex', () => {
    it('explica a queda do dia-ex FORA do total', () => {
        setWallet(
            carteira().map((a) => (a.ticker === 'KNCR11' ? { ...a, dayDividends: 142.5 } : a)),
            kpis({ dayDividends: 142.5 }),
        );
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText(/ficou/)).toHaveTextContent('KNCR11');
        expect(screen.getByText('R$ 142,50')).toBeInTheDocument();
        expect(screen.getByText(/não nesta conta de preço/)).toBeInTheDocument();
        // O total do cabeçalho segue sendo só preço.
        expect(screen.getByText('+R$ 108,20')).toBeInTheDocument();
        expect(screen.getAllByText('ex-provento').length).toBeGreaterThan(0);
    });

    it('sem provento na janela, a nota não aparece', () => {
        render(<DayMoversModal isOpen onClose={vi.fn()} />);
        expect(screen.queryByText(/não nesta conta de preço/)).not.toBeInTheDocument();
    });
});

describe('DayMoversModal — carteira sem movimento', () => {
    it('diz que nada se moveu em vez de mostrar uma lista vazia', () => {
        setWallet(
            carteira().map((a) => ({ ...a, dayChangeValue: 0 })),
            kpis({ dayVariation: 0, dayVariationPercent: 0 }),
        );
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText(/Nenhuma posição se moveu desde o fechamento de segunda-feira, 31\/08/)).toBeInTheDocument();
    });

    it('carteira vazia não promete detalhe que não existe', () => {
        setWallet([], kpis({ dayVariation: 0, dayVariationPercent: 0 }));
        render(<DayMoversModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Nenhuma posição na carteira para detalhar.')).toBeInTheDocument();
    });
});
