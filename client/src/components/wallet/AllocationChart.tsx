
import React, { useState, useMemo } from 'react';
import { useWallet, AssetType, AllocationMap } from '../../contexts/WalletContext';
import { Settings, Check, X, DollarSign } from 'lucide-react';
import { Button } from '../ui/Button';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

// Cores
const COLORS: Record<AssetType, string> = {
    STOCK: '#3B82F6',       // Blue
    FII: '#10B981',         // Emerald
    STOCK_US: '#06B6D4',    // Cyan
    CRYPTO: '#E879F9',      // Fuchsia
    FIXED_INCOME: '#F59E0B',// Amber
    CASH: '#64748B'         // Slate
};

const LABELS: Record<AssetType, string> = {
    STOCK: 'Ações BR',
    FII: 'FIIs',
    STOCK_US: 'Exterior',
    CRYPTO: 'Cripto',
    FIXED_INCOME: 'Renda Fixa',
    CASH: 'Reserva'
};

const ORDERED_TYPES: AssetType[] = ['STOCK', 'FII', 'STOCK_US', 'FIXED_INCOME', 'CRYPTO', 'CASH'];

export const AllocationChart = () => {
    const { assets, kpis, targetAllocation, targetReserve, updateTargets } = useWallet();
    const [viewMode, setViewMode] = useState<'CURRENT' | 'IDEAL'>('CURRENT');
    const [isEditing, setIsEditing] = useState(false);
    
    const [tempTargets, setTempTargets] = useState<AllocationMap>(targetAllocation);
    const [tempReserve, setTempReserve] = useState<string>(targetReserve.toString());

    // 1. Calcular Valores Atuais
    const currentValues = useMemo(() => {
        const vals: Record<string, number> = { STOCK: 0, FII: 0, STOCK_US: 0, CRYPTO: 0, FIXED_INCOME: 0, CASH: 0 };
        assets.forEach(asset => {
            vals[asset.type] = (vals[asset.type] || 0) + asset.totalValue;
        });
        return vals;
    }, [assets]);

    const reserveValue = currentValues['CASH'];
    const investmentTotal = kpis.totalEquity - reserveValue;
    const safeInvestmentTotal = investmentTotal > 0 ? investmentTotal : 1;

    // 2. Preparar Dados para Recharts
    const chartData = useMemo(() => {
        const data = [];
        
        ORDERED_TYPES.forEach(type => {
            // Ignora CASH no gráfico de pizza se for visão de investimento (padrão)
            // Mas se quiser mostrar caixa, teria que mudar a base 100%. 
            // Seguindo lógica anterior: Gráfico mostra distribuição dos investimentos.
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
        const num = parseFloat(val) || 0;
        setTempTargets(prev => ({ ...prev, [type]: num }));
    };

    const saveTargets = () => {
        const sumPercents = Object.entries(tempTargets).reduce((acc, [key, val]) => {
            if (key === 'CASH') return acc;
            return acc + ((val as number) || 0);
        }, 0);

        if (Math.abs(sumPercents - 100) > 0.5) {
            alert(`A soma das alocações deve ser 100%. Atual: ${sumPercents.toFixed(1)}%`);
            return;
        }

        updateTargets(tempTargets, parseFloat(tempReserve) || 0);
        setIsEditing(false);
        setViewMode('IDEAL');
    };

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(val);

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[420px] flex flex-col relative overflow-hidden">
            
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
                    <button onClick={() => { setTempTargets(targetAllocation); setTempReserve(targetReserve.toString()); setIsEditing(true); }} className="p-1.5 text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-slate-800 border border-transparent hover:border-slate-700">
                        <Settings size={14} />
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex items-center gap-2 h-full min-h-0">
                
                {/* Chart Container - Tamanho Reduzido e Fixo */}
                <div className="relative w-[140px] h-[140px] shrink-0">
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
                                contentStyle={{ backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '10px' }}
                                itemStyle={{ color: '#fff' }}
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

                        return (
                            <div key={type} className="flex justify-between items-center text-xs py-1.5 border-b border-slate-800/30 last:border-0 hover:bg-slate-900/30 px-1 rounded transition-colors">
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[type] }}></div>
                                    <span className={`font-medium truncate ${isCash ? 'text-slate-200 font-bold' : 'text-slate-400'}`}>{LABELS[type]}</span>
                                </div>
                                <div className="text-right shrink-0 ml-2">
                                    <span className="font-bold text-white block leading-none">{displayValue}</span>
                                    {divergenceNode}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Modal de Edição (Overlay Absoluto) */}
            {isEditing && (
                <div className="absolute inset-0 bg-[#080C14] z-20 flex flex-col p-6 animate-fade-in rounded-2xl">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="text-sm font-bold text-white">Configurar Carteira Ideal</h4>
                        <button onClick={() => setIsEditing(false)}><X size={16} className="text-slate-500" /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-1">
                        <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800">
                            <h5 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1"><DollarSign size={10} /> Reserva (Valor Fixo)</h5>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-slate-300 w-24">Reserva</span>
                                <div className="flex-1 relative">
                                    <span className="absolute left-3 top-1.5 text-xs text-slate-500">R$</span>
                                    <input type="number" value={tempReserve} onChange={(e) => setTempReserve(e.target.value)} className="w-full bg-[#0B101A] border border-slate-800 rounded px-3 pl-8 py-1.5 text-xs text-white focus:border-blue-500 outline-none font-mono"/>
                                </div>
                            </div>
                        </div>
                        <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800">
                             <h5 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">% Investimentos (Soma 100%)</h5>
                            <div className="space-y-2">
                                {ORDERED_TYPES.filter(t => t !== 'CASH').map((type) => (
                                    <div key={type} className="flex items-center gap-3">
                                        <span className="text-xs text-slate-300 w-24 truncate">{LABELS[type]}</span>
                                        <div className="flex-1 relative">
                                            <input type="number" value={tempTargets[type] || 0} onChange={(e) => handleTargetChange(type, e.target.value)} className="w-full bg-[#0B101A] border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:border-blue-500 outline-none"/>
                                            <span className="absolute right-3 top-1.5 text-xs text-slate-600">%</span>
                                        </div>
                                    </div>
                                ))}
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
};
