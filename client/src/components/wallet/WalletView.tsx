import React, { useState, useEffect } from 'react';
import { WalletSummary } from './WalletSummary';
import { WalletTitle, WalletActions } from './WalletViewHeader';
import { WalletTabsBar, WalletTabContent, WalletLoading } from './WalletViewTabs';
import { WalletModals, type WalletModalKey } from './WalletViewModals';
import { getWalletAccess, LIMIT_MESSAGES, tourLayerClass, tutorialTab, wantsDividendGoalEditor, type WalletViewTab } from './walletViewModel';
import { useAuth } from '../../contexts/AuthContext';
import { useWallet } from '../../contexts/WalletContext';
import { useToast } from '../../contexts/ToastContext';
import { useDemo } from '../../contexts/DemoContext';
import { useNavigate, useLocation } from 'react-router-dom';

interface WalletViewProps {
    /** Só em modo leitura: assina o cabeçalho com o primeiro nome do dono. */
    ownerFirstName?: string | null;
}

const CLOSED_MODALS: Record<WalletModalKey, boolean> = {
    add: false, import: false, smart: false, rebalance: false, rename: false, reset: false, limit: false,
};

/**
 * Corpo da página Carteira.
 *
 * É a MESMA view em dois contextos: na área logada (WalletProvider) e no link
 * público compartilhado (PublicWalletProvider). O que muda vem do contexto —
 * `isReadOnly` retira tudo que escreve (transação, aporte, rebalanceamento,
 * reset, renomear, trocar de carteira, IR) — e não de uma segunda página. Cada
 * página só monta a sua própria moldura (Header logado × barra de visitante).
 */
export const WalletView: React.FC<WalletViewProps> = ({ ownerFirstName }) => {
    const { user } = useAuth();
    const { assets, resetWallet, isLoading, isRefreshing, usdRate, activeWalletId, activeWalletName, isReadOnly } = useWallet();
    const { addToast } = useToast();
    const { isDemoMode, currentStep } = useDemo();
    const navigate = useNavigate();
    const location = useLocation();

    // (B1) Cofre de Dividendos (Dashboard) manda direto pra cá com o editor já aberto
    // na Meta de Renda Passiva, em vez de só cair na tela da Carteira.
    const [autoOpenDividendGoal, setAutoOpenDividendGoal] = useState(() => wantsDividendGoalEditor(location.state));
    useEffect(() => {
        // Limpa o state da navegação para não reabrir num refresh/voltar.
        if (autoOpenDividendGoal) window.history.replaceState({}, document.title);
    }, [autoOpenDividendGoal]);

    const [openModals, setOpenModals] = useState(CLOSED_MODALS);
    const [limitMessage, setLimitMessage] = useState('');
    const [activeTab, setActiveTab] = useState<WalletViewTab>('OVERVIEW');

    // (7.11) IR: ELITE+ (ADMIN para QA), nunca no link público. Proventos: ESSENTIAL+;
    // no link público o gate é do DONO e vive no servidor (getPublicWalletDividends).
    const access = getWalletAccess(user, isReadOnly);
    const tourLayer = tourLayerClass(isDemoMode);
    const hasAssets = assets.length > 0;

    // Tutorial: a aba ativa é derivada do metadado `tab` do passo atual.
    useEffect(() => {
        if (isDemoMode) setActiveTab(tutorialTab(currentStep));
    }, [isDemoMode, currentStep]);

    const setModal = (key: WalletModalKey, isOpen: boolean) => setOpenModals(prev => ({ ...prev, [key]: isOpen }));
    const openModal = (key: WalletModalKey) => setModal(key, true);
    // Abre se o plano permite; senão mostra o convite de upgrade com o motivo.
    const gated = (allowed: boolean, message: string, onAllowed: () => void) => () => {
        if (!allowed) {
            setLimitMessage(message);
            openModal('limit');
            return;
        }
        onAllowed();
    };

    const handleRebalance = gated(access.canRebalance, LIMIT_MESSAGES.rebalance, () => {
        // Demo usa dados mock — o plano depende da carteira real, então não chama a API.
        if (isDemoMode) {
            addToast('O Rebalanceamento IA usa os dados reais da sua carteira.', 'info');
            return;
        }
        openModal('rebalance');
    });

    return (
        <main id="main-content" tabIndex={-1} className="max-w-[1360px] mx-auto p-4 md:p-6 animate-fade-in relative">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 md:gap-6 mb-5 md:mb-8">
                <WalletTitle
                    isReadOnly={isReadOnly}
                    isRefreshing={isRefreshing}
                    walletName={activeWalletName}
                    ownerFirstName={ownerFirstName}
                    usdRate={usdRate}
                    onRename={() => openModal('rename')}
                />
                {!isReadOnly && (
                    <WalletActions
                        access={access}
                        tourLayer={tourLayer}
                        hasAssets={hasAssets}
                        onAdd={() => openModal('add')}
                        onSmart={gated(access.canSmartContribute, LIMIT_MESSAGES.smart, () => openModal('smart'))}
                        onRebalance={handleRebalance}
                        onReset={() => openModal('reset')}
                    />
                )}
            </div>

            <div id="tour-wallet-kpis" className={`transition-opacity duration-500 ${tourLayer}`}>
                <WalletSummary />
            </div>

            <WalletTabsBar
                activeTab={activeTab}
                access={access}
                isReadOnly={isReadOnly}
                tourLayer={tourLayer}
                onSelect={setActiveTab}
                onDividends={gated(access.canAccessDividends, LIMIT_MESSAGES.dividends, () => setActiveTab('DIVIDENDS'))}
                onTax={gated(access.canAccessTax, LIMIT_MESSAGES.tax, () => setActiveTab('TAX'))}
            />

            {isLoading ? <WalletLoading /> : (
                <WalletTabContent
                    activeTab={activeTab}
                    access={access}
                    tourLayer={tourLayer}
                    hasAssets={hasAssets}
                    isReadOnly={isReadOnly}
                    autoOpenDividendGoal={autoOpenDividendGoal}
                    onAutoOpenHandled={() => setAutoOpenDividendGoal(false)}
                    onImport={() => openModal('import')}
                    onAdd={() => openModal('add')}
                />
            )}

            {!isReadOnly && (
                <WalletModals
                    open={openModals}
                    onClose={key => setModal(key, false)}
                    limitMessage={limitMessage}
                    walletId={activeWalletId}
                    walletName={activeWalletName}
                    onUpgrade={() => navigate('/pricing')}
                    onReset={resetWallet}
                />
            )}
        </main>
    );
};
