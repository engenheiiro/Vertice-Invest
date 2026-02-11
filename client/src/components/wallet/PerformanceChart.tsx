
import React, { useEffect, useState, useMemo } from 'react';
import { walletService } from '../../services/wallet';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { TrendingUp, RefreshCw, Calendar } from 'lucide-react';
import { useDemo } from '../../contexts/DemoContext';
import { DEMO_PERFORMANCE } from '../../data/DEMO_DATA';

interface PerformancePoint {
    date: string;
    wallet: number;    // TWRR (Padrão)
    walletRoi: number; // Retorno Simples
    cdi: number;
    ibov: number;
    ipca?: number; // IPCA + 6%
}

export const PerformanceChart = () => {
    const [data, setData] = useState<PerformancePoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [metricMode, setMetricMode] = useState<'TWRR' | 'ROI'>('TWRR'); 
    const [timeRange, setTimeRange] = useState<'1M' | '12M' | 'YTD' | 'ALL'>('ALL'); // Adicionado 1M
    
    const { isDemoMode } = useDemo();

    const loadPerformance = async () => {
        setIsLoading(true);
        
        if (isDemoMode) {
            // Simula delay de rede para realismo
            setTimeout(() => {
                setData(DEMO_PERFORMANCE);
                setIsLoading(false);
            }, 600);
            return;
        }

        try {
            const res = await walletService.getPerformance();
            const sorted = Array.isArray(res?.history) ? res.history.sort((a: any,b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()) : [];
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
    }, [isDemoMode]); // Recarrega se o modo mudar

    // --- FILTRAGEM DE DADOS (TIME RANGE) ---
    const filteredData = useMemo(() => {
        if (!data || data.length === 0) return [];
        if (timeRange === 'ALL') return data;

        const now = new Date();
        const cutoffDate = new Date();

        if (timeRange === '1M') {
            // Primeiro dia do mês atual
            cutoffDate.setDate(1); 
            cutoffDate.setHours(0,0,0,0);
        } else if (timeRange === '12M') {
            cutoffDate.setFullYear(now.getFullYear() - 1);
        } else if (timeRange === 'YTD') {
            cutoffDate.setMonth(0, 1); // 1º Jan do ano atual
            cutoffDate.setHours(0, 0, 0, 0);
        }

        return data.filter(point => new Date(point.date) >= cutoffDate);
    }, [data, timeRange]);

    // --- GERAÇÃO DE TICKS DO EIXO X ---
    const xAxisTicks = useMemo(() => {
        if (filteredData.length === 0) return [];
        const ticks: string[] = [];
        
        if (timeRange === '1M') {
            // Para mês atual, mostra dias intercalados se houver muitos dados, ou todos se poucos
            filteredData.forEach((point, index) => {
                // Mostra a cada 2 dias ou se for o último ponto
                if (index % 2 === 0 || index === filteredData.length - 1) {
                    ticks.push(point.date);
                }
            });
        } else {
            // Para períodos longos, mostra mensalmente
            const seenMonths = new Set();
            filteredData.forEach(point => {
                const d = new Date(point.date);
                // Usa UTC para extração segura de mês/ano
                const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
                
                if (!seenMonths.has(key)) {
                    ticks.push(point.date);
                    seenMonths.add(key);
                }
            });
        }
        return ticks;
    }, [filteredData, timeRange]);

    // Lógica de intervalo:
    // 1M: Intervalo 0 (mostra todos os ticks definidos)
    // 12M/YTD: Intervalo 0 (mostra todos os meses)
    // ALL: Deixa o Recharts decidir para não encavalar
    const tickInterval = (timeRange === '1M' || timeRange === '12M' || timeRange === 'YTD') ? 0 : 'preserveStartEnd';

    if (isLoading) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[420px] flex items-center justify-center animate-pulse">
                <div className="text-center">
                    <RefreshCw className="animate-spin text-blue-500 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">Calculando rentabilidade relativa...</p>
                </div>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[420px] flex items-center justify-center">
                <p className="text-slate-500 text-sm">Dados insuficientes para comparação histórica.</p>
            </div>
        );
    }

    const lastPoint = filteredData[filteredData.length - 1];
    const currentWalletValue = lastPoint ? (metricMode === 'TWRR' ? lastPoint.wallet : lastPoint.walletRoi) : 0;
    const walletWin = lastPoint && (currentWalletValue > lastPoint.cdi && currentWalletValue > (lastPoint.ibov || 0));

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[420px] flex flex-col relative overflow-hidden">
            
            {/* HEADER COM CONTROLES */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 z-10 relative">
                <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <TrendingUp size={16} className="text-blue-500" />
                        Performance Comparativa
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {metricMode === 'TWRR' ? 'Rentabilidade Ponderada pelo Tempo (Cotas)' : 'Variação Patrimonial Simples (Retorno Total)'}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    
                    {/* CONTROLE DE TEMPO */}
                    <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex gap-1">
                        {(['1M', 'YTD', '12M', 'ALL'] as const).map((t) => (
                            <button 
                                key={t}
                                onClick={() => setTimeRange(t)}
                                className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                    timeRange === t 
                                    ? 'bg-slate-700 text-white shadow-sm' 
                                    : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {t === '1M' ? 'Mês' : t === 'ALL' ? 'Tudo' : t}
                            </button>
                        ))}
                    </div>

                    <div className="w-px h-6 bg-slate-800 hidden sm:block"></div>

                    {/* CONTROLE DE MÉTRICA */}
                    <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex gap-1">
                        <button 
                            onClick={() => setMetricMode('TWRR')}
                            className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                metricMode === 'TWRR' 
                                ? 'bg-slate-700 text-white shadow-sm' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                            title="Time-Weighted Rate of Return"
                        >
                            TWRR
                        </button>
                        <button 
                            onClick={() => setMetricMode('ROI')}
                            className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                metricMode === 'ROI' 
                                ? 'bg-slate-700 text-white shadow-sm' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                            title="Return on Investment"
                        >
                            ROI
                        </button>
                    </div>

                    {walletWin && (
                         <span className="hidden md:inline-block text-[10px] font-bold text-emerald-500 bg-emerald-900/20 px-2 py-1 rounded border border-emerald-900/50">
                            Superando o Mercado 🚀
                         </span>
                    )}
                </div>
            </div>

            <div className="flex-1 w-full text-xs min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={filteredData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
                            ticks={xAxisTicks} 
                            interval={tickInterval} 
                            tickFormatter={(val) => {
                                try {
                                    const d = new Date(val);
                                    if (isNaN(d.getTime())) return val;
                                    
                                    // Formatação dinâmica baseada no range
                                    if (timeRange === '1M') {
                                        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
                                    }
                                    
                                    const m = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
                                    const y = d.toLocaleDateString('pt-BR', { year: '2-digit' });
                                    return `${m}/${y}`;
                                } catch { return val; }
                            }}
                            minTickGap={10} 
                        />
                        <YAxis 
                            axisLine={false}
                            tickLine={false}
                            tick={{fill: '#64748b', fontSize: 10}}
                            domain={['auto', 'auto']}
                            tickFormatter={(val) => `${val.toFixed(0)}%`}
                        />
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px', zIndex: 100 }}
                            itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                            labelStyle={{ color: '#94a3b8', marginBottom: '5px' }}
                            formatter={(value: number, name: string) => [
                                `${value.toFixed(2)}%`, 
                                name === 'walletVal' ? 'Minha Carteira' : name === 'ibov' ? 'Ibovespa' : name === 'ipca' ? 'IPCA + 6%' : name
                            ]}
                            labelFormatter={(label) => new Date(label).toLocaleDateString('pt-BR')}
                            cursor={{ stroke: '#fff', strokeWidth: 1, strokeDasharray: '4 4' }}
                        />
                        <Legend 
                            verticalAlign="top" 
                            height={36} 
                            iconType="circle"
                            formatter={(value) => <span className="text-slate-400 font-bold ml-1">{value === 'walletVal' ? 'Minha Carteira' : value === 'ibov' ? 'Ibovespa' : value === 'ipca' ? 'IPCA+6%' : value}</span>}
                        />
                        
                        <Area 
                            type="monotone" 
                            dataKey="ipca" 
                            name="ipca" 
                            stroke="#d946ef" // Fuchsia 500
                            strokeWidth={2} 
                            strokeDasharray="2 2"
                            fill="transparent" 
                            activeDot={false}
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
                            dataKey={metricMode === 'TWRR' ? 'wallet' : 'walletRoi'} 
                            name="walletVal" 
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
