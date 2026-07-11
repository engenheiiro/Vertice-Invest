import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X, Share2, Copy, Check, RefreshCw, Globe, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { Button } from '../ui/Button';
import { useToast } from '../../contexts/ToastContext';
import { walletsService } from '../../services/wallets';

interface ShareWalletModalProps {
    isOpen: boolean;
    walletId?: string;
    walletName?: string;
    initialIsPublic?: boolean;
    initialToken?: string | null;
    initialShowValues?: boolean;
    onClose: () => void;
}

/**
 * (C4) Modal de compartilhamento público de uma carteira. Liga/desliga o link
 * (opt-in, revogável), controla se valores em R$ aparecem e permite rotacionar
 * o token. Após cada mutação invalida a query ['wallets'] para o switcher
 * refletir o estado.
 */
export const ShareWalletModal: React.FC<ShareWalletModalProps> = ({
    isOpen, walletId, walletName, initialIsPublic = false, initialToken = null, initialShowValues = false, onClose,
}) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const [isPublic, setIsPublic] = useState(initialIsPublic);
    const [token, setToken] = useState<string | null>(initialToken);
    const [showValues, setShowValues] = useState(initialShowValues);
    const [busy, setBusy] = useState<null | 'toggle' | 'values' | 'regen'>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsPublic(initialIsPublic);
            setToken(initialToken);
            setShowValues(initialShowValues);
            setCopied(false);
        }
    }, [isOpen, initialIsPublic, initialToken, initialShowValues]);

    if (!isOpen) return null;

    const publicUrl = token ? `${window.location.origin}/p/${token}` : '';

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['wallets'] });

    const enable = async () => {
        if (!walletId) return;
        setBusy('toggle');
        try {
            const res = await walletsService.share(walletId, { showValues });
            setToken(res.publicToken);
            setIsPublic(true);
            refresh();
            addToast('Link público ativado.', 'success');
        } catch (err: any) {
            addToast(err?.message || 'Não foi possível ativar o link.', 'error');
        } finally {
            setBusy(null);
        }
    };

    const disable = async () => {
        if (!walletId) return;
        setBusy('toggle');
        try {
            await walletsService.unshare(walletId);
            setToken(null);
            setIsPublic(false);
            refresh();
            addToast('Link público revogado.', 'success');
        } catch (err: any) {
            addToast(err?.message || 'Não foi possível revogar o link.', 'error');
        } finally {
            setBusy(null);
        }
    };

    const toggleValues = async () => {
        if (!walletId) return;
        const next = !showValues;
        setShowValues(next);
        if (!isPublic) return; // só persiste quando já está compartilhada
        setBusy('values');
        try {
            await walletsService.share(walletId, { showValues: next });
            refresh();
        } catch (err: any) {
            setShowValues(!next); // reverte visual em caso de falha
            addToast(err?.message || 'Não foi possível atualizar a preferência.', 'error');
        } finally {
            setBusy(null);
        }
    };

    const regenerate = async () => {
        if (!walletId) return;
        setBusy('regen');
        try {
            const res = await walletsService.share(walletId, { showValues, regenerate: true });
            setToken(res.publicToken);
            setCopied(false);
            refresh();
            addToast('Novo link gerado. O anterior foi desativado.', 'success');
        } catch (err: any) {
            addToast(err?.message || 'Não foi possível gerar um novo link.', 'error');
        } finally {
            setBusy(null);
        }
    };

    const copy = async () => {
        if (!publicUrl) return;
        try {
            await navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            addToast('Não foi possível copiar. Copie manualmente.', 'error');
        }
    };

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}></div>
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-md rounded-2xl bg-base border border-slate-800 shadow-2xl animate-fade-in">
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-card">
                            <h2 className="text-base font-bold text-white flex items-center gap-2">
                                <Share2 size={18} className="text-blue-400" />
                                Compartilhar carteira
                            </h2>
                            <button onClick={onClose} aria-label="Fechar" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            {walletName && (
                                <p className="text-xs text-slate-500">
                                    Carteira: <span className="text-slate-300 font-semibold">{walletName}</span>
                                </p>
                            )}

                            {/* Toggle principal */}
                            <div className="flex items-start gap-3 bg-card border border-slate-800 rounded-xl p-4">
                                <Globe size={18} className={`mt-0.5 shrink-0 ${isPublic ? 'text-emerald-400' : 'text-slate-500'}`} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-200">Link público</p>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                        Qualquer pessoa com o link vê a composição e a rentabilidade (%). Off por padrão.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={isPublic ? disable : enable}
                                    disabled={busy === 'toggle'}
                                    aria-pressed={isPublic}
                                    className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-60 ${isPublic ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isPublic ? 'translate-x-5' : ''}`} />
                                </button>
                            </div>

                            {isPublic && (
                                <>
                                    {/* Link + copiar */}
                                    <div>
                                        <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Link</label>
                                        <div className="flex gap-2 mt-1.5">
                                            <input
                                                readOnly
                                                value={publicUrl}
                                                onFocus={(e) => e.currentTarget.select()}
                                                className="flex-1 min-w-0 bg-deep border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono truncate"
                                            />
                                            <button
                                                type="button"
                                                onClick={copy}
                                                className="shrink-0 inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg px-3 text-xs transition-colors"
                                            >
                                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                                {copied ? 'Copiado' : 'Copiar'}
                                            </button>
                                        </div>
                                        <div className="flex items-center justify-between mt-2">
                                            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300">
                                                <ExternalLink size={11} /> Abrir link
                                            </a>
                                            <button type="button" onClick={regenerate} disabled={busy === 'regen'} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-60">
                                                <RefreshCw size={11} className={busy === 'regen' ? 'animate-spin' : ''} /> Gerar novo link
                                            </button>
                                        </div>
                                    </div>

                                    {/* Exibir valores em R$ */}
                                    <div className="flex items-start gap-3 bg-card border border-slate-800 rounded-xl p-4">
                                        {showValues ? <Eye size={18} className="mt-0.5 shrink-0 text-amber-400" /> : <EyeOff size={18} className="mt-0.5 shrink-0 text-slate-500" />}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-slate-200">Exibir valores em R$</p>
                                            <p className="text-[11px] text-slate-500 mt-0.5">
                                                Desligado, o visitante vê só percentuais. Ligado, expõe seu patrimônio em reais.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={toggleValues}
                                            disabled={busy === 'values'}
                                            aria-pressed={showValues}
                                            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-60 ${showValues ? 'bg-amber-500' : 'bg-slate-700'}`}
                                        >
                                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${showValues ? 'translate-x-5' : ''}`} />
                                        </button>
                                    </div>
                                </>
                            )}

                            <div className="pt-1">
                                <Button type="button" variant="ghost" onClick={onClose} className="w-full">Fechar</Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};
