
import React, { useMemo } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export const EvolutionChart = () => {
    const { kpis, history } = useWallet();

    const chartData = useMemo(() => {
        if (history && history.length > 0) {
            const mapped = history.map(h => {
                const dateObj = new Date(h.date);
                const isValidDate = !isNaN(dateObj.getTime());
                return {
                    date: isValidDate ? dateObj.getTime() : 0, 
                    dateLabel: isValidDate ? dateObj.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }) : 'N/A',
                    value: Number(h.totalEquity) || 0
                };
            }).filter(item => item.date > 0).sort((a,b) => a.date - b.date);

            // Garante ao menos 2 pontos para renderizar area
            if (mapped.length > 0) {
               // Adiciona ponto atual se for mais recente que o último histórico
               if (kpis.totalEquity > 0) {
                   mapped.push({
                        date: new Date().getTime(),
                        dateLabel: 'Atual',
                        value: kpis.totalEquity
                   });
               }
               return mapped;
            }
        }

        // Mock para Empty State
        if (kpis.totalEquity > 0) {
            const now = new Date();
            return [
                { date: now.setMonth(now.getMonth() - 1), dateLabel: 'Início', value: 0 },
                { date: new Date().getTime(), dateLabel: 'Atual', value: kpis.totalEquity }
            ];
        }

        return [];
    }, [history, kpis.totalEquity]);

    const formatYAxis = (val: number) => {
        if (val >= 1000000) return `${(val/1000000).toFixed(1)}M`;
        if (val >= 1000) return `${(val/1000).toFixed(0)}k`;
        return val.toString();
    };

    if (kpis.totalEquity === 0) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[380px] flex items-center justify-center">
                <p className="text-slate-500 text-sm">Adicione ativos para ver a evolução patrimonial.</p>
            </div>
        );
    }

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[380px] flex flex-col relative overflow-hidden shadow-sm hover:border-slate-700 transition-colors">
            <div className="flex justify-between items-start mb-2 z-10 pointer-events-none">
                <div>
                    <h3 className="text-base font-bold text-white">Evolução Patrimonial</h3>
                    <p className="text-xs text-slate-500">Histórico acumulado</p>
                </div>
                <div className="text-right">
                     <span className={`text-xs font-bold px-2 py-0.5 rounded border ${kpis.totalResult >= 0 ? 'text-emerald-500 bg-emerald-900/20 border-emerald-900/50' : 'text-red-500 bg-red-900/20 border-red-900/50'}`}>
                        {kpis.totalResult >= 0 ? '+' : ''}{kpis.totalResultPercent.toFixed(2)}% Total
                     </span>
                </div>
            </div>

            <div className="flex-1 w-full relative min-h-0 text-xs">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        
                        <XAxis 
                            dataKey="date" 
                            type="number"
                            domain={['dataMin', 'dataMax']}
                            tickFormatter={(unixTime) => new Date(unixTime).toLocaleDateString('pt-BR', { month: 'short' })}
                            tick={{fill: '#64748b', fontSize: 10}} 
                            axisLine={false} 
                            tickLine={false}
                            minTickGap={40}
                        />
                        
                        <YAxis 
                            tickFormatter={formatYAxis}
                            tick={{fill: '#64748b', fontSize: 10}}
                            axisLine={false}
                            tickLine={false}
                            domain={['auto', 'auto']}
                            width={45} 
                        />
                        
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px' }}
                            itemStyle={{ color: '#fff' }}
                            labelStyle={{ color: '#94a3b8', marginBottom: '5px' }}
                            labelFormatter={(label) => new Date(label).toLocaleDateString('pt-BR')}
                            formatter={(value: number) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value), 'Patrimônio']}
                            cursor={{ stroke: '#3B82F6', strokeWidth: 1 }}
                        />
                        
                        <Area 
                            type="monotone" 
                            dataKey="value" 
                            stroke="#3B82F6" 
                            strokeWidth={3} 
                            fill="url(#chartGradient)" 
                            activeDot={{ r: 5, fill: '#60A5FA', strokeWidth: 0 }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
