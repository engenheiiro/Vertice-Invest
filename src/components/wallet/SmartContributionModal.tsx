import React, { useState, useEffect } from 'react';
import { X, Calculator, ArrowRight, Target, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useWallet, AssetType } from '../../contexts/WalletContext';

interface SmartContributionModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const LABELS: Record<string, string> = {
    STOCK: 'Ações BR',
    FII: 'FIIs',
    STOCK_US: 'Exterior',
    CRYPTO: 'Cripto',
    FIXED_INCOME: 'Renda Fixa',
    CASH: 'Reserva'
};

export const SmartContributionModal: React.FC<SmartContributionModalProps> = ({ isOpen, onClose }) => {
    const { assets, kpis, targetAllocation, targetReserve } = useWallet();
    const [amount, setAmount] = useState('');
    const [prioritizeReserve, setPrioritizeReserve] = useState(true);
    const [suggestions, setSuggestions] = useState<{ type: AssetType, amount: number, percentage: number }[]>([]);

    useEffect(() => {
        if (isOpen) {
            calculateDistribution();
        }
    }, [amount, prioritizeReserve, isOpen]);

    const calculateDistribution = () => {
        const contribution = parseFloat(amount);
        if (!contribution || contribution <= 0) {
            setSuggestions([]);
            return;
        }

        let remainingContribution = contribution;
        const newSuggestions: { type: AssetType, amount: number, percentage: number }[] = [];

        // 1. Valores Atuais
        const currentValues: Record<string, number> = { STOCK: 0, FII: 0, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, CASH: 0 };
        assets.forEach(asset => {
            const val = asset.quantity * asset.currentPrice * (asset.currency === 'USD' ? 5 : 1);
            currentValues[asset.type] = (currentValues[asset.type] || 0) + val;
        });

        // 2. Lógica de Reserva (Prioritária)
        const currentReserve = currentValues['CASH'];
        const reserveGap = targetReserve - currentReserve;

        if (prioritizeReserve && reserveGap > 0) {
            const amountToReserve = Math.min(reserveGap, remainingContribution);
            if (amountToReserve > 0) {
                newSuggestions.push({ type: 'CASH', amount: amountToReserve, percentage: 0 });
                remainingContribution -= amountToReserve;
            }
        }

        // Se sobrou dinheiro, distribuir no portfólio de risco
        if (remainingContribution > 0) {
            const riskAssets = ['STOCK', 'FII', 'STOCK_US', 'FIXED_INCOME', 'CRYPTO'] as AssetType[];
            const currentRiskEquity = riskAssets.reduce((acc, type) => acc + currentValues[type], 0);
            const projectedRiskEquity = currentRiskEquity + remainingContribution;

            const gaps: { type: AssetType, gap: number }[] = [];
            riskAssets.forEach(type => {
                const targetPct = targetAllocation[type] || 0;
                const idealValue = projectedRiskEquity * (targetPct / 100);
                const gap = idealValue - currentValues[type];
                gaps.push({ type, gap });
            });

            gaps.sort((a, b) => b.gap - a.gap);

            const totalPositiveGap = gaps.reduce((acc, item) => item.gap > 0 ? acc + item.gap : acc, 0);

            if (totalPositiveGap > 0) {
                gaps.forEach(item => {
                    if (item.gap > 0) {
                        const shareOfContribution = (item.gap / totalPositiveGap) * remainingContribution;
                        newSuggestions.push({ type: item.type, amount: shareOfContribution, percentage: 0 });
                    }
                });
            } else {
                riskAssets.forEach(type => {
                    const targetPct = targetAllocation[type] || 0;
                    const val = remainingContribution * (targetPct / 100);
                    if (val > 0) newSuggestions.push({ type, amount: val, percentage: 0 });
                });
            }
        }

        const finalSuggestions = newSuggestions.map(s => ({
            ...s,
            percentage: (s.amount / contribution) * 100
        })).sort((a, b) => b.amount - a.amount);

        setSuggestions(finalSuggestions);
    };

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    if (!isOpen) return null;

    return (
        // Wrapper externo CRÍTICO: fixed inset-0 garante cobertura da tela. h-screen força altura da viewport.
        // flex items-center justify-center garante centralização vertical/horizontal.
        <div className="fixed inset-0 z-[100] h-screen w-screen flex items-center justify-center overflow-hidden">
            
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            {/* Modal Container */}
            <div className="relative z-10 w-full max-w-md bg-[#080C14] border border-slate-800 rounded-2xl shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-[#0B101A] rounded-t-2xl shrink-0">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Calculator size={18} className="text-[#D4AF37]" />
                        <span className="bg-gradient-to-r from-[#D4AF37] to-[#F2D06B] bg-clip-text text-transparent">
                            Aporte Inteligente
                        </span>
                    </h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Conteúdo com scroll interno se necessário */}
                <div className="p-6 overflow-y-auto custom-scrollbar">
                    
                    {/* Input Area */}
                    <div className="mb-6 space-y-4">
                        <Input 
                            label="Valor do Aporte (R$)"
                            type="number"
                            placeholder="0,00"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            autoFocus
                        />

                        <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900/30 cursor-pointer hover:border-slate-700 transition-colors select-none">
                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${prioritizeReserve ? 'bg-[#D4AF37] border-[#D4AF37]' : 'border-slate-600'}`}>
                                {prioritizeReserve && <CheckCircle2 size={14} className="text-black" />}
                            </div>
                            <input 
                                type="checkbox" 
                                checked={prioritizeReserve}
                                onChange={(e) => setPrioritizeReserve(e.target.checked)}
                                className="hidden"
                            />
                            <div className="flex-1">
                                <span className="text-sm font-bold text-slate-200 block">Completar Reserva Primeiro?</span>
                                <span className="text-[10px] text-slate-500 block">
                                    Se ativado, o aporte focará em atingir a meta de {formatCurrency(targetReserve)} antes de investir.
                                </span>
                            </div>
                        </label>
                    </div>

                    {/* Suggestions Area */}
                    {amount && parseFloat(amount) > 0 ? (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sugestão de Alocação</h4>
                                <span className="text-xs font-bold text-black bg-[#D4AF37] px-2 py-0.5 rounded shadow-sm">Total: {formatCurrency(parseFloat(amount))}</span>
                            </div>

                            {suggestions.map((item) => (
                                <div key={item.type} className="flex items-center justify-between p-3 rounded-xl bg-[#0B101A] border border-slate-800 animate-fade-in">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg bg-slate-800/50 border border-slate-700 ${item.type === 'CASH' ? 'text-[#D4AF37]' : 'text-blue-400'}`}>
                                            {item.type === 'CASH' ? <Target size={16} /> : <Target size={16} />}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-white">{LABELS[item.type]}</p>
                                            <p className="text-[10px] text-slate-500">{item.percentage.toFixed(1)}% do aporte</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-emerald-400 flex items-center gap-1 justify-end">
                                            + {formatCurrency(item.amount)}
                                        </p>
                                    </div>
                                </div>
                            ))}

                            {suggestions.length === 0 && (
                                <p className="text-center text-xs text-slate-500 py-4">Não há sugestões para este valor.</p>
                            )}
                        </div>
                    ) : (
                        <div className="text-center py-6 opacity-50">
                            <Target size={32} className="mx-auto mb-3 text-slate-600" />
                            <p className="text-sm text-slate-500">Insira um valor para ver a mágica acontecer.</p>
                        </div>
                    )}

                </div>
                
                <div className="p-5 border-t border-slate-800 bg-[#0B101A] flex justify-end rounded-b-2xl shrink-0">
                    <Button onClick={onClose} variant="outline" className="w-auto px-6">
                        Fechar
                    </Button>
                </div>
            </div>
        </div>
    );
};