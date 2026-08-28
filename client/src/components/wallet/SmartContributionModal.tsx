
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Calculator, Target, CheckCircle2, Info, Copy, Check, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useWallet, AssetType, StockSubKey, FixedIncomeSubKey, UsSubKey } from '../../contexts/WalletContext';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency as fmtCurrency } from '../../utils/format';
import { computeSubAllocationReal, splitContributionBySubMeta, hasSubTargets, SUB_LABELS, allocationBucket } from '../../utils/allocation';
import { researchTargetFor, amountForTarget } from '../../utils/researchAporte';
import type { ResearchTarget } from '../../utils/researchAporte';

interface SmartContributionModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface SubLine { sub: string; label: string; amount: number; }
interface Suggestion { type: AssetType; amount: number; percentage: number; children?: SubLine[]; }

const LABELS: Record<string, string> = {
    STOCK: 'Ações BR',
    FII: 'FIIs',
    STOCK_US: 'Exterior',
    ETF: 'ETFs',
    CRYPTO: 'Cripto',
    FIXED_INCOME: 'Renda Fixa',
    OURO: 'Ouro',
    CASH: 'Reserva'
};

const STOCK_KEYS: StockSubKey[] = ['STOCK', 'ETF'];
const FI_KEYS: FixedIncomeSubKey[] = ['IPCA', 'POS', 'PRE'];
const US_KEYS: UsSubKey[] = ['STOCK', 'REIT', 'ETF', 'DOLLAR'];

export const SmartContributionModal: React.FC<SmartContributionModalProps> = ({ isOpen, onClose }) => {
    const { assets, targetAllocation, targetReserve, targetSubAllocation, usdRate } = useWallet();
    const { addToast } = useToast();
    const navigate = useNavigate();
    const [amount, setAmount] = useState('');
    const [prioritizeReserve, setPrioritizeReserve] = useState(true);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [copied, setCopied] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            calculateDistribution();
        } else {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
            setCopied(false);
        }
        return () => { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; };
        // Redistribui quando muda o APORTE ou a preferência de reserva. A função é
        // recriada a cada render e escreve estado — como dependência, recalcularia
        // em loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [amount, prioritizeReserve, isOpen]);

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

    const calculateDistribution = () => {
        const contribution = parseFloat(amount);
        if (!contribution || contribution <= 0) {
            setSuggestions([]);
            return;
        }

        let remainingContribution = contribution;
        const newSuggestions: Suggestion[] = [];

        const currentValues: Record<string, number> = { STOCK: 0, FII: 0, STOCK_US: 0, ETF: 0, CRYPTO: 0, FIXED_INCOME: 0, OURO: 0, CASH: 0 };
        assets.forEach(asset => {
            const val = asset.quantity * asset.currentPrice * (asset.currency === 'USD' ? (usdRate || 5.75) : 1);
            // Bucketiza pelo BALDE DE ALOCAÇÃO (C1), coerente com o donut: ativos de
            // Reserva (CASH ou RF marcada) contam em CASH (reserva); RF não-reserva
            // fica em FIXED_INCOME (investimento). ETFs seguem sua exposição
            // econômica (allocationClass), sem inferir pela moeda de negociação.
            const cls = allocationBucket(asset);
            currentValues[cls] = (currentValues[cls] || 0) + val;
        });

        const currentReserve = currentValues['CASH'];
        const reserveGap = targetReserve - currentReserve;

        if (prioritizeReserve && reserveGap > 0) {
            const amountToReserve = Math.min(reserveGap, remainingContribution);
            if (amountToReserve > 0) {
                newSuggestions.push({ type: 'CASH', amount: amountToReserve, percentage: 0 });
                remainingContribution -= amountToReserve;
            }
        }

        if (remainingContribution > 0) {
            // ETF nacional foldado em Ações BR (STOCK) — fora da lista de classes de topo.
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

        // Ramificação: subdivide o aporte de RF/Exterior pelas sub-metas (linhas-filhas),
        // um nível abaixo da mesma lógica de gap. Reusa a sub-alocação REAL da carteira.
        const subReal = computeSubAllocationReal(assets);
        const childrenFor = (s: Suggestion): SubLine[] | undefined => {
            if (s.type === 'STOCK' && hasSubTargets(targetSubAllocation.STOCK)) {
                const split = splitContributionBySubMeta(s.amount, subReal.STOCK.value, targetSubAllocation.STOCK, STOCK_KEYS);
                return STOCK_KEYS.map(k => ({ sub: k, label: SUB_LABELS.STOCK[k], amount: split[k] })).filter(c => c.amount > 0.005);
            }
            if (s.type === 'FIXED_INCOME' && hasSubTargets(targetSubAllocation.FIXED_INCOME)) {
                const split = splitContributionBySubMeta(s.amount, subReal.FIXED_INCOME.value, targetSubAllocation.FIXED_INCOME, FI_KEYS);
                return FI_KEYS.map(k => ({ sub: k, label: SUB_LABELS.FIXED_INCOME[k], amount: split[k] })).filter(c => c.amount > 0.005);
            }
            if (s.type === 'STOCK_US' && hasSubTargets(targetSubAllocation.STOCK_US)) {
                const split = splitContributionBySubMeta(s.amount, subReal.STOCK_US.value, targetSubAllocation.STOCK_US, US_KEYS);
                return US_KEYS.map(k => ({ sub: k, label: SUB_LABELS.STOCK_US[k], amount: split[k] })).filter(c => c.amount > 0.005);
            }
            return undefined;
        };

        const finalSuggestions: Suggestion[] = newSuggestions.map(s => ({
            ...s,
            percentage: (s.amount / contribution) * 100,
            children: childrenFor(s),
        })).sort((a, b) => b.amount - a.amount);

        setSuggestions(finalSuggestions);
    };

    const formatCurrency = (val: number) => fmtCurrency(val);

    // ---------------------------------------------------------------------
    // Exportação para texto. Colunas alinhadas com padding (o Bloco de Notas
    // usa fonte monoespaçada por padrão) e quebra CRLF — destino declarado é
    // o Notepad, que só é garantido com \r\n em editores antigos do Windows.
    // ---------------------------------------------------------------------
    const buildPlanText = (): string => {
        const total = parseFloat(amount) || 0;
        const allocated = suggestions.reduce((acc, s) => acc + s.amount, 0);
        // Intl pt-BR separa símbolo e número com NBSP; vira espaço comum no txt.
        const money = (val: number) => fmtCurrency(val).replace(/\u00A0/g, ' ');
        const LABEL_W = 24;
        const VALUE_W = 15;
        const row = (label: string, value: string, tail = '') =>
            `${label.padEnd(LABEL_W)}${value.padStart(VALUE_W)}${tail}`;
        const pct = (val: number) =>
            `   ${(total > 0 ? (val / total) * 100 : 0).toFixed(1).replace('.', ',').padStart(5)}%`;

        const lines: string[] = [];
        lines.push('APORTE INTELIGENTE — Vértice');
        lines.push(`Data: ${new Date().toLocaleDateString('pt-BR')}`);
        lines.push(`Valor do aporte: ${money(total)}`);
        lines.push(`Reserva primeiro: ${prioritizeReserve ? `sim (meta ${money(targetReserve)})` : 'não'}`);
        lines.push('');
        lines.push('DISTRIBUIÇÃO SUGERIDA');
        lines.push('-'.repeat(LABEL_W + VALUE_W + 9));
        suggestions.forEach((s) => {
            lines.push(row(LABELS[s.type] || s.type, money(s.amount), pct(s.amount)));
            (s.children || []).forEach((c) => lines.push(row(`   -> ${c.label}`, money(c.amount))));
        });
        lines.push('-'.repeat(LABEL_W + VALUE_W + 9));
        lines.push(row('TOTAL', money(allocated), pct(allocated)));
        lines.push('');
        lines.push('Metas definidas em Carteira > Distribuição > Ideal.');
        lines.push('Simulação — não executa ordens. Confira antes de investir.');
        return lines.join('\r\n');
    };

    const handleCopy = async () => {
        if (suggestions.length === 0) return;
        try {
            await navigator.clipboard.writeText(buildPlanText());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            addToast('Aporte copiado para a área de transferência.', 'success');
        } catch {
            addToast('Não foi possível copiar o aporte.', 'error');
        }
    };

    /**
     * Leva para a aba do Research daquela linha, já com o valor da linha no
     * modal de Aporte de lá (convertido para a moeda da aba).
     */
    const openResearch = (target: ResearchTarget, lineAmount: number) => {
        const converted = Math.round(amountForTarget(lineAmount, target, usdRate) * 100) / 100;
        onClose();
        navigate('/research', {
            state: {
                aporte: {
                    assetClass: target.assetClass,
                    exteriorView: target.exteriorView,
                    etfOrigin: target.etfOrigin,
                    amount: target.hasRanking ? converted : undefined,
                    currency: target.currency,
                },
            },
        });
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="relative z-[100]" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            {/* Container Centralizado */}
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
                    
                    {/* Modal Panel */}
                    <div ref={panelRef} tabIndex={-1} className="relative transform overflow-hidden rounded-2xl bg-base border border-slate-800 text-left shadow-2xl transition-all w-full max-w-md animate-fade-in my-auto max-h-[90vh] flex flex-col outline-none">
                        
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-card shrink-0">
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Calculator size={18} className="text-gold" />
                                    <span className="bg-gradient-to-r from-[#D4AF37] to-[#F2D06B] bg-clip-text text-transparent">
                                        Aporte Inteligente
                                    </span>
                                </h2>
                                
                                {/* INFO TOOLTIP */}
                                <div className="group relative flex items-center">
                                    <Info size={14} className="text-slate-500 cursor-help hover:text-gold transition-colors" />
                                    <div className="absolute left-1/2 -translate-x-1/2 top-6 w-64 p-3 bg-elevated border border-slate-700 rounded-xl shadow-2xl z-50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-left">
                                        <p className="text-[11px] text-slate-300 leading-relaxed">
                                            O algoritmo calcula matematicamente onde alocar seu novo dinheiro para aproximar sua carteira atual das suas metas definidas em <strong>Carteira {'>'} Distribuição {'>'} Ideal</strong>.
                                        </p>
                                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-elevated border-t border-l border-slate-700 transform rotate-45"></div>
                                    </div>
                                </div>
                            </div>

                            <button onClick={onClose} aria-label="Fechar" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                            <div className="mb-6 space-y-4">
                                <Input
                                    label="Valor do Aporte (R$)"
                                    type="number"
                                    placeholder="0,00"
                                    min="0"
                                    value={amount}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === '' || parseFloat(val) >= 0) setAmount(val);
                                    }}
                                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                    autoFocus
                                />

                                <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900/30 cursor-pointer hover:border-slate-700 transition-colors select-none">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${prioritizeReserve ? 'bg-gold border-gold' : 'border-slate-600'}`}>
                                        {prioritizeReserve && <CheckCircle2 size={14} className="text-black" />}
                                    </div>
                                    <input 
                                        type="checkbox" checked={prioritizeReserve}
                                        onChange={(e) => setPrioritizeReserve(e.target.checked)}
                                        className="hidden"
                                    />
                                    <div className="flex-1">
                                        <span className="text-sm font-bold text-slate-200 block">Completar Reserva Primeiro?</span>
                                        <span className="text-[10px] text-slate-500 block">
                                            Meta: {formatCurrency(targetReserve)}
                                        </span>
                                    </div>
                                </label>
                            </div>

                            {amount && parseFloat(amount) > 0 ? (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sugestão de Alocação</h4>
                                        <span className="text-xs font-bold text-black bg-gold px-2 py-0.5 rounded shadow-sm">Total: {formatCurrency(parseFloat(amount))}</span>
                                    </div>

                                    {suggestions.map((item) => {
                                        const parentTarget = researchTargetFor(item.type);
                                        return (
                                        <div key={item.type} className="p-3 rounded-xl bg-card border border-slate-800 animate-fade-in">
                                            {/* Header da classe — clicável quando existe aba no Research */}
                                            <div
                                                role={parentTarget ? 'button' : undefined}
                                                tabIndex={parentTarget ? 0 : undefined}
                                                onClick={parentTarget ? () => openResearch(parentTarget, item.amount) : undefined}
                                                onKeyDown={parentTarget ? (e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openResearch(parentTarget, item.amount); }
                                                } : undefined}
                                                title={parentTarget ? `Ver ${parentTarget.label} no Research com este valor` : undefined}
                                                className={`group flex items-center justify-between rounded-lg ${parentTarget ? 'cursor-pointer -m-1 p-1 hover:bg-slate-800/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60' : ''}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2 rounded-lg bg-slate-800/50 border border-slate-700 ${item.type === 'CASH' ? 'text-gold' : 'text-blue-400'}`}>
                                                        <Target size={16} />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-white flex items-center gap-1">
                                                            {LABELS[item.type]}
                                                            {parentTarget && <ChevronRight size={13} className="text-slate-600 group-hover:text-blue-400 transition-colors" />}
                                                        </p>
                                                        <p className="text-[10px] text-slate-500">{item.percentage.toFixed(1)}% do aporte</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-bold text-emerald-400 flex items-center gap-1 justify-end">
                                                        + {formatCurrency(item.amount)}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Linhas-filhas: quanto vai em cada sub-tipo (ramificação) */}
                                            {item.children && item.children.length > 0 && (
                                                <div className="mt-2.5 pt-2.5 border-t border-slate-800/70 space-y-1 pl-1">
                                                    {item.children.map((c) => {
                                                        const childTarget = researchTargetFor(item.type, c.sub);
                                                        const Row = (
                                                            <>
                                                                <span className="text-slate-400 flex items-center gap-1.5">
                                                                    <span className="text-slate-600">→</span> {c.label}
                                                                    {childTarget && <ChevronRight size={11} className="text-slate-700 group-hover/sub:text-blue-400 transition-colors" />}
                                                                </span>
                                                                <span className="font-semibold text-emerald-400/90">+ {formatCurrency(c.amount)}</span>
                                                            </>
                                                        );
                                                        return childTarget ? (
                                                            <button
                                                                key={c.sub}
                                                                type="button"
                                                                onClick={() => openResearch(childTarget, c.amount)}
                                                                title={`Ver ${childTarget.label} no Research com este valor`}
                                                                className="group/sub w-full flex items-center justify-between text-[11px] rounded-lg px-1 py-0.5 -mx-1 hover:bg-slate-800/40 transition-colors"
                                                            >
                                                                {Row}
                                                            </button>
                                                        ) : (
                                                            <div key={c.sub} className="flex items-center justify-between text-[11px] px-1 py-0.5">
                                                                {Row}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                        );
                                    })}
                                    {suggestions.length === 0 && <p className="text-center text-xs text-slate-500 py-4">Sem sugestões. Sua carteira está equilibrada.</p>}

                                    {suggestions.length > 0 && (
                                        <p className="text-[10px] text-slate-600 leading-relaxed pt-1">
                                            Clique em uma linha para abrir o ranking daquela classe no Research já com o valor sugerido.
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center py-6 opacity-50">
                                    <Target size={32} className="mx-auto mb-3 text-slate-600" />
                                    <p className="text-sm text-slate-500">Insira um valor para ver a mágica acontecer.</p>
                                </div>
                            )}
                        </div>
                        
                        <div className="p-5 border-t border-slate-800 bg-card flex justify-end gap-2 rounded-b-2xl shrink-0">
                            <Button
                                onClick={handleCopy}
                                variant="outline"
                                className="!w-auto px-4 gap-2"
                                disabled={suggestions.length === 0}
                            >
                                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar aporte'}
                            </Button>
                            <Button onClick={onClose} variant="outline" className="!w-auto px-6">Fechar</Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
