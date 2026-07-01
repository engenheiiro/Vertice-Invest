import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, Info, TrendingUp, TrendingDown, Copy, Check, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '../ui/Button';
import { walletService } from '../../services/wallet';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency, formatQuantity } from '../../utils/format';
import { getErrorMessage } from '../../utils/errorMessages';

interface RebalanceModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type RiskProfile = 'DEFENSIVE' | 'MODERATE' | 'BOLD';

interface ClassGap {
    class: string;
    label: string;
    currentValue: number;
    idealValue: number;
    currentPct: number;
    targetPct: number;
    gapValue: number;
    coverage: 'full' | 'allocation-only';
}
interface SubLine { sub: string; label: string; amount: number; }
interface Trade {
    ticker: string | null;
    label?: string;
    class: string;
    type: string;
    kind?: 'REINFORCE' | 'NEW' | 'GENERIC';
    tier?: string | null;
    subLabel?: string | null;
    subBreakdown?: SubLine[] | null;
    amount: number;
    quantity: number | null;
    positionValue?: number;
    isFullExit?: boolean;
    score?: number | null;
    action?: string | null;
    estTax?: number;
    reasons: string[];
}
interface RebalancePlan {
    riskProfile: RiskProfile;
    dataAsOf: string | null;
    totalEquity: number;
    classGaps: ClassGap[];
    sells: Trade[];
    buys: Trade[];
    coveredClasses: string[];
    summary: { totalSell: number; totalBuy: number; estTaxTotal: number; tradeCount: number };
}

const PROFILES: { key: RiskProfile; label: string; color: string }[] = [
    { key: 'DEFENSIVE', label: 'Defensivo', color: 'blue' },
    { key: 'MODERATE', label: 'Moderado', color: 'blue' },
    { key: 'BOLD', label: 'Arrojado', color: 'purple' },
];

const PROFILE_LABEL: Record<RiskProfile, string> = {
    DEFENSIVE: 'Defensivo',
    MODERATE: 'Moderado',
    BOLD: 'Arrojado',
};

export const RebalanceModal: React.FC<RebalanceModalProps> = ({ isOpen, onClose }) => {
    const { addToast } = useToast();
    const [riskProfile, setRiskProfile] = useState<RiskProfile>('MODERATE');
    const [plan, setPlan] = useState<RebalancePlan | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    const fetchPlan = useCallback(async (profile: RiskProfile) => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await walletService.getRebalancePlan(profile);
            setPlan(data);
        } catch (e: unknown) {
            setError(getErrorMessage(e, 'Não foi possível gerar o plano.'));
            setPlan(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            fetchPlan(riskProfile);
        } else {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, riskProfile]);

    useEffect(() => {
        if (!isOpen) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const focusables = () =>
            panelRef.current
                ? Array.from(
                    panelRef.current.querySelectorAll<HTMLElement>(
                        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
                    )
                ).filter((el) => el.offsetParent !== null)
                : [];
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key !== 'Tab') return;
            const items = focusables();
            if (items.length === 0) return;
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        (focusables()[0] ?? panelRef.current)?.focus();
        document.addEventListener('keydown', onKeyDown);
        return () => { document.removeEventListener('keydown', onKeyDown); previouslyFocused?.focus?.(); };
    }, [isOpen, onClose]);

    const buildPlanText = (p: RebalancePlan): string => {
        const lines: string[] = [];
        lines.push(`PLANO DE REBALANCEAMENTO — Perfil ${PROFILE_LABEL[p.riskProfile]}`);
        lines.push(`Patrimônio: ${formatCurrency(p.totalEquity)}`);
        lines.push('');
        if (p.sells.length) {
            lines.push('VENDER / REDUZIR:');
            p.sells.forEach(s => {
                const qty = s.quantity ? ` (${formatQuantity(s.quantity)} un.)` : '';
                const tax = s.estTax ? ` | IR est. ${formatCurrency(s.estTax)}` : '';
                const sub = s.subLabel ? ` [${s.subLabel}]` : '';
                lines.push(`• ${s.ticker}${sub}${qty} — ${formatCurrency(s.amount)}${tax}`);
                lines.push(`  ${s.reasons.join(' · ')}`);
            });
            lines.push('');
        }
        if (p.buys.length) {
            lines.push('COMPRAR / REFORÇAR:');
            p.buys.forEach(b => {
                const label = b.ticker || b.label || b.class;
                const qty = b.quantity ? ` (${formatQuantity(b.quantity)} un.)` : '';
                const sub = b.ticker && b.subLabel ? ` [${b.subLabel}]` : '';
                lines.push(`• ${label}${sub}${qty} — ${formatCurrency(b.amount)}`);
                lines.push(`  ${b.reasons.join(' · ')}`);
                (b.subBreakdown || []).forEach(c => lines.push(`    → ${c.label}: ${formatCurrency(c.amount)}`));
            });
            lines.push('');
        }
        lines.push(`Resumo: vender ${formatCurrency(p.summary.totalSell)} · comprar ${formatCurrency(p.summary.totalBuy)} · IR estimado ${formatCurrency(p.summary.estTaxTotal)}`);
        lines.push('Simulação — execute as ordens na sua corretora. IR é estimativa.');
        return lines.join('\n');
    };

    const handleCopy = async () => {
        if (!plan) return;
        try {
            await navigator.clipboard.writeText(buildPlanText(plan));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            addToast('Plano copiado para a área de transferência.', 'success');
        } catch {
            addToast('Não foi possível copiar o plano.', 'error');
        }
    };

    if (!isOpen) return null;

    const isBalanced = plan && plan.sells.length === 0 && plan.buys.length === 0;
    const visibleGaps = (plan?.classGaps || []).filter(g => g.currentValue > 0 || g.targetPct > 0);

    return createPortal(
        <div className="relative z-[100]" role="dialog" aria-modal="true" aria-labelledby="rebalance-title">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 sm:p-0">
                    <div ref={panelRef} tabIndex={-1} className="relative transform overflow-hidden rounded-2xl bg-base border border-slate-800 text-left shadow-2xl transition-all w-full max-w-2xl animate-fade-in my-auto max-h-[92vh] flex flex-col outline-none">

                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-card shrink-0">
                            <div className="flex items-center gap-2">
                                <h2 id="rebalance-title" className="text-lg font-bold text-white flex items-center gap-2">
                                    <RefreshCw size={18} className="text-gold" />
                                    <span className="bg-gradient-to-r from-[#D4AF37] to-[#F2D06B] bg-clip-text text-transparent">
                                        Rebalanceamento IA
                                    </span>
                                </h2>
                                <div className="group relative flex items-center">
                                    <Info size={14} className="text-slate-500 cursor-help hover:text-gold transition-colors" />
                                    <div className="absolute left-1/2 -translate-x-1/2 top-6 w-72 p-3 bg-elevated border border-slate-700 rounded-xl shadow-2xl z-50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-left">
                                        <p className="text-[11px] text-slate-300 leading-relaxed">
                                            Cruza sua carteira com as metas por classe (<strong>Carteira {'>'} Distribuição {'>'} Ideal</strong>) e com o ranking quant do perfil escolhido. Sugere o que reduzir e o que reforçar. É uma simulação — você executa na corretora.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <button onClick={onClose} aria-label="Fechar" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Profile selector */}
                        <div className="px-5 pt-4 pb-2 shrink-0">
                            <div className="flex items-center gap-2">
                                {PROFILES.map(p => {
                                    const active = riskProfile === p.key;
                                    // Verde padrão do site nos botões de perfil (consistência com os chips do Exterior).
                                    const activeCls = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
                                    return (
                                        <button
                                            key={p.key}
                                            onClick={() => setRiskProfile(p.key)}
                                            className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${active ? activeCls : 'bg-slate-900/40 text-slate-500 border-slate-800 hover:border-slate-700'}`}
                                        >
                                            {p.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Body */}
                        <div className="px-5 py-3 overflow-y-auto">
                            {isLoading && (
                                <div className="py-16 flex flex-col items-center justify-center text-slate-500">
                                    <Loader2 size={28} className="animate-spin mb-3 text-gold" />
                                    <p className="text-sm">Analisando carteira vs. carteira-modelo {PROFILE_LABEL[riskProfile]}…</p>
                                </div>
                            )}

                            {!isLoading && error && (
                                <div className="py-12 text-center">
                                    <p className="text-sm text-red-400">{error}</p>
                                    <Button onClick={() => fetchPlan(riskProfile)} variant="outline" className="!w-auto px-5 mt-4 mx-auto">Tentar novamente</Button>
                                </div>
                            )}

                            {!isLoading && !error && plan && (
                                <div className="space-y-5">
                                    {/* Class gaps */}
                                    {visibleGaps.length > 0 && (
                                        <div>
                                            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Alocação por Classe</h4>
                                            <div className="space-y-2.5">
                                                {visibleGaps.map(g => {
                                                    const overweight = g.gapValue < 0;
                                                    const onTarget = Math.abs(g.gapValue) < plan.totalEquity * 0.01;
                                                    return (
                                                        <div key={g.class}>
                                                            <div className="flex items-center justify-between text-[11px] mb-1">
                                                                <span className="text-slate-300 font-semibold">{g.label}</span>
                                                                <span className="text-slate-500 font-mono">
                                                                    {g.currentPct.toFixed(0)}% → {g.targetPct.toFixed(0)}%
                                                                    {!onTarget && (
                                                                        <span className={`ml-2 font-bold ${overweight ? 'text-red-400' : 'text-emerald-400'}`}>
                                                                            {overweight ? '−' : '+'}{formatCurrency(Math.abs(g.gapValue))}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </div>
                                                            <div className="relative h-2 rounded-full bg-slate-800 overflow-hidden">
                                                                <div className="absolute inset-y-0 left-0 bg-slate-600 rounded-full" style={{ width: `${Math.min(100, g.currentPct)}%` }} />
                                                                <div className="absolute inset-y-0 w-0.5 bg-gold" style={{ left: `${Math.min(100, g.targetPct)}%` }} title="Meta" />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {isBalanced && (
                                        <div className="py-10 text-center">
                                            <ShieldCheck size={32} className="mx-auto mb-3 text-emerald-400" />
                                            <p className="text-sm text-slate-300 font-semibold">Carteira equilibrada para o perfil {PROFILE_LABEL[riskProfile]}.</p>
                                            <p className="text-xs text-slate-500 mt-1">Nenhum ajuste relevante sugerido no momento.</p>
                                        </div>
                                    )}

                                    {/* SELL */}
                                    {plan.sells.length > 0 && (
                                        <div>
                                            <h4 className="text-[11px] font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                <TrendingDown size={13} /> Reduzir / Vender
                                            </h4>
                                            <div className="space-y-2">
                                                {plan.sells.map((s, i) => (
                                                    <TradeCard key={`s-${i}`} trade={s} side="sell" />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* BUY */}
                                    {plan.buys.length > 0 && (
                                        <div>
                                            <h4 className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                <TrendingUp size={13} /> Comprar / Reforçar
                                            </h4>
                                            <div className="space-y-2">
                                                {plan.buys.map((b, i) => (
                                                    <TradeCard key={`b-${i}`} trade={b} side="buy" />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {plan.dataAsOf && (
                                        <p className="text-[10px] text-slate-600 flex items-center gap-1.5">
                                            <Sparkles size={11} /> Ranking quant de {new Date(plan.dataAsOf).toLocaleDateString('pt-BR')}.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-slate-800 bg-card shrink-0 rounded-b-2xl">
                            {plan && !isLoading && !error && (
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[11px]">
                                    <span className="text-slate-400">Vender <strong className="text-red-400">{formatCurrency(plan.summary.totalSell)}</strong></span>
                                    <span className="text-slate-400">Comprar <strong className="text-emerald-400">{formatCurrency(plan.summary.totalBuy)}</strong></span>
                                    <span className="text-slate-400">IR estimado <strong className="text-yellow-400">{formatCurrency(plan.summary.estTaxTotal)}</strong></span>
                                </div>
                            )}
                            <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
                                Simulação — não executa ordens. Realize as transações na sua corretora. O IR é uma estimativa e não substitui apuração fiscal.
                            </p>
                            <div className="flex justify-end gap-2">
                                <Button onClick={handleCopy} variant="outline" className="!w-auto px-4 gap-2" disabled={!plan || isLoading || !!error}>
                                    {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar plano'}
                                </Button>
                                <Button onClick={onClose} variant="outline" className="!w-auto px-6">Fechar</Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

// Card individual de uma ordem sugerida.
const TradeCard: React.FC<{ trade: Trade; side: 'buy' | 'sell' }> = ({ trade, side }) => {
    const isSell = side === 'sell';
    const accent = isSell ? 'text-red-400' : 'text-emerald-400';
    const label = trade.ticker || trade.label || trade.class;
    const kindBadge =
        trade.kind === 'NEW' ? { txt: 'Novo', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }
        : trade.kind === 'REINFORCE' ? { txt: 'Reforço', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' }
        : trade.kind === 'GENERIC' ? { txt: 'Aporte', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' }
        : null;

    return (
        <div className="p-3 rounded-xl bg-card border border-slate-800">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-white">{label}</span>
                    {/* Sub-tipo (ramificação) — só em itens com ticker (Exterior/RF) */}
                    {trade.ticker && trade.subLabel && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-indigo-500/15 text-indigo-300 border-indigo-500/30">{trade.subLabel}</span>
                    )}
                    {trade.tier && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-gold/10 text-gold border-gold/30">{trade.tier}</span>
                    )}
                    {kindBadge && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${kindBadge.cls}`}>{kindBadge.txt}</span>
                    )}
                    {isSell && trade.isFullExit && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-red-500/10 text-red-300 border-red-500/30">Zerar posição</span>
                    )}
                </div>
                <div className="text-right shrink-0">
                    <p className={`text-sm font-bold ${accent}`}>{isSell ? '−' : '+'}{formatCurrency(trade.amount)}</p>
                    {trade.quantity != null && (
                        <p className="text-[10px] text-slate-500">{formatQuantity(trade.quantity)} un.</p>
                    )}
                </div>
            </div>
            <ul className="mt-2 space-y-0.5 border-t border-slate-800/60 pt-2">
                {trade.reasons.map((r, i) => (
                    <li key={i} className="text-[10px] text-slate-400 leading-relaxed">• {r}</li>
                ))}
            </ul>
            {/* Quebra por sub-tipo (ramificação) — ex.: Renda Fixa por IPCA/Pós/Pré */}
            {trade.subBreakdown && trade.subBreakdown.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-800/60 space-y-1">
                    {trade.subBreakdown.map((c) => (
                        <div key={c.sub} className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-400 flex items-center gap-1.5"><span className="text-slate-600">→</span> {c.label}</span>
                            <span className="font-semibold text-emerald-400/90">{formatCurrency(c.amount)}</span>
                        </div>
                    ))}
                </div>
            )}
            {isSell && (trade.estTax ?? 0) > 0 && (
                <p className="text-[10px] text-yellow-400/90 mt-1.5 flex items-center gap-1">
                    ⚠ IR estimado: {formatCurrency(trade.estTax)}
                </p>
            )}
        </div>
    );
};
