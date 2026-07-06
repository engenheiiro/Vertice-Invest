import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, PieChart } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { authService } from '../../services/auth';

interface RenameWalletModalProps {
    isOpen: boolean;
    currentName: string;
    onClose: () => void;
}

/** Modal enxuto para renomear a carteira do usuário (User.walletName). */
export const RenameWalletModal: React.FC<RenameWalletModalProps> = ({ isOpen, currentName, onClose }) => {
    const { refreshProfile } = useAuth();
    const { addToast } = useToast();
    const [name, setName] = useState(currentName);
    const [status, setStatus] = useState<'idle' | 'loading'>('idle');

    useEffect(() => {
        if (isOpen) setName(currentName);
    }, [isOpen, currentName]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        setStatus('loading');
        try {
            // updateProfile já grava o user devolvido no localStorage; refreshProfile
            // relê o storage (com o walletName novo) e propaga p/ o AuthContext.
            await authService.updateProfile({ walletName: trimmed });
            await refreshProfile();
            addToast('Carteira renomeada.', 'success');
            onClose();
        } catch (err: any) {
            addToast(err?.message || 'Não foi possível renomear a carteira.', 'error');
        } finally {
            setStatus('idle');
        }
    };

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}></div>
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-sm rounded-2xl bg-base border border-slate-800 shadow-2xl animate-fade-in">
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-card">
                            <h2 className="text-base font-bold text-white flex items-center gap-2">
                                <PieChart size={18} className="text-blue-400" />
                                Renomear Carteira
                            </h2>
                            <button onClick={onClose} aria-label="Fechar" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            <Input
                                label="Nome da Carteira"
                                placeholder="Ex: Carteira Principal, Aposentadoria..."
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                containerClassName="mb-0"
                                className="px-4 py-3"
                                maxLength={40}
                                autoFocus
                            />
                            <div className="flex gap-3">
                                <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancelar</Button>
                                <Button type="submit" status={status} disabled={!name.trim()} className="flex-[2]">Salvar</Button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
