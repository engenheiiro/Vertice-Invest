
import React, { useMemo, useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend } from 'recharts';
import { BarChart3 } from 'lucide-react';

export const EvolutionChart = () => {
    const { kpis, history, isPrivacyMode } = useWallet();
    const [timeRange, setTimeRange] = useState<'ALL' | '12M' | 'YTD'>('ALL');

    const formatCurrency = (val: number) => {
        if (isPrivacyMode) return '••••••';
        if (val >= 1000000) return `R$ ${(val/1000000).toFixed(1)}M`;
        if (val >= 1000) return `R$ ${(val/1000).toFixed(0)}k`;
        return `R$ ${val.toFixed(0)}`;
    };

    const formatTooltipCurrency = (val: number) => {
        if (isPrivacyMode) return 'R$ ••••••';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const chartData = useMemo(() => {
        if (!history || history.length === 0) return [];

        const rawDates = history.map(h => new Date(h.date).getTime());
        const minDate = new Date(Math.min(...rawDates));
        const maxDate = new Date(); 

        minDate.setDate(1);
        minDate.setHours(0,0,0,0);
        
        const historyMap = new Map();
        history.forEach(point => {
            const d = new Date(point.date);
            const key = `${d.getFullYear()}-${d.getMonth()}`; 
            historyMap.set(key, {
                invested: point.totalInvested || 0,
                equity: point.totalEquity || 0
            });
        });

        const filledData = [];
        let cursor = new Date(minDate);
        
        let lastInvested = 0;
        let lastEquity = 0;

        while (cursor <= maxDate) {
            const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
            const monthLabel = cursor.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' }); 
            
            const existingData = historyMap.get(key);

            if (existingData) {
                lastInvested = existingData.invested;
                lastEquity = existingData.equity;
            }

            const profit = lastEquity - lastInvested;
            const stackBase = Math.min(lastEquity, lastInvested); 
            const stackProfit = Math.max(0, profit);

            if (lastEquity > 0 || lastInvested > 0) {
                filledData.push({
                    label: monthLabel,
                    sortDate: new Date(cursor),
                    baseBar: stackBase,
                    profitBar: stackProfit,
                    realInvested: lastInvested,
                    realEquity: lastEquity,
                    realProfit: profit
                });
            }

            cursor.setMonth(cursor.getMonth() + 1);
        }

        const currentKey = `${new Date().getFullYear()}-${new Date().getMonth()}`;
        if (!historyMap.has(currentKey) && kpis.totalEquity > 0) {
             const profit = kpis.totalEquity - kpis.totalInvested;
             const stackBase = Math.min(kpis.totalEquity, kpis.totalInvested);
             const stackProfit = Math.max(0, profit);

             if (filledData.length > 0 && filledData[filledData.length - 1].label === new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' })) {
                 filledData.pop();
             }

             filledData.push({
                label: new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' }),
                sortDate: new Date(),
                baseBar: stackBase,
                profitBar: stackProfit,
                realInvested: kpis.totalInvested,
                realEquity: kpis.totalEquity,
                realProfit: kpis.totalResult
            });
        }

        let finalData = filledData;
        const now = new Date();

        if (timeRange === '12M') {
            finalData = filledData.slice(-12);
        } else if (timeRange === 'YTD') {
            finalData = filledData.filter(d => d.sortDate.getFullYear() === now.getFullYear());
        }

        return finalData;
    }, [history, kpis, timeRange]);

    const barSize = chartData.length > 24 ? 12 : (chartData.length > 12 ? 20 : 35);

    if (kpis.totalEquity === 0 && chartData.length === 0) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[420px] flex flex-col items-center justify-center text-center relative overflow-hidden group">
                <BarChart3 className="text-slate-700 mb-4" size={48} />
                <h3 className="text-slate-300 font-bold text-sm">Sem dados históricos</h3>
                <p className="text-slate-600 text-xs">O gráfico será gerado após o primeiro aporte.</p>
            </div>
        );
    }

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[420px] flex flex-col relative overflow-hidden shadow-sm hover:border-slate-700 transition-colors">
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 z-10 relative">
                <div>
                    <h3 className="text-base font-bold text-white">Evolução do Patrimônio</h3>
                    <div className="flex items-center gap-3 mt-1">
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-700"></span>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Valor Aplicado</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Resultado</p>
                        </div>
                    </div>
                </div>
                
                <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                    {(['12M', 'YTD', 'ALL'] as const).map((t) => (
                        <button
                            key={t}
                            onClick={() => setTimeRange(t)}
                            className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                timeRange === t 
                                ? 'bg-slate-700 text-white shadow-sm' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {t === 'ALL' ? 'Desde o início' : t}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 w-full relative min-h-0 text-xs">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barGap={0}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        
                        <XAxis 
                            dataKey="label" 
                            tick={{fill: '#64748b', fontSize: 10, fontWeight: 500}} 
                            axisLine={false} 
                            tickLine={false}
                            minTickGap={20}
                            dy={10}
                        />
                        
                        <YAxis 
                            tickFormatter={formatCurrency}
                            tick={{fill: '#64748b', fontSize: 10}}
                            axisLine={false}
                            tickLine={false}
                        />
                        
                        <Tooltip 
                            cursor={{ fill: '#1e293b', opacity: 0.3 }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                        <div className="bg-[#0F1729] border border-slate-700 rounded-xl p-3 shadow-2xl z-50 min-w-[180px]">
                                            <p className="text-slate-400 text-[10px] font-bold uppercase mb-2 border-b border-slate-800 pb-1">{label}</p>
                                            
                                            <div className="space-y-1.5">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-emerald-600 font-bold">Aplicado</span>
                                                    <span className="text-slate-200 font-mono">{formatTooltipCurrency(data.realInvested)}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-emerald-400 font-bold">Resultado</span>
                                                    <span className={`font-mono font-bold ${data.realProfit >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
                                                        {data.realProfit >= 0 ? '+' : ''}{formatTooltipCurrency(data.realProfit)}
                                                    </span>
                                                </div>
                                                <div className="border-t border-slate-800 pt-1.5 mt-1 flex justify-between items-center">
                                                    <span className="text-white font-bold text-xs uppercase">Saldo Final</span>
                                                    <span className="text-white font-bold font-mono text-sm">{formatTooltipCurrency(data.realEquity)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        
                        <Bar 
                            dataKey="baseBar" 
                            stackId="a" 
                            fill="#047857" // Emerald 700
                            radius={[0, 0, 4, 4]} 
                            maxBarSize={50}
                            barSize={barSize}
                            animationDuration={1000}
                        />
                        
                        <Bar 
                            dataKey="profitBar" 
                            stackId="a" 
                            fill="#34D399" // Emerald 400
                            radius={[4, 4, 0, 0]} 
                            maxBarSize={50}
                            barSize={barSize}
                            animationDuration={1000}
                        />
                        
                        <ReferenceLine y={0} stroke="#334155" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
