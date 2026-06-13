import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Calculator, Info, Coins, ShieldCheck, Target, Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useWallet } from '../../contexts/WalletContext';
import { formatCurrency } from '../../utils/format';
import type { RankingItem } from '../../services/research';

interface ResearchAporteModalProps {
    isOpen: boolean;
    onClose: () => void;
    ranking: RankingItem[];
    assetClass: string;
}

type Profile = 'DEFENSIVE' | 'MODERATE' | 'BOLD';

const PROFILE_META: Record<Profile, { label: string; icon: React.ReactNode; activeClass: string }> = {
    DEFENSIVE: { label: 'Defensivo', icon: <ShieldCheck size={14} />, activeClass: 'bg-emerald-900/30 text-emerald-400 border-emerald-900/50' },
    MODERATE: { label: 'Moderado', icon: <Target size={14} />, activeClass: 'bg-blue-900/30 text-blue-400 border-blue-900/50' },
    BOLD: { label: 'Arrojado', icon: <Zap size={14} />, activeClass: 'bg-purple-900/30 text-purple-400 border-purple-900/50' },
};

interface Allocation {
    item: RankingItem;
    shares: number;
    cost: number;
}

/**
 * Aporte Inteligente por ativo (dentro do Research). Distribui um valor entre os
 * ativos COMPRAR de uma classe+perfil, ponderado por score, arredondando para
 * cotas inteiras (frações só em CRYPTO/STOCK_US) e mostrando a sobra de caixa.
 */
export const ResearchAporteModal: React.FC<ResearchAporteModalProps> = ({ isOpen, onClose, ranking, assetClass }) => {
    const { usdRate } = useWallet();
    const isUsd = assetClass === 'CRYPTO' || assetClass === 'STOCK_US';
    const currency: 'BRL' | 'USD' = isUsd ? 'USD' : 'BRL';
    const isFractional = isUsd;

    const [amount, setAmount] = useState('');

    // Perfis disponíveis entre os COMPRAR desta classe.
    const availableProfiles = useMemo(() => {
        const present = new Set<Profile>();
        ranking.forEach(r => {
            if (r.action === 'BUY' && r.riskProfile) present.add(r.riskProfile as Profile);
        });
        return (['DEFENSIVE', 'MODERATE', 'BOLD'] as Profile[]).filter(p => present.has(p));
    }, [ranking]);

    const [profile, setProfile] = useState<Profile>('DEFENSIVE');

    useEffect(() => {
        if (availableProfiles.length > 0 && !availableProfiles.includes(profile)) {
            setProfile(availableProfiles[0]);
        }
    }, [availableProfiles, profile]);

    useEffect(() => {
        if (isOpen) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = 'unset';
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    const { allocations, leftover, invested } = useMemo(() => {
        const value = parseFloat((amount || '').replace(',', '.'));
        if (!value || value <= 0) return { allocations: [] as Allocation[], leftover: 0, invested: 0 };

        const buys = ranking
            .filter(r => r.action === 'BUY' && (r.currentPrice || 0) > 0
                && (availableProfiles.length === 0 || r.riskProfile === profile))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const ca = (a.metrics?.structural ? (a.metrics.structural.quality + a.metrics.structural.valuation + a.metrics.structural.risk) / 3 : 0);
                const cb = (b.metrics?.structural ? (b.metrics.structural.quality + b.metrics.structural.valuation + b.metrics.structural.risk) / 3 : 0);
                return cb - ca;
            });

        if (buys.length === 0) return { allocations: [] as Allocation[], leftover: value, invested: 0 };

        const totalScore = buys.reduce((acc, b) => acc + (b.score || 0), 0) || 1;

        const alloc: Allocation[] = buys.map(item => {
            const target = value * ((item.score || 0) / totalScore);
            const price = item.currentPrice;
            const shares = isFractional
                ? Math.max(0, target / price)
                : Math.floor(target / price);
            return { item, shares, cost: shares * price };
        });

        // Distribui a sobra comprando +1 cota (whole-share) no maior score que couber.
        if (!isFractional) {
            let leftoverCash = value - alloc.reduce((acc, a) => acc + a.cost, 0);
            let guard = 0;
            while (guard++ < 2000) {
                const cand = alloc.find(a => a.item.currentPrice <= leftoverCash + 1e-9);
                if (!cand) break;
                cand.shares += 1;
                cand.cost += cand.item.currentPrice;
                leftoverCash -= cand.item.currentPrice;
            }
        }

        const investedTotal = alloc.reduce((acc, a) => acc + a.cost, 0);
        return {
            allocations: alloc.filter(a => a.shares > 0),
            leftover: Math.max(0, value - investedTotal),
            invested: investedTotal,
        };
    }, [amount, ranking, profile, availableProfiles, isFractional]);

    const fmtShares = (n: number) => isFractional
        ? n.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
        : Math.round(n).toLocaleString('pt-BR');

    const amountNum = parseFloat((amount || '').replace(',', '.')) || 0;
    const unitLabel = isFractional ? 'unid.' : 'cotas';

    if (!isOpen) return null;

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity" onClick={onClose}></div>
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 sm:p-0">
                    <div className="relative transform overflow-hidden rounded-2xl bg-[#0F131E] border border-slate-800 text-left shadow-2xl transition-all w-full max-w-lg animate-fade-in my-auto max-h-[90vh] flex flex-col">

                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-[#0B101A] shrink-0">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <Calculator size={18} className="text-blue-400" />
                                Aporte Inteligente
                            </h2>
                            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto">
                            <p className="text-[11px] text-slate-500 mb-4 flex items-start gap-2">
                                <Info size={14} className="text-slate-600 shrink-0 mt-0.5" />
                                Distribui o valor entre os ativos <strong className="text-emerald-400">COMPRAR</strong> deste perfil, ponderado pelo score, em {unitLabel} {isFractional ? '(fracionável)' : 'inteiras'}. A sobra fica como caixa.
                            </p>

                            {/* Seletor de perfil */}
                            {availableProfiles.length > 1 && (
                                <div className="flex gap-2 mb-4">
                                    {availableProfiles.map(p => {
                                        const meta = PROFILE_META[p];
                                        const active = p === profile;
                                        return (
                                            <button
                                                key={p}
                                                onClick={() => setProfile(p)}
                                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all border ${
                                                    active ? meta.activeClass : 'text-slate-500 border-slate-800 hover:text-slate-300'
                                                }`}
                                            >
                                                {meta.icon} {meta.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            <Input
                                label={`Valor do Aporte (${isUsd ? 'US$' : 'R$'})`}
                                type="number"
                                placeholder="0,00"
                                min="0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                autoFocus
                            />

                            {isUsd && usdRate > 0 && amountNum > 0 && (
                                <p className="text-[10px] text-slate-500 mt-1">≈ {formatCurrency(amountNum * usdRate, 'BRL')}</p>
                            )}

                            {/* Resultado */}
                            {amountNum > 0 && (
                                <div className="mt-5">
                                    {allocations.length === 0 ? (
                                        <p className="text-center text-xs text-slate-500 py-6">
                                            Nenhum ativo COMPRAR cabe nesse valor neste perfil. Aumente o aporte.
                                        </p>
                                    ) : (
                                        <>
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sugestão de compra</h4>
                                                <span className="text-[10px] font-bold text-slate-500">{allocations.length} ativos</span>
                                            </div>
                                            <div className="space-y-2">
                                                {allocations.map(({ item, shares, cost }) => (
                                                    <div key={item.ticker} className="flex items-center justify-between p-3 rounded-xl bg-[#0B101A] border border-slate-800">
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-black text-white">{item.ticker}</span>
                                                                <span className="text-[9px] font-bold text-slate-500">Score {item.score}</span>
                                                            </div>
                                                            <p className="text-[10px] text-slate-500 truncate">
                                                                {fmtShares(shares)} {unitLabel} × {formatCurrency(item.currentPrice, currency)}
                                                            </p>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className="text-sm font-bold text-emerald-400">{formatCurrency(cost, currency)}</p>
                                                            <p className="text-[9px] text-slate-600">{((cost / amountNum) * 100).toFixed(1)}%</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Totais */}
                                            <div className="mt-4 pt-3 border-t border-slate-800 space-y-1.5">
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-slate-400">Investido</span>
                                                    <span className="font-bold text-white">{formatCurrency(invested, currency)}</span>
                                                </div>
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-slate-400 flex items-center gap-1"><Coins size={12} /> Sobra (caixa)</span>
                                                    <span className="font-bold text-yellow-500">{formatCurrency(leftover, currency)}</span>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="p-5 border-t border-slate-800 bg-[#0B101A] flex justify-end rounded-b-2xl shrink-0">
                            <Button onClick={onClose} variant="outline" className="w-auto px-6">Fechar</Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
