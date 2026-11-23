import React from 'react';
import { Lock, RefreshCw, TrendingUp, PlusCircle, Trash2, Loader2, DollarSign, Pencil, Eye } from 'lucide-react';
import { WalletSwitcher } from './WalletSwitcher';
import { walletSubtitle, usdBadgeText, type WalletAccess } from './walletViewModel';

interface WalletTitleProps {
    isReadOnly: boolean;
    isRefreshing: boolean;
    walletName: string | null | undefined;
    ownerFirstName?: string | null;
    usdRate: number | null | undefined;
    onRename: () => void;
}

const RENAME_BUTTON = 'hidden xl:inline-flex min-h-[40px] min-w-[40px] -m-2 items-center justify-center '
    + 'text-slate-500 hover:text-blue-400 transition-colors shrink-0';
const READ_ONLY_BADGE = 'shrink-0 inline-flex items-center gap-1.5 px-2 py-1 bg-slate-800/60 border border-slate-700 rounded-full '
    + 'text-[10px] font-bold uppercase tracking-wider text-slate-400';

/** Nome da carteira, selos de estado e a frase de abertura. */
export const WalletTitle: React.FC<WalletTitleProps> = ({ isReadOnly, isRefreshing, walletName, ownerFirstName, usdRate, onRename }) => {
    const usdBadge = usdBadgeText(usdRate);
    return (
        <div>
            <div className="flex items-center gap-2.5 min-w-0">
                {!isReadOnly && (
                    <div className="xl:hidden shrink-0">
                        <WalletSwitcher compact />
                    </div>
                )}
                <h1 className="text-2xl md:text-[27px] font-extrabold text-white tracking-[-0.02em] truncate">
                    {walletName || 'Minha Carteira'}
                </h1>
                {!isReadOnly && (
                    <button
                        onClick={onRename}
                        title="Renomear carteira"
                        aria-label="Renomear carteira"
                        // -m-2: área de toque de 40px sem deslocar o título.
                        className={RENAME_BUTTON}
                    >
                        <Pencil size={16} />
                    </button>
                )}
                {isReadOnly && (
                    <span className={READ_ONLY_BADGE}>
                        <Eye size={11} /> Somente leitura
                    </span>
                )}
                {isRefreshing && (
                    <div className="flex items-center gap-2 px-2 py-1 bg-blue-900/20 rounded-full border border-blue-900/50 animate-fade-in">
                        <Loader2 size={14} className="text-blue-400 animate-spin" />
                        <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Atualizando...</span>
                    </div>
                )}
            </div>
            <div className="flex items-start gap-2.5 mt-1">
                <p className="text-slate-400 text-sm leading-relaxed max-w-md">
                    {walletSubtitle(isReadOnly, ownerFirstName)}
                </p>
                {usdBadge && (
                    <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-900/20 border border-blue-900/40 rounded-full">
                        <DollarSign size={10} className="text-blue-400" />
                        <span className="text-[10px] text-blue-400 font-bold tabular-nums">
                            {usdBadge}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

interface WalletActionsProps {
    access: WalletAccess;
    tourLayer: string;
    hasAssets: boolean;
    onAdd: () => void;
    onSmart: () => void;
    onRebalance: () => void;
    onReset: () => void;
}

const ACTION_BUTTON = 'w-11 sm:w-auto flex items-center justify-center gap-2 px-0 sm:px-3 md:px-5 py-2.5 h-10 rounded-xl text-xs font-bold';
const ACTION_TAIL = 'whitespace-nowrap transition-all active:scale-95';
const ADD_BUTTON = `${ACTION_BUTTON} bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 border border-transparent ${ACTION_TAIL}`;
const SMART_BUTTON = `${ACTION_BUTTON} bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 border border-transparent ${ACTION_TAIL}`;
const REBALANCE_BUTTON = `${ACTION_BUTTON} bg-gradient-to-r from-[#D4AF37] via-[#F2D06B] to-[#D4AF37] text-black hover:brightness-110 `
    + `shadow-lg shadow-[#D4AF37]/20 border-none ${ACTION_TAIL}`;
const RESET_BUTTON = 'w-11 sm:w-10 px-0 flex items-center justify-center gap-2 h-10 rounded-xl transition-all border text-xs font-bold';
const RESET_ENABLED = 'bg-red-900/10 border-red-900/30 text-red-500 hover:bg-red-900/30 hover:text-red-400 hover:border-red-800';
const RESET_DISABLED = 'opacity-50 cursor-not-allowed border-slate-800 text-slate-600';

/** Barra de ações de quem escreve na carteira (não existe no link público). */
export const WalletActions: React.FC<WalletActionsProps> = ({ access, tourLayer, hasAssets, onAdd, onSmart, onRebalance, onReset }) => (
    <div id="tour-wallet-actions" className={`flex flex-wrap items-center gap-2 md:gap-3 transition-opacity duration-500 ${tourLayer}`}>
        {/* No mobile as quatro ações são SÓ o ícone, numa linha só: com
            rótulo, mesmo curto, cada botão ocupava meia tela e a barra
            virava duas fileiras largas em cima do conteúdo. O nome
            continua no `aria-label`/`title` — quem usa leitor de tela ou
            segura o dedo no botão recebe a mesma frase de sempre. */}
        <button
            aria-label="Nova Transação"
            title="Nova Transação"
            className={ADD_BUTTON}
            onClick={onAdd}
        >
            <PlusCircle size={16} /> <span className="hidden sm:inline">Nova Transação</span>
        </button>

        {/* Importar carteira NÃO fica aqui: a barra de ações é do dia
            a dia de quem já tem carteira, e importar é um gesto de
            uma vez só. A porta é o estado vazio da Visão Geral —
            some sozinha assim que existe o primeiro ativo. */}

        {/* Cadeado NO LUGAR do ícone da ação, e não ao lado dele: num
            botão de 44px dois ícones ficam ilegíveis, e o cadeado é a
            informação que decide se vale clicar. */}
        <button
            aria-label="Aporte Inteligente"
            title="Aporte Inteligente"
            className={SMART_BUTTON}
            onClick={onSmart}
        >
            {access.smartLocked ? <Lock size={16} /> : <TrendingUp size={16} />}
            <span className="hidden sm:inline">Aporte Inteligente</span>
        </button>

        <button
            aria-label="Rebalanceamento IA"
            title="Rebalanceamento IA"
            className={REBALANCE_BUTTON}
            onClick={onRebalance}
        >
            {access.canRebalance ? <RefreshCw size={16} className="text-black/80" /> : <Lock size={16} className="text-black/80" />}
            <span className="hidden sm:inline">Rebalanceamento IA</span>
        </button>

        <div className="w-px h-8 bg-slate-800 hidden lg:block mx-1"></div>
        <button
            onClick={() => hasAssets && onReset()}
            className={`${RESET_BUTTON} ${hasAssets ? RESET_ENABLED : RESET_DISABLED}`}
            title="Resetar Carteira"
            aria-label="Resetar Carteira"
            disabled={!hasAssets}
        >
            <Trash2 size={16} />
        </button>
    </div>
);
