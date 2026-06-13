import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Calculator, Info, Coins, ShieldCheck, Target, Zap, Plus, RotateCcw } from 'lucide-react';
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

export const ResearchAporteModal: React.FC<ResearchAporteModalProps> = ({ isOpen, onClose, ranking, assetClass }) => {
    const { usdRate } = useWallet();
    const isUsd = assetClass === 'CRYPTO' || assetClass === 'STOCK_US';
    const currency: 'BRL' | 'USD' = isUsd ? 'USD' : 'BRL';
    const isFractional = isUsd;

    const [amount, setAmount] = useState('');
    const [excludedTickers, setExcludedTickers] = useState<Set<string>>(new Set());

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

    // Reseta excluídos ao trocar perfil (lista diferente) ou ao fechar o modal.
    useEffect(() => { setExcludedTickers(new Set()); }, [profile]);
    useEffect(() => { if (!isOpen) setExcludedTickers(new Set()); }, [isOpen]);

    useEffect(() => {
        if (isOpen) { document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden'; }
        else { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; }
        return () => { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; };
    }, [isOpen]);

    const MAX_PER_SECTOR = 2;

    // Posição visual do ativo — espelha exatamente o TopPicksCard:
    // todos os ativos do perfil (BUY e WAIT), ordenados por score, top 10.
    const profilePositionMap = useMemo(() => {
        const sorted = ranking
            .filter(r => r.riskProfile === profile)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
        const map = new Map<string, number>();
        sorted.forEach((r, i) => map.set(r.ticker, i + 1));
        return map;
    }, [ranking, profile]);

    const { allocations, leftover, invested, sectorCount } = useMemo(() => {
        const value = parseFloat((amount || '').replace(',', '.'));
        if (!value || value <= 0) return { allocations: [] as Allocation[], leftover: 0, invested: 0, sectorCount: 0 };

        const sorted = ranking
            .filter(r => r.action === 'BUY' && (r.currentPrice || 0) > 0
                && (availableProfiles.length === 0 || r.riskProfile === profile)
                && !excludedTickers.has(r.ticker))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const ca = (a.metrics?.structural ? (a.metrics.structural.quality + a.metrics.structural.valuation + a.metrics.structural.risk) / 3 : 0);
                const cb = (b.metrics?.structural ? (b.metrics.structural.quality + b.metrics.structural.valuation + b.metrics.structural.risk) / 3 : 0);
                return cb - ca;
            });

        // Cap de MAX_PER_SECTOR ativos por setor para garantir diversificação.
        const perSector: Record<string, number> = {};
        const buys = sorted.filter(item => {
            const sec = (item.sector || 'GERAL').toUpperCase();
            perSector[sec] = (perSector[sec] || 0) + 1;
            return perSector[sec] <= MAX_PER_SECTOR;
        });

        if (buys.length === 0) return { allocations: [] as Allocation[], leftover: value, invested: 0, sectorCount: 0 };

        if (isFractional) {
            // Fracionável: distribuição proporcional pura por score.
            const totalScore = buys.reduce((acc, b) => acc + (b.score || 0), 0) || 1;
            const alloc: Allocation[] = buys.map(item => {
                const shares = Math.max(0, value * ((item.score || 0) / totalScore) / item.currentPrice);
                return { item, shares, cost: shares * item.currentPrice };
            });
            const investedTotal = alloc.reduce((acc, a) => acc + a.cost, 0);
            return {
                allocations: alloc.filter(a => a.shares > 0),
                leftover: Math.max(0, value - investedTotal),
                invested: investedTotal,
                sectorCount: new Set(buys.map(b => (b.sector || 'GERAL').toUpperCase())).size,
            };
        }

        // Fase 0: elegibilidade greedy — inclui em ordem de score, usando continue (não break)
        // para que um ativo caro no meio não bloqueie os mais baratos abaixo dele.
        let remainingBudget = value;
        const diverse: typeof buys = [];
        for (const item of buys) {
            if (item.currentPrice <= remainingBudget + 1e-9) {
                diverse.push(item);
                remainingBudget -= item.currentPrice;
            }
        }

        if (diverse.length === 0) {
            return { allocations: [] as Allocation[], leftover: value, invested: 0, sectorCount: 0 };
        }

        // Fase 1: distribuição proporcional por score com mínimo de 1 cota.
        const totalScore = diverse.reduce((acc, b) => acc + (b.score || 0), 0) || 1;
        const alloc: Allocation[] = diverse.map(item => {
            const targetShares = Math.max(1, Math.floor(value * (item.score || 0) / totalScore / item.currentPrice));
            return { item, shares: targetShares, cost: targetShares * item.currentPrice };
        });

        // Trim de segurança: se min-1 causou estouro (raro), reduz o de menor score primeiro.
        let totalAllocated = alloc.reduce((acc, a) => acc + a.cost, 0);
        let trimGuard = 0;
        while (totalAllocated > value + 1e-9 && trimGuard++ < 500) {
            let trimmed = false;
            for (let i = alloc.length - 1; i >= 0; i--) {
                if (alloc[i].shares > 1) {
                    alloc[i].shares -= 1;
                    alloc[i].cost -= alloc[i].item.currentPrice;
                    totalAllocated -= alloc[i].item.currentPrice;
                    trimmed = true;
                    break;
                }
            }
            if (!trimmed) break;
        }

        // Fase 2: distribui sobra pelo maior déficit proporcional — quem está mais abaixo
        // do seu peso alvo recebe a próxima cota (não apenas o de maior score).
        let leftoverCash = value - alloc.reduce((acc, a) => acc + a.cost, 0);
        let guard = 0;
        while (guard++ < 2000 && leftoverCash > 1e-9) {
            const affordable = alloc.filter(a => a.item.currentPrice <= leftoverCash + 1e-9);
            if (affordable.length === 0) break;
            const cand = affordable.reduce((best, a) => {
                const defA = value * (a.item.score || 0) / totalScore / a.item.currentPrice - a.shares;
                const defBest = value * (best.item.score || 0) / totalScore / best.item.currentPrice - best.shares;
                return defA > defBest ? a : best;
            });
            cand.shares += 1;
            cand.cost += cand.item.currentPrice;
            leftoverCash -= cand.item.currentPrice;
        }

        const investedTotal = alloc.reduce((acc, a) => acc + a.cost, 0);
        return {
            allocations: alloc.filter(a => a.shares > 0),
            leftover: Math.max(0, value - investedTotal),
            invested: investedTotal,
            sectorCount: new Set(diverse.map(b => (b.sector || 'GERAL').toUpperCase())).size,
        };
    }, [amount, ranking, profile, availableProfiles, isFractional, excludedTickers]);

    // Ativos excluídos com seus dados originais do ranking (para exibir os chips).
    const excludedItems = useMemo(() =>
        ranking.filter(r => excludedTickers.has(r.ticker) && r.riskProfile === profile),
        [ranking, excludedTickers, profile]
    );

    const removeExcluded = (ticker: string) =>
        setExcludedTickers(prev => { const s = new Set(prev); s.delete(ticker); return s; });

    const fmtShares = (n: number) => isFractional
        ? n.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
        : Math.round(n).toLocaleString('pt-BR');

    const amountNum = parseFloat((amount || '').replace(',', '.')) || 0;
    const unitLabel = isFractional ? 'unid.' : 'cotas';
    const hasExcluded = excludedTickers.size > 0;

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
                            <p className="text-[11px] text-slate-500 mb-4 flex items-center gap-2">
                                <Info size={14} className="text-slate-600 shrink-0" />
                                Ativos <strong className="text-emerald-400">COMPRAR</strong> distribuídos por score em {unitLabel}{isFractional ? ' (fracionável)' : ' inteiras'}. Clique para excluir.
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
                                            {hasExcluded
                                                ? 'Nenhum ativo disponível com o valor atual. Re-adicione ativos abaixo ou aumente o aporte.'
                                                : 'Nenhum ativo COMPRAR cabe nesse valor neste perfil. Aumente o aporte.'}
                                        </p>
                                    ) : (
                                        <>
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sugestão de compra</h4>
                                                <span className="text-[10px] font-bold text-slate-500">{allocations.length} ativos · {sectorCount} {sectorCount === 1 ? 'setor' : 'setores'}</span>
                                            </div>

                                            <div className="space-y-2">
                                                {allocations.map(({ item, shares, cost }, idx) => {
                                                    const rank = idx + 1;
                                                    const rankColor = rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-amber-600' : 'text-slate-600';
                                                    return (
                                                    <div
                                                        key={item.ticker}
                                                        className="group flex items-center justify-between p-3 rounded-xl bg-[#0B101A] border border-slate-800 hover:border-slate-700 transition-colors"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                {profilePositionMap.has(item.ticker) && (
                                                                    <span className={`text-[10px] font-black tabular-nums ${rankColor}`}>#{profilePositionMap.get(item.ticker)}</span>
                                                                )}
                                                                <span className="text-sm font-black text-white">{item.ticker}</span>
                                                                <span className="text-[9px] font-bold text-slate-500">Score {item.score}</span>
                                                            </div>
                                                            <p className="text-[10px] text-slate-500 truncate mt-0.5">
                                                                {fmtShares(shares)} {unitLabel} × {formatCurrency(item.currentPrice, currency)}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <div className="text-right">
                                                                <p className="text-sm font-bold text-emerald-400">{formatCurrency(cost, currency)}</p>
                                                                <p className="text-[9px] text-slate-600">{((cost / amountNum) * 100).toFixed(1)}%</p>
                                                            </div>
                                                            <button
                                                                onClick={() => setExcludedTickers(prev => new Set([...prev, item.ticker]))}
                                                                title="Remover do aporte"
                                                                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-all"
                                                            >
                                                                <X size={13} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    );
                                                })}
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

                                    {/* Chips de ativos excluídos — sempre visível quando há exclusões */}
                                    {hasExcluded && (
                                        <div className="mt-4 pt-3 border-t border-slate-800/60">
                                            <div className="flex items-center justify-between mb-2">
                                                <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">
                                                    Excluídos do aporte
                                                </p>
                                                <button
                                                    onClick={() => setExcludedTickers(new Set())}
                                                    className="flex items-center gap-1 text-[9px] font-bold text-slate-600 hover:text-slate-400 transition-colors"
                                                >
                                                    <RotateCcw size={9} /> Restaurar todos
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {[...excludedTickers].map(ticker => {
                                                    const meta = excludedItems.find(r => r.ticker === ticker);
                                                    return (
                                                        <button
                                                            key={ticker}
                                                            onClick={() => removeExcluded(ticker)}
                                                            title="Re-adicionar ao aporte"
                                                            className="flex items-center gap-1 px-2 py-1 bg-slate-800/50 rounded-lg text-[10px] font-bold text-slate-500 hover:text-emerald-400 hover:bg-emerald-400/10 hover:border-emerald-900/40 transition-all border border-slate-700/50"
                                                        >
                                                            <Plus size={9} />
                                                            {ticker}
                                                            {profilePositionMap.has(ticker) && (
                                                                <span className="text-slate-700">#{profilePositionMap.get(ticker)}</span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
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
