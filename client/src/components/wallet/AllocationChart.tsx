
import React, { useState, useMemo } from 'react';
import { useWallet, AssetType, AllocationMap, SubAllocationMap, DEFAULT_SUB_ALLOCATION } from '../../contexts/WalletContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Settings, Check, X, DollarSign, ChevronDown, ChevronRight, ShieldCheck, PlusCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCompact as fmtCompact } from '../../utils/format';
import { useToast } from '../../contexts/ToastContext';
import { computeSubAllocationReal, hasSubTargets } from '../../utils/allocation';

// Cores
const COLORS: Record<AssetType, string> = {
    STOCK: '#3B82F6',       // Blue
    FII: '#10B981',         // Emerald
    STOCK_US: '#06B6D4',    // Cyan
    ETF: '#14B8A6',         // Teal
    CRYPTO: '#E879F9',      // Fuchsia
    FIXED_INCOME: '#F59E0B',// Amber
    OURO: '#EAB308',        // Gold/Yellow (legado, não exibido)
    CASH: '#64748B'         // Slate
};

const LABELS: Record<AssetType, string> = {
    STOCK: 'Ações BR',
    FII: 'FIIs',
    STOCK_US: 'Exterior',
    ETF: 'ETFs',
    CRYPTO: 'Cripto',
    FIXED_INCOME: 'Renda Fixa',
    OURO: 'Ouro',
    CASH: 'Reserva'
};

// Ouro deixou de ser classe da Carteira Ideal (entra como ETF lastreado). ETF é classe
// própria só para fundos NACIONAIS; ETFs internacionais contam no Exterior (sub-tipo ETF).
const ORDERED_TYPES: AssetType[] = ['STOCK', 'FII', 'STOCK_US', 'ETF', 'FIXED_INCOME', 'CRYPTO', 'CASH'];

// Classes que admitem ramificação (sub-metas), com suas sub-chaves e rótulos.
const RAMIFIABLE: AssetType[] = ['FIXED_INCOME', 'STOCK_US'];
const SUB_KEYS: Record<string, string[]> = {
    FIXED_INCOME: ['IPCA', 'POS', 'PRE'],
    STOCK_US: ['STOCK', 'REIT', 'ETF', 'DOLLAR'],
};
const SUB_LABELS: Record<string, Record<string, string>> = {
    FIXED_INCOME: { IPCA: 'IPCA', POS: 'Pós-fixado', PRE: 'Prefixado' },
    STOCK_US: { STOCK: 'Stocks', REIT: 'REITs', ETF: 'ETFs', DOLLAR: 'Dólar' },
};

// Clona profundo a estrutura de sub-metas (evita mutação do estado do contexto).
const cloneSub = (s: SubAllocationMap): SubAllocationMap => ({
    FIXED_INCOME: { ...DEFAULT_SUB_ALLOCATION.FIXED_INCOME, ...s.FIXED_INCOME },
    STOCK_US: { ...DEFAULT_SUB_ALLOCATION.STOCK_US, ...s.STOCK_US },
});

interface AllocationChartProps {
    /** View inicial do toggle Atual/Ideal. 'IDEAL' é útil em carteira vazia,
     * quando o usuário quer definir a alocação-alvo antes de cadastrar ativos. */
    initialViewMode?: 'CURRENT' | 'IDEAL';
}

export const AllocationChart = React.memo(({ initialViewMode = 'CURRENT' }: AllocationChartProps) => {
    const { assets, kpis, targetAllocation, targetReserve, targetMonthlyDividendIncome, targetSubAllocation, updateTargets } = useWallet();
    const { addToast } = useToast();
    const { theme } = useTheme();
    const chartTooltipStyle = theme === 'light'
        ? { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', fontSize: '10px', color: '#0f172a' }
        : { backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '10px' };
    const [viewMode, setViewMode] = useState<'CURRENT' | 'IDEAL'>(initialViewMode);
    const [isEditing, setIsEditing] = useState(false);

    const [tempTargets, setTempTargets] = useState<AllocationMap>(targetAllocation);
    const [tempReserve, setTempReserve] = useState<string>(targetReserve.toString());
    const [tempDividendGoal, setTempDividendGoal] = useState<string>(targetMonthlyDividendIncome.toString());
    const [tempSub, setTempSub] = useState<SubAllocationMap>(cloneSub(targetSubAllocation));
    // Linhas ramificadas expandidas (no modo de edição e na legenda).
    const [expandedEdit, setExpandedEdit] = useState<Record<string, boolean>>({});
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

    // 1. Calcular Valores Atuais — bucketiza pela classe (type). ETF nacional é classe
    // própria; ETFs internacionais têm type STOCK_US e contam no Exterior.
    const currentValues = useMemo(() => {
        const vals: Record<string, number> = { STOCK: 0, FII: 0, STOCK_US: 0, ETF: 0, CRYPTO: 0, FIXED_INCOME: 0, OURO: 0, CASH: 0 };
        assets.forEach(asset => {
            vals[asset.type] = (vals[asset.type] || 0) + asset.totalValue;
        });
        return vals;
    }, [assets]);

    // Sub-alocação REAL (ramificação) — % dentro de cada classe.
    const subReal = useMemo(() => computeSubAllocationReal(assets), [assets]);

    const reserveValue = currentValues['CASH'];
    const investmentTotal = kpis.totalEquity - reserveValue;
    const safeInvestmentTotal = investmentTotal > 0 ? investmentTotal : 1;

    // 2. Preparar Dados para Recharts
    const chartData = useMemo(() => {
        const data: { name: string; type: AssetType; value: number; color: string }[] = [];

        ORDERED_TYPES.forEach(type => {
            // O gráfico mostra a distribuição dos investimentos (Caixa fora da base 100%).
            if (type === 'CASH') return;

            let value = 0;
            if (viewMode === 'CURRENT') {
                value = (currentValues[type] / safeInvestmentTotal) * 100;
            } else {
                value = targetAllocation[type] || 0;
            }

            if (value > 0) {
                data.push({
                    name: LABELS[type],
                    type: type,
                    value: value,
                    color: COLORS[type]
                });
            }
        });

        return data;
    }, [currentValues, safeInvestmentTotal, targetAllocation, viewMode]);

    // Handlers
    const handleTargetChange = (type: AssetType, val: string) => {
        const num = Math.max(0, Math.min(100, parseFloat(val) || 0));
        setTempTargets(prev => ({ ...prev, [type]: num }));
    };

    const handleSubChange = (parent: AssetType, key: string, val: string) => {
        const num = Math.max(0, Math.min(100, parseFloat(val) || 0));
        setTempSub(prev => ({
            ...prev,
            [parent]: { ...(prev as any)[parent], [key]: num },
        }));
    };

    const handleReserveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (raw === '' || raw === '-') return;
        const num = Math.max(0, parseFloat(raw) || 0);
        setTempReserve(String(num));
    };

    const handleDividendGoalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (raw === '' || raw === '-') return;
        const num = Math.max(0, parseFloat(raw) || 0);
        setTempDividendGoal(String(num));
    };

    const subSum = (parent: AssetType): number =>
        SUB_KEYS[parent].reduce((acc, k) => acc + (Number((tempSub as any)[parent]?.[k]) || 0), 0);

    const saveTargets = () => {
        const sumPercents = Object.entries(tempTargets).reduce((acc, [key, val]) => {
            if (key === 'CASH') return acc;
            return acc + ((val as number) || 0);
        }, 0);

        if (Math.abs(sumPercents - 100) > 0.5) {
            addToast(`A soma das alocações deve ser 100%. Atual: ${sumPercents.toFixed(1)}%`, 'error');
            return;
        }

        // Sub-metas: se a classe tiver qualquer valor > 0, precisa somar 100% DENTRO da classe.
        for (const parent of RAMIFIABLE) {
            const sum = subSum(parent);
            if (sum > 0 && Math.abs(sum - 100) > 0.5) {
                addToast(`As sub-metas de ${LABELS[parent]} devem somar 100%. Atual: ${sum.toFixed(1)}%`, 'error');
                return;
            }
        }

        updateTargets(tempTargets, parseFloat(tempReserve) || 0, tempSub, parseFloat(tempDividendGoal) || 0);
        setIsEditing(false);
        setViewMode('IDEAL');
    };

    const openEditor = () => {
        setTempTargets(targetAllocation);
        setTempReserve(targetReserve.toString());
        setTempDividendGoal(targetMonthlyDividendIncome.toString());
        setTempSub(cloneSub(targetSubAllocation));
        setExpandedEdit({});
        setIsEditing(true);
    };

    const formatCurrency = (val: number) => fmtCompact(val);

    // CASH/Reserva é excluída da distribuição de investimentos. Quando não há
    // investimentos (carteira 100% Reserva, ou vazia), o donut ficaria em branco —
    // então mostramos um empty-state dedicado no lugar do gráfico + legenda.
    const hasInvestments = chartData.length > 0;

    // Sub-linhas (drill-down) de uma classe ramificada na legenda.
    const renderSubRows = (type: AssetType) => {
        const keys = SUB_KEYS[type];
        const realPct = (subReal as any)[type]?.pct || {};
        const targetSub = (targetSubAllocation as any)[type] || {};
        const hasMeta = hasSubTargets(targetSub);

        // Sem sub-metas e sem posição real ramificada → nada a mostrar.
        const realTotal = (subReal as any)[type]?.total || 0;
        if (!hasMeta && realTotal <= 0) {
            return (
                <div className="pl-6 pr-1 py-1 text-[10px] text-slate-600 italic">Sem sub-metas definidas.</div>
            );
        }

        return keys.map((k) => {
            const rPct = Number(realPct[k]) || 0;
            const tPct = Number(targetSub[k]) || 0;
            if (viewMode === 'CURRENT' && rPct <= 0 && tPct <= 0) return null;
            if (viewMode === 'IDEAL' && tPct <= 0) return null;

            const valToShow = viewMode === 'CURRENT' ? rPct : tPct;
            const diff = rPct - tPct;
            const showDiff = viewMode === 'CURRENT' && hasMeta && Math.abs(diff) > 1;

            return (
                <div key={`${type}-${k}`} className="flex justify-between items-center text-[11px] py-1 pl-6 pr-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0 opacity-60" style={{ backgroundColor: COLORS[type] }}></div>
                        <span className="text-slate-500 truncate">{SUB_LABELS[type][k]}</span>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                        <span className="font-semibold text-slate-300 block leading-none">{valToShow.toFixed(0)}%</span>
                        {showDiff && (
                            <span className={`text-[9px] block leading-none ${diff > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {diff > 0 ? '+' : '-'}{Math.abs(diff).toFixed(0)}% vs meta
                            </span>
                        )}
                    </div>
                </div>
            );
        });
    };

    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-6 h-[420px] flex flex-col relative overflow-hidden">

            {/* Header */}
            <div className="flex justify-between items-start mb-2 shrink-0">
                <div>
                    <h3 className="text-base font-bold text-white">Distribuição</h3>
                    <p className="text-xs text-slate-500">Carteira de Investimentos</p>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                        <button onClick={() => setViewMode('CURRENT')} className={`text-[10px] font-bold px-3 py-1 rounded transition-colors ${viewMode === 'CURRENT' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Atual</button>
                        <button onClick={() => setViewMode('IDEAL')} className={`text-[10px] font-bold px-3 py-1 rounded transition-colors ${viewMode === 'IDEAL' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Ideal</button>
                    </div>
                    <button onClick={openEditor} aria-label="Configurar carteira ideal" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-slate-800 border border-transparent hover:border-slate-700">
                        <Settings size={14} />
                    </button>
                </div>
            </div>

            {/* Empty-state: sem investimentos para distribuir (só reserva, vazio, ou ideal não definida) */}
            {!hasInvestments ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-3 min-h-0">
                    {viewMode === 'IDEAL' ? (
                        <>
                            <div className="w-14 h-14 rounded-2xl bg-slate-800/50 flex items-center justify-center">
                                <Settings className="text-slate-500" size={24} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-300">Carteira ideal não definida</p>
                                <p className="text-xs text-slate-500 mt-1 max-w-[240px]">Toque na engrenagem acima para definir sua alocação-alvo.</p>
                            </div>
                        </>
                    ) : reserveValue > 0 ? (
                        <>
                            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                                <ShieldCheck className="text-emerald-400" size={26} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-300">Nada investido ainda</p>
                                <p className="text-xs text-slate-500 mt-1 max-w-[260px]">
                                    Sua reserva ({formatCurrency(reserveValue)}) está protegida. Adicione ativos para ver a distribuição.
                                </p>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="w-14 h-14 rounded-2xl bg-slate-800/50 flex items-center justify-center">
                                <PlusCircle className="text-slate-500" size={26} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-300">Sem ativos ainda</p>
                                <p className="text-xs text-slate-500 mt-1 max-w-[240px]">Cadastre seu primeiro ativo para ver a distribuição da carteira.</p>
                            </div>
                        </>
                    )}
                </div>
            ) : (
            /* Content Area */
            <div className="flex items-center gap-2 h-full min-h-0">

                {/* Chart Container - Tamanho Reduzido e Fixo */}
                {/* (A1) role=img + aria-label: leitores de tela leem um resumo no lugar do SVG */}
                <div
                    className="relative w-[140px] h-[140px] shrink-0"
                    role="img"
                    aria-label={`Gráfico de alocação da carteira: ${chartData.map((d) => `${d.name} ${Number(d.value).toFixed(0)}%`).join(', ')}`}
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={chartData}
                                cx="50%"
                                cy="50%"
                                innerRadius={40}
                                outerRadius={55}
                                paddingAngle={3}
                                dataKey="value"
                                stroke="none"
                            >
                                {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip
                                formatter={(value: number) => `${value.toFixed(1)}%`}
                                contentStyle={chartTooltipStyle}
                            />
                        </PieChart>
                    </ResponsiveContainer>

                    {/* Center Text */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-[9px] text-slate-500 uppercase font-bold">Invest.</span>
                        <span className="text-xs text-white font-mono font-bold">100%</span>
                    </div>
                </div>

                {/* Legend List - Scrollável e Flexível */}
                <div className="flex-1 h-full overflow-y-auto custom-scrollbar pr-2 flex flex-col justify-center">
                    {ORDERED_TYPES.map((type) => {
                        const isCash = type === 'CASH';
                        const isRamifiable = RAMIFIABLE.includes(type);
                        let displayValue = '';
                        let divergenceNode = null;

                        if (isCash) {
                            if (viewMode === 'CURRENT' && reserveValue <= 0) return null;

                            const currentR = reserveValue;
                            const targetR = targetReserve;

                            if (viewMode === 'IDEAL') {
                                displayValue = formatCurrency(targetR);
                            } else {
                                displayValue = formatCurrency(currentR);
                                const diff = currentR - targetR;
                                if (Math.abs(diff) > 100) {
                                     divergenceNode = <span className={`text-[9px] block leading-none ${diff > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{diff > 0 ? '+' : '-'}{formatCurrency(Math.abs(diff))}</span>;
                                }
                            }
                        } else {
                            const currentPct = (currentValues[type] / safeInvestmentTotal) * 100;
                            const targetPct = targetAllocation[type] || 0;

                            // Se modo atual e valor é 0, esconde (exceto se for editar ideal)
                            if (viewMode === 'CURRENT' && currentValues[type] <= 0) return null;

                            const valToShow = viewMode === 'CURRENT' ? currentPct : targetPct;
                            displayValue = `${valToShow.toFixed(1)}%`;

                            if (viewMode === 'CURRENT') {
                                const diff = currentPct - targetPct;
                                if (Math.abs(diff) > 1) {
                                    divergenceNode = <span className={`text-[9px] block leading-none ${diff > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{diff > 0 ? '+' : '-'}{Math.abs(diff).toFixed(0)}%</span>;
                                }
                            }
                        }

                        const isOpen = !!expandedRows[type];

                        return (
                            <div key={type}>
                                <div className="flex justify-between items-center text-xs py-1.5 border-b border-slate-800/30 hover:bg-slate-900/30 px-1 rounded transition-colors">
                                    <div className="flex items-center gap-2 min-w-0">
                                        {isRamifiable ? (
                                            <button
                                                onClick={() => setExpandedRows(prev => ({ ...prev, [type]: !prev[type] }))}
                                                className="text-slate-500 hover:text-white shrink-0"
                                                aria-label={isOpen ? `Recolher ${LABELS[type]}` : `Expandir ${LABELS[type]}`}
                                            >
                                                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                            </button>
                                        ) : (
                                            <span className="w-3 shrink-0" />
                                        )}
                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[type] }}></div>
                                        <span className={`font-medium truncate ${isCash ? 'text-slate-200 font-bold' : 'text-slate-400'}`}>{LABELS[type]}</span>
                                    </div>
                                    <div className="text-right shrink-0 ml-2">
                                        <span className="font-bold text-white block leading-none">{displayValue}</span>
                                        {divergenceNode}
                                    </div>
                                </div>
                                {isRamifiable && isOpen && (
                                    <div className="bg-slate-900/20 rounded-b">
                                        {renderSubRows(type)}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            )}

            {/* Modal de Edição (Overlay Absoluto) */}
            {isEditing && (
                <div className="absolute inset-0 bg-base z-20 flex flex-col p-6 animate-fade-in rounded-2xl">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="text-sm font-bold text-white">Configurar Carteira Ideal</h4>
                        <button onClick={() => setIsEditing(false)} aria-label="Fechar" className="min-h-[44px] min-w-[44px] flex items-center justify-center"><X size={16} className="text-slate-500" /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-1">
                        <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800">
                            <h5 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1"><DollarSign size={10} /> Reserva (Valor Fixo)</h5>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-slate-300 w-24">Reserva</span>
                                <div className="flex-1 relative">
                                    <span className="absolute left-3 top-1.5 text-xs text-slate-500">R$</span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={tempReserve}
                                        onChange={handleReserveChange}
                                        onWheel={(e) => e.currentTarget.blur()}
                                        className="w-full bg-card border border-slate-800 rounded px-3 pl-8 py-1.5 text-xs text-white focus:border-blue-500 outline-none font-mono"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800">
                            <h5 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1"><DollarSign size={10} /> Meta de Renda Passiva (Mensal)</h5>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-slate-300 w-24">Proventos</span>
                                <div className="flex-1 relative">
                                    <span className="absolute left-3 top-1.5 text-xs text-slate-500">R$</span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={tempDividendGoal}
                                        onChange={handleDividendGoalChange}
                                        onWheel={(e) => e.currentTarget.blur()}
                                        className="w-full bg-card border border-slate-800 rounded px-3 pl-8 py-1.5 text-xs text-white focus:border-blue-500 outline-none font-mono"
                                    />
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-600 mt-2">Acompanhe o progresso no Cofre de Dividendos da tela inicial.</p>
                        </div>
                        <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800">
                             <h5 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">% Investimentos (Soma 100%)</h5>
                            <div className="space-y-2">
                                {ORDERED_TYPES.filter(t => t !== 'CASH').map((type) => {
                                    const isRamifiable = RAMIFIABLE.includes(type);
                                    const isOpen = !!expandedEdit[type];
                                    const sSum = isRamifiable ? subSum(type) : 0;
                                    const subValid = sSum === 0 || Math.abs(sSum - 100) < 0.1;
                                    return (
                                        <div key={type}>
                                            <div className="flex items-center gap-3">
                                                {isRamifiable ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedEdit(prev => ({ ...prev, [type]: !prev[type] }))}
                                                        className="text-slate-500 hover:text-white shrink-0"
                                                        aria-label={isOpen ? `Recolher sub-metas de ${LABELS[type]}` : `Definir sub-metas de ${LABELS[type]}`}
                                                    >
                                                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    </button>
                                                ) : (
                                                    <span className="w-3.5 shrink-0" />
                                                )}
                                                <span className="text-xs text-slate-300 w-20 truncate">{LABELS[type]}</span>
                                                <div className="flex-1 relative">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="100"
                                                        value={tempTargets[type] || ''}
                                                        placeholder="0"
                                                        onChange={(e) => handleTargetChange(type, e.target.value)}
                                                        onWheel={(e) => e.currentTarget.blur()}
                                                        className="w-full bg-card border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:border-blue-500 outline-none"
                                                    />
                                                    <span className="absolute right-3 top-1.5 text-xs text-slate-600">%</span>
                                                </div>
                                            </div>
                                            {isRamifiable && isOpen && (
                                                <div className="mt-2 ml-7 pl-3 border-l border-slate-800 space-y-2">
                                                    <p className="text-[10px] text-slate-500">Dentro de {LABELS[type]} (soma 100%):</p>
                                                    {SUB_KEYS[type].map((k) => (
                                                        <div key={k} className="flex items-center gap-3">
                                                            <span className="text-[11px] text-slate-400 w-20 truncate">{SUB_LABELS[type][k]}</span>
                                                            <div className="flex-1 relative">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    max="100"
                                                                    value={(tempSub as any)[type]?.[k] || ''}
                                                                    placeholder="0"
                                                                    onChange={(e) => handleSubChange(type, k, e.target.value)}
                                                                    onWheel={(e) => e.currentTarget.blur()}
                                                                    className="w-full bg-card border border-slate-800 rounded px-3 py-1 text-[11px] text-white focus:border-blue-500 outline-none"
                                                                />
                                                                <span className="absolute right-3 top-1 text-[11px] text-slate-600">%</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <span className={`text-[10px] font-bold ${subValid ? 'text-emerald-500' : 'text-red-500'}`}>
                                                        Sub-total: {sSum.toFixed(0)}% {sSum === 0 ? '(sem sub-metas)' : ''}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between items-center">
                        {(() => {
                            const sum = Object.entries(tempTargets).reduce((acc, [k, v]) => k !== 'CASH' ? acc + ((v as number) || 0) : acc, 0);
                            const isValid = Math.abs(sum - 100) < 0.1;
                            return (<span className={`text-xs font-bold ${isValid ? 'text-emerald-500' : 'text-red-500'}`}>Total %: {sum.toFixed(1)}%</span>);
                        })()}
                        <Button className="w-auto py-1.5 px-4 text-xs" onClick={saveTargets}><Check size={14} className="mr-1" /> Salvar</Button>
                    </div>
                </div>
            )}
        </div>
    );
});
