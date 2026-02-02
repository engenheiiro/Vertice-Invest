
import React, { useMemo } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart3 } from 'lucide-react';

export const EvolutionChart = () => {
    const { kpis, history } = useWallet();

    const chartData = useMemo(() => {
        let mapped = [];
        
        if (history && history.length > 0) {
            mapped = history.map(h => {
                // MANIPULAÇÃO DE DATA ROBUSTA (Sem conversão UTC->Local indesejada)
                // O backend envia YYYY-MM-DD. O browser pode interpretar como UTC-3 e subtrair um dia.
                // Solução: Split na string e criar data com hora fixa meio-dia.
                const dateParts = typeof h.date === 'string' 
                    ? h.date.split('T')[0].split('-') 
                    : new Date(h.date).toISOString().split('T')[0].split('-');
                
                const year = parseInt(dateParts[0]);
                const month = parseInt(dateParts[1]) - 1; // Mês 0-indexado
                const day = parseInt(dateParts[2]);
                
                const dateObj = new Date(year, month, day, 12, 0, 0);

                return {
                    dateStr: `${day}/${month + 1}`, // Label pronto para exibição
                    fullDate: dateObj.toLocaleDateString('pt-BR'),
                    value: Number(h.totalEquity) || 0,
                    // Timestamp apenas para ordenação
                    timestamp: dateObj.getTime()
                };
            })
            // Filtra dias sem valor (falhas residuais)
            .filter(item => item.value > 0)
            .sort((a,b) => a.timestamp - b.timestamp);
        }

        // Adiciona ponto "Hoje" se o último histórico não for hoje
        if (kpis.totalEquity > 0) {
            const today = new Date();
            const lastPoint = mapped.length > 0 ? mapped[mapped.length - 1] : null;
            
            const isSameDay = lastPoint && lastPoint.fullDate === today.toLocaleDateString('pt-BR');

            if (!isSameDay) {
                mapped.push({
                    dateStr: 'Hoje',
                    fullDate: today.toLocaleDateString('pt-BR'),
                    value: kpis.totalEquity,
                    timestamp: today.getTime()
                });
            }
        }

        return mapped;
    }, [history, kpis.totalEquity]);

    const formatYAxis = (val: number) => {
        if (val >= 1000000) return `${(val/1000000).toFixed(1)}M`;
        if (val >= 1000) return `${(val/1000).toFixed(0)}k`;
        return val.toString();
    };

    if (kpis.totalEquity === 0 || chartData.length === 0) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[380px] flex flex-col items-center justify-center text-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-blue-900/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center mb-4 border border-slate-800 shadow-xl">
                    <BarChart3 className="text-slate-600" size={32} />
                </div>
                <h3 className="text-white font-bold mb-1">Evolução Patrimonial</h3>
                <p className="text-slate-500 text-xs max-w-[200px]">
                    Adicione ativos para visualizar a evolução do seu patrimônio.
                </p>
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
                            dataKey="dateStr" 
                            tick={{fill: '#64748b', fontSize: 10}} 
                            axisLine={false} 
                            tickLine={false}
                            minTickGap={30}
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
                            contentStyle={{ backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px', zIndex: 100 }}
                            itemStyle={{ color: '#fff' }}
                            labelStyle={{ color: '#94a3b8', marginBottom: '5px' }}
                            formatter={(value: number) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value), 'Patrimônio']}
                            labelFormatter={(label, payload) => {
                                if (payload && payload.length > 0) return payload[0].payload.fullDate;
                                return label;
                            }}
                            cursor={{ stroke: '#3B82F6', strokeWidth: 1 }}
                        />
                        
                        <Area 
                            type="monotone" 
                            dataKey="value" 
                            stroke="#3B82F6" 
                            strokeWidth={3} 
                            fill="url(#chartGradient)" 
                            activeDot={{ r: 5, fill: '#60A5FA', strokeWidth: 0 }}
                            isAnimationActive={true}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
