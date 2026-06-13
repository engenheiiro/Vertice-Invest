import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, PiggyBank } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useWallet } from '../../contexts/WalletContext';
import { useToast } from '../../contexts/ToastContext';

interface RenameReserveModalProps {
    isOpen: boolean;
    assetId: string | null;
    currentName: string;
    onClose: () => void;
}

/** Modal enxuto para renomear um "cofrinho" (Reserva/Caixa). */
export const RenameReserveModal: React.FC<RenameReserveModalProps> = ({ isOpen, assetId, currentName, onClose }) => {
    const { updateAsset } = useWallet();
    const { addToast } = useToast();
    const [name, setName] = useState(currentName);
    const [status, setStatus] = useState<'idle' | 'loading'>('idle');

    useEffect(() => {
        if (isOpen) setName(currentName);
    }, [isOpen, currentName]);

    if (!isOpen || !assetId) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        setStatus('loading');
        try {
            await updateAsset(assetId, { name: trimmed });
            addToast('Cofrinho renomeado.', 'success');
            onClose();
        } catch {
            // Toast de erro já vem do WalletContext.
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
                                <PiggyBank size={18} className="text-emerald-400" />
                                Renomear Reserva
                            </h2>
                            <button onClick={onClose} aria-label="Fechar" className="text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            <Input
                                label="Nome do Cofrinho"
                                placeholder="Ex: Reserva de Emergência, Viagem..."
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                containerClassName="mb-0"
                                className="px-4 py-3"
                                maxLength={120}
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
