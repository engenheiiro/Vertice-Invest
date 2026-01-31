
import React, { useEffect, useState } from 'react';
import { walletService } from '../../services/wallet';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { TrendingUp, RefreshCw } from 'lucide-react';

interface PerformancePoint {
    date: string;
    wallet: number;
    cdi: number;
    ibov: number;
}

export const PerformanceChart = () => {
    const [data, setData] = useState<PerformancePoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const loadPerformance = async () => {
        setIsLoading(true);
        try {
            const res = await walletService.getPerformance();
            // Garante ordenação cronológica para o gráfico não bugar o hover
            const sorted = Array.isArray(res) ? res.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()) : [];
            setData(sorted);
        } catch (e) {
            console.error("Erro carregando performance:", e);
            setData([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadPerformance();
    }, []);

    if (isLoading) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[380px] flex items-center justify-center animate-pulse">
                <div className="text-center">
                    <RefreshCw className="animate-spin text-blue-500 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">Calculando rentabilidade relativa...</p>
                </div>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[380px] flex items-center justify-center">
                <p className="text-slate-500 text-sm">Dados insuficientes para comparação histórica.</p>
            </div>
        );
    }

    const lastPoint = data[data.length - 1];
    const walletWin = lastPoint && (lastPoint.wallet > lastPoint.cdi && lastPoint.wallet > (lastPoint.ibov || 0));

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[380px] flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-start mb-4 z-10 pointer-events-none">
                <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <TrendingUp size={16} className="text-blue-500" />
                        Rentabilidade Relativa
                    </h3>
                    <p className="text-xs text-slate-500">Comparativo Base 100 (Início da Carteira)</p>
                </div>
                <div className="text-right">
                     {walletWin ? (
                         <span className="text-xs font-bold text-emerald-500 bg-emerald-900/20 px-2 py-0.5 rounded border border-emerald-900/50">
                            Superando o Mercado 🚀
                         </span>
                     ) : (
                         <span className="text-xs font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                            Em linha com Benchmark
                         </span>
                     )}
                </div>
            </div>

            <div className="flex-1 w-full text-xs min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorWallet" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        
                        <XAxis 
                            dataKey="date" 
                            tick={{fill: '#64748b', fontSize: 10}} 
                            axisLine={false} 
                            tickLine={false}
                            tickFormatter={(val) => {
                                try {
                                    const d = new Date(val);
                                    if (isNaN(d.getTime())) return val;
                                    return `${d.getDate()}/${d.getMonth()+1}`;
                                } catch { return val; }
                            }}
                            minTickGap={30}
                        />
                        <YAxis 
                            axisLine={false}
                            tickLine={false}
                            tick={{fill: '#64748b', fontSize: 10}}
                            domain={['auto', 'auto']}
                            tickFormatter={(val) => `${val}%`}
                        />
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px', zIndex: 100 }}
                            itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                            labelStyle={{ color: '#94a3b8', marginBottom: '5px' }}
                            formatter={(value: number, name: string) => [
                                `${value.toFixed(2)}%`, 
                                name === 'wallet' ? 'Minha Carteira' : name === 'ibov' ? 'Ibovespa' : name
                            ]}
                            labelFormatter={(label) => new Date(label).toLocaleDateString('pt-BR')}
                            cursor={{ stroke: '#fff', strokeWidth: 1, strokeDasharray: '4 4' }}
                        />
                        <Legend 
                            verticalAlign="top" 
                            height={36} 
                            iconType="circle"
                            formatter={(value) => <span className="text-slate-400 font-bold ml-1">{value === 'wallet' ? 'Minha Carteira' : value === 'ibov' ? 'Ibovespa' : value}</span>}
                        />
                        
                        <Area 
                            type="monotone" 
                            dataKey="ibov" 
                            name="ibov" 
                            stroke="#64748b" 
                            strokeWidth={2} 
                            fill="transparent" 
                            strokeOpacity={0.5}
                            activeDot={false}
                        />

                        <Area 
                            type="monotone" 
                            dataKey="cdi" 
                            name="CDI" 
                            stroke="#fbbf24" 
                            strokeWidth={2} 
                            fill="transparent" 
                            strokeDasharray="4 4" 
                            activeDot={false}
                        />

                        <Area 
                            type="monotone" 
                            dataKey="wallet" 
                            name="wallet" 
                            stroke="#3B82F6" 
                            strokeWidth={3} 
                            fillOpacity={1} 
                            fill="url(#colorWallet)" 
                            activeDot={{ r: 6, strokeWidth: 0, fill: '#60A5FA' }}
                        />
                        
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
