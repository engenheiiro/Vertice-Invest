import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, PiggyBank, ArrowRightLeft, Percent, Tag } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useWallet } from '../../contexts/WalletContext';
import { useToast } from '../../contexts/ToastContext';
import { buildFixedIncomeRateFields, type FixedIncomeMode } from '../../utils/assetTransaction';

interface RenameReserveModalProps {
    isOpen: boolean;
    assetId: string | null;
    currentName: string;
    onClose: () => void;
}

// Rótulo/placeholder/ajuda do campo de taxa por modo — espelha o AddAssetModal.
const RATE_UI: Record<FixedIncomeMode, { label: string; placeholder: string; help: string }> = {
    CDI_PCT: { label: 'Rentabilidade (% do CDI)', placeholder: 'Ex: 110', help: 'Ex.: 110 = 110% do CDI.' },
    PRE: { label: 'Taxa prefixada (% ao ano)', placeholder: 'Ex: 12,50', help: 'Taxa fixa, independente do CDI.' },
    IPCA: { label: 'Spread sobre o IPCA (% a.a.)', placeholder: 'Ex: 6,00', help: 'Rende IPCA + esse spread.' },
    SELIC: { label: 'Spread sobre a Selic (% a.a.)', placeholder: 'Ex: 0,10', help: 'Rende Selic + esse spread.' },
};

/**
 * Modal do lápis de um "cofrinho" (Caixa/Reserva): renomeia e, opcionalmente,
 * reclassifica a posição em Renda Fixa (para reservas que na verdade são um
 * título com taxa própria — Tesouro, CDB, LCI). A conversão preserva o valor
 * (CASH guarda price=1) e só troca a curva de rendimento (100% CDI → taxa real).
 */
export const RenameReserveModal: React.FC<RenameReserveModalProps> = ({ isOpen, assetId, currentName, onClose }) => {
    const { updateAsset } = useWallet();
    const { addToast } = useToast();
    const [name, setName] = useState(currentName);
    const [status, setStatus] = useState<'idle' | 'rename' | 'convert'>('idle');

    // Conversão em Renda Fixa.
    const [showConvert, setShowConvert] = useState(false);
    const [mode, setMode] = useState<FixedIncomeMode>('CDI_PCT');
    const [rate, setRate] = useState('100,00');
    const [maturity, setMaturity] = useState('');
    const [keepAsReserve, setKeepAsReserve] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setName(currentName);
            setShowConvert(false);
            setMode('CDI_PCT');
            setRate('100,00');
            setMaturity('');
            setKeepAsReserve(false);
        }
    }, [isOpen, currentName]);

    if (!isOpen || !assetId) return null;

    const handleRename = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        setStatus('rename');
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

    const handleConvert = async () => {
        const rateNum = parseFloat((rate || '').replace(',', '.')) || 0;
        setStatus('convert');
        try {
            await updateAsset(assetId, {
                type: 'FIXED_INCOME',
                ...buildFixedIncomeRateFields(mode, rateNum),
                ...(maturity ? { maturityDate: maturity } : {}),
                isReserve: keepAsReserve,
            });
            addToast('Convertido em Renda Fixa.', 'success');
            onClose();
        } catch {
            // Toast de erro já vem do WalletContext.
        } finally {
            setStatus('idle');
        }
    };

    const ui = RATE_UI[mode];

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}></div>
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-sm rounded-2xl bg-base border border-slate-800 shadow-2xl animate-fade-in">
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-card">
                            <h2 className="text-base font-bold text-white flex items-center gap-2">
                                <PiggyBank size={18} className="text-emerald-400" />
                                Editar Reserva
                            </h2>
                            <button onClick={onClose} aria-label="Fechar" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            <form onSubmit={handleRename} className="space-y-4">
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
                                <Button
                                    type="submit"
                                    status={status === 'rename' ? 'loading' : 'idle'}
                                    disabled={!name.trim() || name.trim() === currentName.trim()}
                                    className="w-full"
                                >
                                    Salvar nome
                                </Button>
                            </form>

                            {/* Reclassificação em Renda Fixa */}
                            <div className="pt-4 border-t border-slate-800">
                                {!showConvert ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowConvert(true)}
                                        className="w-full flex items-center justify-center gap-2 text-xs font-bold text-amber-400 hover:text-amber-300 border border-amber-500/30 hover:border-amber-500/50 rounded-xl py-3 transition-colors"
                                    >
                                        <ArrowRightLeft size={14} />
                                        Converter em Renda Fixa
                                    </button>
                                ) : (
                                    <div className="space-y-4 animate-fade-in">
                                        <p className="text-[11px] text-slate-400 leading-snug">
                                            Use quando esta reserva é, na verdade, um <strong className="text-amber-400">título com taxa própria</strong> (Tesouro,
                                            CDB, LCI). O valor investido é mantido; só passa a render pela taxa abaixo.
                                        </p>

                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-1">Tipo de rendimento</label>
                                            <div className="relative">
                                                <select
                                                    value={mode}
                                                    onChange={(e) => {
                                                        const m = e.target.value as FixedIncomeMode;
                                                        setMode(m);
                                                        setRate(m === 'CDI_PCT' ? '100,00' : '');
                                                    }}
                                                    className="w-full bg-card text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-elevated transition-all"
                                                >
                                                    <option value="CDI_PCT">Pós-fixado — % do CDI (CDB, LCI, LCA...)</option>
                                                    <option value="SELIC">Pós-fixado — Selic + spread (Tesouro Selic)</option>
                                                    <option value="IPCA">Híbrido — IPCA + spread (Tesouro IPCA+, NTN-B)</option>
                                                    <option value="PRE">Prefixado — taxa fixa a.a.</option>
                                                </select>
                                                <Tag className="absolute right-3 top-3.5 text-slate-600 pointer-events-none" size={14} />
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <Input
                                                label={ui.label}
                                                placeholder={ui.placeholder}
                                                value={rate}
                                                onChange={(e) => setRate(e.target.value)}
                                                containerClassName="mb-0"
                                            />
                                            <Percent className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                                            <p className="text-[10px] text-slate-500 mt-1 ml-1">{ui.help}</p>
                                        </div>

                                        <Input
                                            label="Vencimento (opcional)"
                                            type="date"
                                            value={maturity}
                                            onChange={(e) => setMaturity(e.target.value)}
                                            containerClassName="mb-0"
                                        />

                                        <label className="flex items-start gap-2.5 p-3 rounded-lg bg-card border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={keepAsReserve}
                                                onChange={(e) => setKeepAsReserve(e.target.checked)}
                                                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500 cursor-pointer"
                                            />
                                            <span className="text-[11px] leading-snug text-slate-400">
                                                <strong className="text-slate-200">Manter em Reserva / Caixa</strong> — fora da distribuição de
                                                investimentos. Desmarcado, passa a contar no grupo "Renda Fixa".
                                            </span>
                                        </label>

                                        <div className="flex gap-3">
                                            <Button type="button" variant="ghost" onClick={() => setShowConvert(false)} className="flex-1">Voltar</Button>
                                            <Button
                                                type="button"
                                                onClick={handleConvert}
                                                status={status === 'convert' ? 'loading' : 'idle'}
                                                className="flex-[2]"
                                            >
                                                Converter
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
