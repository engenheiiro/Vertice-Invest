import React, { useEffect, useRef, useState } from 'react';
import { Wallet as WalletIcon, ChevronDown, Plus, Pencil, Trash2, Check, Loader2, Share2, Globe } from 'lucide-react';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../../contexts/ToastContext';
import { RenameWalletModal } from './RenameWalletModal';
import { ShareWalletModal } from './ShareWalletModal';
import type { WalletSummary } from '../../services/wallets';

interface WalletSwitcherProps {
    /** Versão somente com ícone para espaços estreitos, como o título mobile da carteira. */
    compact?: boolean;
}

/**
 * Seletor de carteira ativa (Fase 2 — múltiplas carteiras). Fica no Header,
 * visível em Terminal e Carteira; oculto em modo demo (pseudo-carteira única).
 */
export const WalletSwitcher: React.FC<WalletSwitcherProps> = ({ compact = false }) => {
    const { isDemoMode } = useDemo();
    const { wallets, activeWalletId, activeWalletName, isWalletsLoading, isSwitchingWallet, setActiveWallet, deleteWallet } = useWallet();
    const { addToast } = useToast();
    const confirm = useConfirm();
    const [isOpen, setIsOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'rename' | null>(null);
    const [editingWallet, setEditingWallet] = useState<{ id: string; name: string } | null>(null);
    const [sharingWallet, setSharingWallet] = useState<WalletSummary | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen]);

    // Modo demo: pseudo-carteira única, sem seletor real.
    if (isDemoMode) return null;

    const handleSelect = async (walletId: string) => {
        if (isSwitchingWallet) return; // evita disparar outra troca em cima de uma em andamento
        setIsOpen(false);
        if (walletId === activeWalletId) return;
        await setActiveWallet(walletId);
    };

    const handleDelete = async (e: React.MouseEvent, wallet: { id: string; name: string }) => {
        e.stopPropagation();
        if (wallets.length <= 1) return;
        const ok = await confirm({
            title: 'Excluir carteira?',
            message: `ATENÇÃO: isso apaga permanentemente "${wallet.name}" — todos os ativos, o histórico e as metas dela. Esta ação é irreversível.`,
            isDestructive: true,
            confirmText: 'Sim, Excluir',
        });
        if (!ok) return;
        try {
            await deleteWallet(wallet.id);
            addToast('Carteira excluída.', 'success');
        } catch (err: any) {
            addToast(err?.message || 'Erro ao excluir carteira.', 'error');
        }
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen((v) => !v)}
                disabled={isSwitchingWallet}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-busy={isSwitchingWallet}
                aria-label={compact ? `Trocar carteira. Carteira ativa: ${activeWalletName}` : undefined}
                title={compact ? `Trocar carteira — ${activeWalletName}` : activeWalletName}
                className={`flex items-center rounded-lg font-bold text-slate-300 hover:text-white hover:bg-slate-800/60 border border-slate-800 transition-colors disabled:opacity-60 disabled:cursor-wait ${compact ? 'min-h-[44px] min-w-[44px] justify-center gap-1 px-2' : 'gap-2 px-3 py-2 text-xs max-w-[180px]'}`}
            >
                <WalletIcon size={compact ? 18 : 14} className="text-blue-400 shrink-0" />
                <span className={compact ? 'sr-only' : 'truncate'}>{activeWalletName}</span>
                {isSwitchingWallet ? (
                    <Loader2 size={12} className="shrink-0 animate-spin text-slate-500" />
                ) : (
                    <ChevronDown size={12} className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                )}
            </button>

            {isOpen && (
                <div className={`absolute left-0 top-full mt-2 z-50 ${compact ? 'w-[calc(100vw-2rem)] max-w-[20rem]' : 'min-w-[16rem]'}`}>
                    <div className="bg-card border border-slate-800 rounded-xl shadow-2xl p-1.5">
                        <p className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Minhas Carteiras</p>
                        <div className={`max-h-64 overflow-y-auto custom-scrollbar ${isSwitchingWallet ? 'opacity-60 pointer-events-none' : ''}`}>
                            {isWalletsLoading ? (
                                <p className="px-2.5 py-2 text-xs text-slate-500">Carregando...</p>
                            ) : wallets.map((w) => {
                                const active = w.id === activeWalletId;
                                return (
                                    <div
                                        key={w.id}
                                        onClick={() => handleSelect(w.id)}
                                        role="menuitem"
                                        className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'}`}
                                    >
                                        <span className="w-4 shrink-0 flex items-center justify-center">
                                            {active && <Check size={13} className="text-blue-400" />}
                                        </span>
                                        <span className="flex-1 truncate">{w.name}</span>
                                        {w.isPublic && (
                                            <Globe size={11} className="shrink-0 text-emerald-400" aria-label="Carteira pública" />
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setIsOpen(false); setSharingWallet(w); }}
                                            aria-label={`Compartilhar ${w.name}`}
                                            className="min-h-[36px] min-w-[36px] xl:min-h-0 xl:min-w-0 inline-flex items-center justify-center opacity-100 xl:opacity-0 xl:group-hover:opacity-100 text-slate-500 hover:text-emerald-400 transition-all shrink-0 p-2 xl:p-0.5"
                                        >
                                            <Share2 size={12} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setEditingWallet({ id: w.id, name: w.name }); setModalMode('rename'); }}
                                            aria-label={`Renomear ${w.name}`}
                                            className="min-h-[36px] min-w-[36px] xl:min-h-0 xl:min-w-0 inline-flex items-center justify-center opacity-100 xl:opacity-0 xl:group-hover:opacity-100 text-slate-500 hover:text-blue-400 transition-all shrink-0 p-2 xl:p-0.5"
                                        >
                                            <Pencil size={12} />
                                        </button>
                                        {wallets.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={(e) => handleDelete(e, w)}
                                                aria-label={`Excluir ${w.name}`}
                                                className="min-h-[36px] min-w-[36px] xl:min-h-0 xl:min-w-0 inline-flex items-center justify-center opacity-100 xl:opacity-0 xl:group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all shrink-0 p-2 xl:p-0.5"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="border-t border-slate-800 mt-1 pt-1">
                            <button
                                type="button"
                                onClick={() => { setIsOpen(false); setEditingWallet(null); setModalMode('create'); }}
                                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-bold text-blue-400 hover:bg-blue-500/10 transition-colors"
                            >
                                <Plus size={14} /> Nova Carteira
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <RenameWalletModal
                isOpen={modalMode !== null}
                mode={modalMode || 'create'}
                walletId={editingWallet?.id}
                currentName={editingWallet?.name || ''}
                onClose={() => { setModalMode(null); setEditingWallet(null); }}
            />

            <ShareWalletModal
                isOpen={sharingWallet !== null}
                walletId={sharingWallet?.id}
                walletName={sharingWallet?.name}
                initialIsPublic={!!sharingWallet?.isPublic}
                initialToken={sharingWallet?.publicToken ?? null}
                initialShowValues={!!sharingWallet?.publicShowValues}
                onClose={() => setSharingWallet(null)}
            />
        </div>
    );
};
