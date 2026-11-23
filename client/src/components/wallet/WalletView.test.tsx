/**
 * Testes de caracterização da página Carteira (WalletView).
 *
 * Travam o que a tela mostra em cada combinação de contexto: carregando, vazia,
 * com ativos, modo leitura (link público), tutorial (demo), gates de plano das
 * abas e das ações, e o selo USD/BRL. Os filhos pesados viram stubs: aqui só
 * importa QUAL deles a view monta e com que props.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { WalletView } from './WalletView';
import { useAuth } from '../../contexts/AuthContext';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
const mockAddToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mockAddToast }) }));

const mockNavigate = vi.fn();
let mockLocationState: unknown = null;
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: mockLocationState }),
}));

type OpenProps = { isOpen?: boolean; onClose?: () => void };
const { stubModal } = vi.hoisted(() => ({
    stubModal: (name: string) => ({ isOpen, onClose }: OpenProps) =>
        isOpen ? <div data-testid={name}><button onClick={onClose}>fechar {name}</button></div> : null,
}));

vi.mock('./WalletSummary', () => ({ WalletSummary: () => <div data-testid="WalletSummary" /> }));
vi.mock('./AssetList', () => ({ AssetList: () => <div data-testid="AssetList" /> }));
vi.mock('./EvolutionChart', () => ({ EvolutionChart: () => <div data-testid="EvolutionChart" /> }));
vi.mock('./AllocationChart', () => ({
    AllocationChart: ({ initialViewMode, autoOpenDividendGoal, onAutoOpenHandled }: {
        initialViewMode?: string; autoOpenDividendGoal?: boolean; onAutoOpenHandled?: () => void;
    }) => (
        <div data-testid="AllocationChart" data-mode={initialViewMode ?? 'default'} data-goal={String(autoOpenDividendGoal)}>
            <button onClick={onAutoOpenHandled}>goal tratado</button>
        </div>
    ),
}));
vi.mock('./PerformanceChart', () => ({ PerformanceChart: () => <div data-testid="PerformanceChart" /> }));
vi.mock('./MonthlyReturnsTable', () => ({ MonthlyReturnsTable: () => <div data-testid="MonthlyReturnsTable" /> }));
vi.mock('./DividendDashboard', () => ({ DividendDashboard: () => <div data-testid="DividendDashboard" /> }));
vi.mock('./CashFlowHistory', () => ({ CashFlowHistory: () => <div data-testid="CashFlowHistory" /> }));
vi.mock('./TaxReport', () => ({ TaxReport: () => <div data-testid="TaxReport" /> }));
vi.mock('./AddAssetModal', () => ({ AddAssetModal: stubModal('AddAssetModal') }));
vi.mock('./SmartContributionModal', () => ({ SmartContributionModal: stubModal('SmartContributionModal') }));
vi.mock('./RebalanceModal', () => ({ RebalanceModal: stubModal('RebalanceModal') }));
vi.mock('./import/ImportWalletModal', () => ({ ImportWalletModal: stubModal('ImportWalletModal') }));
vi.mock('./RenameWalletModal', () => ({
    RenameWalletModal: ({ isOpen, walletId, currentName }: OpenProps & { walletId?: string; currentName?: string }) =>
        isOpen ? <div data-testid="RenameWalletModal">{walletId}|{currentName}</div> : null,
}));
vi.mock('./WalletSwitcher', () => ({ WalletSwitcher: () => <div data-testid="WalletSwitcher" /> }));

const mockResetWallet = vi.fn();
const walletBase = {
    assets: [{ id: 'a1', ticker: 'PETR4' }],
    resetWallet: mockResetWallet,
    isLoading: false,
    isRefreshing: false,
    usdRate: 5.4321 as number | null,
    activeWalletId: 'w1',
    activeWalletName: 'Principal' as string | null,
    isReadOnly: false,
};

const setup = (opts: {
    plan?: string; role?: string; noUser?: boolean;
    wallet?: Partial<typeof walletBase>;
    demo?: { isDemoMode: boolean; currentStep: number };
    ownerFirstName?: string | null;
} = {}) => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        user: opts.noUser ? null : { plan: opts.plan ?? 'PRO', role: opts.role ?? 'USER' },
    });
    (useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ ...walletBase, ...opts.wallet });
    (useDemo as unknown as ReturnType<typeof vi.fn>).mockReturnValue(opts.demo ?? { isDemoMode: false, currentStep: 0 });
    return render(<WalletView ownerFirstName={opts.ownerFirstName} />);
};

const tab = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
    vi.clearAllMocks();
    mockLocationState = null;
});

describe('WalletView — cabeçalho', () => {
    it('mostra o nome da carteira, o seletor, o lápis e a frase de gestão', () => {
        setup();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Principal');
        expect(screen.getByTestId('WalletSwitcher')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Renomear carteira' })).toBeInTheDocument();
        expect(screen.getByText('Gerencie seus ativos e acompanhe a evolução patrimonial.')).toBeInTheDocument();
        expect(screen.queryByText('Somente leitura')).not.toBeInTheDocument();
        expect(screen.queryByText('Atualizando...')).not.toBeInTheDocument();
    });

    it('sem nome cai em "Minha Carteira"', () => {
        setup({ wallet: { activeWalletName: null } });
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Minha Carteira');
    });

    it('mostra o selo de atualização enquanto recarrega', () => {
        setup({ wallet: { isRefreshing: true } });
        expect(screen.getByText('Atualizando...')).toBeInTheDocument();
    });

    it('mostra o câmbio USD/BRL com duas casas quando a taxa é positiva', () => {
        setup();
        expect(screen.getByText('USD/BRL R$5.43')).toBeInTheDocument();
    });

    it.each([[null], [0], [-1]])('esconde o câmbio quando a taxa é %s', (usdRate) => {
        setup({ wallet: { usdRate } });
        expect(screen.queryByText(/USD\/BRL/)).not.toBeInTheDocument();
    });

    it('lápis abre o renomear com id e nome da carteira ativa', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'Renomear carteira' }));
        expect(screen.getByTestId('RenameWalletModal')).toHaveTextContent('w1|Principal');
    });
});

describe('WalletView — modo leitura (link público)', () => {
    it('assina com o primeiro nome do dono e retira tudo que escreve', () => {
        setup({ wallet: { isReadOnly: true }, ownerFirstName: 'Ana' });
        expect(screen.getByText('Somente leitura')).toBeInTheDocument();
        expect(screen.getByText('Carteira compartilhada por Ana. Os dados são os mesmos que o investidor acompanha.')).toBeInTheDocument();
        expect(screen.queryByTestId('WalletSwitcher')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Renomear carteira' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Nova Transação' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Resetar Carteira' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Imposto de Renda/ })).not.toBeInTheDocument();
    });

    it('sem nome do dono, a frase não leva "por"', () => {
        setup({ wallet: { isReadOnly: true }, ownerFirstName: null });
        expect(screen.getByText('Carteira compartilhada. Os dados são os mesmos que o investidor acompanha.')).toBeInTheDocument();
    });

    it('Proventos abre mesmo para visitante sem conta (gate é do dono, no servidor)', async () => {
        setup({ wallet: { isReadOnly: true }, noUser: true });
        fireEvent.click(tab(/Proventos/));
        expect(await screen.findByTestId('DividendDashboard')).toBeInTheDocument();
    });

    it('carteira vazia mostra só o aviso, sem importar nem distribuição', () => {
        setup({ wallet: { isReadOnly: true, assets: [] } });
        expect(screen.getByText('Carteira sem ativos')).toBeInTheDocument();
        expect(screen.queryByText('Importar carteira')).not.toBeInTheDocument();
        expect(screen.queryByTestId('AllocationChart')).not.toBeInTheDocument();
    });
});

describe('WalletView — Visão Geral', () => {
    it('carregando mostra skeleton no lugar do conteúdo', () => {
        const { container } = setup({ wallet: { isLoading: true } });
        expect(container.querySelector('#tour-wallet-content')).toBeNull();
        expect(screen.queryByTestId('AssetList')).not.toBeInTheDocument();
        expect(screen.getByTestId('WalletSummary')).toBeInTheDocument();
    });

    it('com ativos monta evolução, distribuição padrão e lista', () => {
        setup();
        expect(screen.getByTestId('EvolutionChart')).toBeInTheDocument();
        expect(screen.getByTestId('AllocationChart')).toHaveAttribute('data-mode', 'default');
        expect(screen.getByTestId('AssetList')).toBeInTheDocument();
        expect(tab(/Visão Geral/)).toHaveAttribute('aria-current', 'page');
    });

    it('vazia oferece importar/adicionar e a distribuição em modo Ideal', () => {
        setup({ wallet: { assets: [] } });
        expect(screen.getByText('Sua carteira está vazia')).toBeInTheDocument();
        expect(screen.getByTestId('AllocationChart')).toHaveAttribute('data-mode', 'IDEAL');
        expect(screen.queryByTestId('AssetList')).not.toBeInTheDocument();
    });

    it('vazia: "Importar carteira" monta o modal lazy e "Adicionar ativo" abre o cadastro', async () => {
        setup({ wallet: { assets: [] } });
        fireEvent.click(screen.getByRole('button', { name: /Importar carteira/ }));
        expect(await screen.findByTestId('ImportWalletModal')).toBeInTheDocument();
        fireEvent.click(screen.getByText('fechar ImportWalletModal'));
        expect(screen.queryByTestId('ImportWalletModal')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Adicionar ativo/ }));
        expect(screen.getByTestId('AddAssetModal')).toBeInTheDocument();
    });

    it('vinda do Cofre de Dividendos abre a meta, limpa o state e desliga ao tratar', () => {
        mockLocationState = { openDividendGoalEditor: true };
        const spy = vi.spyOn(window.history, 'replaceState');
        setup();
        expect(screen.getByTestId('AllocationChart')).toHaveAttribute('data-goal', 'true');
        expect(spy).toHaveBeenCalledWith({}, document.title);
        fireEvent.click(screen.getByText('goal tratado'));
        expect(screen.getByTestId('AllocationChart')).toHaveAttribute('data-goal', 'false');
        spy.mockRestore();
    });

    it('sem state de navegação não mexe no histórico', () => {
        const spy = vi.spyOn(window.history, 'replaceState');
        setup();
        expect(screen.getByTestId('AllocationChart')).toHaveAttribute('data-goal', 'false');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('WalletView — abas', () => {
    it('Rentabilidade e Extrato carregam seus painéis', async () => {
        setup();
        fireEvent.click(tab(/Rentabilidade/));
        expect(await screen.findByTestId('PerformanceChart')).toBeInTheDocument();
        expect(await screen.findByTestId('MonthlyReturnsTable')).toBeInTheDocument();
        expect(screen.getByText(/benchmark comparativo/)).toBeInTheDocument();
        expect(tab(/Rentabilidade/)).toHaveAttribute('aria-current', 'page');
        expect(tab(/Visão Geral/)).not.toHaveAttribute('aria-current');
        fireEvent.click(tab(/Extrato/));
        expect(await screen.findByTestId('CashFlowHistory')).toBeInTheDocument();
        fireEvent.click(tab(/Visão Geral/));
        expect(screen.getByTestId('AssetList')).toBeInTheDocument();
    });

    it('Proventos liberado no ESSENTIAL', async () => {
        setup({ plan: 'ESSENTIAL' });
        fireEvent.click(tab(/Proventos/));
        expect(await screen.findByTestId('DividendDashboard')).toBeInTheDocument();
    });

    it('Proventos bloqueado no GUEST abre o aviso de upgrade e não troca a aba', () => {
        setup({ plan: 'GUEST' });
        fireEvent.click(tab(/Proventos/));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Acesso Restrito')).toBeInTheDocument();
        expect(within(dialog).getByText(/O painel de Proventos e Dividendos começa no plano Essential\./)).toBeInTheDocument();
        expect(tab(/Visão Geral/)).toHaveAttribute('aria-current', 'page');
        fireEvent.click(within(dialog).getByText('Ver Planos'));
        expect(mockNavigate).toHaveBeenCalledWith('/pricing');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('Proventos liberado para ADMIN mesmo no GUEST; sem usuário fica bloqueado', () => {
        setup({ plan: 'GUEST', role: 'ADMIN' });
        fireEvent.click(tab(/Proventos/));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('sem usuário Proventos e IR ficam bloqueados', () => {
        setup({ noUser: true });
        fireEvent.click(tab(/Proventos/));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Cancelar'));
        fireEvent.click(tab(/Imposto de Renda/));
        expect(screen.getByText(/Relatório de apoio ao Imposto de Renda é um recurso do plano Elite/)).toBeInTheDocument();
    });

    it.each(['ELITE', 'BLACK'])('IR liberado no %s', async (plan) => {
        setup({ plan });
        fireEvent.click(tab(/Imposto de Renda/));
        expect(await screen.findByTestId('TaxReport')).toBeInTheDocument();
    });

    it('IR liberado para ADMIN no PRO', async () => {
        setup({ plan: 'PRO', role: 'ADMIN' });
        fireEvent.click(tab(/Imposto de Renda/));
        expect(await screen.findByTestId('TaxReport')).toBeInTheDocument();
    });

    it('IR bloqueado no PRO mostra o aviso e mantém a aba', () => {
        setup({ plan: 'PRO' });
        fireEvent.click(tab(/Imposto de Renda/));
        expect(screen.getByText(/Relatório de apoio ao Imposto de Renda é um recurso do plano Elite/)).toBeInTheDocument();
        expect(screen.queryByTestId('TaxReport')).not.toBeInTheDocument();
    });
});

describe('WalletView — ações', () => {
    it('Nova Transação abre e fecha o cadastro', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'Nova Transação' }));
        expect(screen.getByTestId('AddAssetModal')).toBeInTheDocument();
        fireEvent.click(screen.getByText('fechar AddAssetModal'));
        expect(screen.queryByTestId('AddAssetModal')).not.toBeInTheDocument();
    });

    it.each(['GUEST', 'ESSENTIAL'])('Aporte Inteligente bloqueado no %s', (plan) => {
        setup({ plan });
        fireEvent.click(screen.getByRole('button', { name: 'Aporte Inteligente' }));
        expect(screen.getByText(/Aporte Inteligente é um recurso exclusivo dos planos Pro e Black/)).toBeInTheDocument();
        expect(screen.queryByTestId('SmartContributionModal')).not.toBeInTheDocument();
    });

    it('Aporte Inteligente abre no PRO', () => {
        setup({ plan: 'PRO' });
        fireEvent.click(screen.getByRole('button', { name: 'Aporte Inteligente' }));
        expect(screen.getByTestId('SmartContributionModal')).toBeInTheDocument();
    });

    it('Rebalanceamento bloqueado no PRO', () => {
        setup({ plan: 'PRO' });
        fireEvent.click(screen.getByRole('button', { name: 'Rebalanceamento IA' }));
        expect(screen.getByText(/Rebalanceamento Automático com IA é um recurso exclusivo dos planos Elite e Black/)).toBeInTheDocument();
        expect(screen.queryByTestId('RebalanceModal')).not.toBeInTheDocument();
    });

    it.each(['ELITE', 'BLACK'])('Rebalanceamento abre no %s', (plan) => {
        setup({ plan });
        fireEvent.click(screen.getByRole('button', { name: 'Rebalanceamento IA' }));
        expect(screen.getByTestId('RebalanceModal')).toBeInTheDocument();
    });

    it('Rebalanceamento no demo avisa por toast e não abre', () => {
        setup({ plan: 'ELITE', demo: { isDemoMode: true, currentStep: 0 } });
        fireEvent.click(screen.getByRole('button', { name: 'Rebalanceamento IA' }));
        expect(mockAddToast).toHaveBeenCalledWith('O Rebalanceamento IA usa os dados reais da sua carteira.', 'info');
        expect(screen.queryByTestId('RebalanceModal')).not.toBeInTheDocument();
    });

    it('cadeado no lugar do ícone conforme o plano', () => {
        const { container } = setup({ plan: 'ESSENTIAL' });
        const smart = screen.getByRole('button', { name: 'Aporte Inteligente' });
        const rebal = screen.getByRole('button', { name: 'Rebalanceamento IA' });
        expect(smart.querySelector('.lucide-lock')).not.toBeNull();
        expect(rebal.querySelector('.lucide-lock')).not.toBeNull();
        expect(tab(/Proventos/).querySelector('.lucide-lock')).toBeNull();
        expect(tab(/Imposto de Renda/).querySelector('.lucide-lock')).not.toBeNull();
        expect(container.querySelectorAll('.lucide-lock')).toHaveLength(3);
    });

    it('sem cadeado no BLACK', () => {
        const { container } = setup({ plan: 'BLACK' });
        expect(container.querySelectorAll('.lucide-lock')).toHaveLength(0);
    });

    it('Resetar confirma e chama resetWallet', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'Resetar Carteira' }));
        expect(screen.getByText('Excluir Carteira Permanentemente?')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Sim, Excluir Tudo'));
        expect(mockResetWallet).toHaveBeenCalledTimes(1);
    });

    it('Resetar fica desabilitado com a carteira vazia', () => {
        setup({ wallet: { assets: [] } });
        const reset = screen.getByRole('button', { name: 'Resetar Carteira' });
        expect(reset).toBeDisabled();
        fireEvent.click(reset);
        expect(screen.queryByText('Excluir Carteira Permanentemente?')).not.toBeInTheDocument();
    });
});

describe('WalletView — tutorial (demo)', () => {
    it('sobe as áreas do tour e força a aba do passo', async () => {
        const { container, rerender } = setup({ demo: { isDemoMode: false, currentStep: 0 } });
        fireEvent.click(tab(/Rentabilidade/));
        await screen.findByTestId('PerformanceChart');
        expect(container.querySelector('#tour-wallet-kpis')?.className).toContain('false');

        (useDemo as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isDemoMode: true, currentStep: 99 });
        rerender(<WalletView />);
        expect(tab(/Visão Geral/)).toHaveAttribute('aria-current', 'page');
        for (const id of ['tour-wallet-actions', 'tour-wallet-kpis', 'tour-wallet-tabs', 'tour-wallet-content']) {
            expect(container.querySelector(`#${id}`)?.className).toContain('relative z-[100]');
        }
    });
});

describe('WalletView — acessibilidade', () => {
    it('não tem violações do axe com ativos', async () => {
        const { container } = setup();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('não tem violações do axe vazia', async () => {
        const { container } = setup({ wallet: { assets: [] } });
        // heading-order fora: o EmptyState usa <h3> direto sob o <h1> da página
        // (pré-existente; caracterização não muda a saída).
        expect(await axe(container, { rules: { 'heading-order': { enabled: false } } })).toHaveNoViolations();
    });
});
