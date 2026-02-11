
import React, { useMemo, useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend } from 'recharts';
import { BarChart3 } from 'lucide-react';

// Custom Tick para exibir o ponto pulsante no dia LIVE
const CustomXAxisTick = (props: any) => {
    const { x, y, payload, data } = props;
    
    // Encontra o item correspondente ao tick atual
    const item = data && data[payload.index];
    const isLive = item && item.isLive;

    return (
        <g transform={`translate(${x},${y})`}>
            <text 
                x={0} 
                y={0} 
                dy={12} 
                textAnchor="middle" 
                fill="#64748b" 
                fontSize={10} 
                fontWeight={500}
            >
                {payload.value}
            </text>
            {isLive && (
                // Ponto Pulsante Vermelho
                <g>
                    <circle cx={14} cy={8} r={3} fill="#ef4444" className="animate-ping opacity-75" />
                    <circle cx={14} cy={8} r={2} fill="#ef4444" />
                </g>
            )}
        </g>
    );
};

export const EvolutionChart = () => {
    const { kpis, history, isPrivacyMode } = useWallet();
    const [timeRange, setTimeRange] = useState<'ALL' | '12M' | 'YTD' | '1M'>('ALL');

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
        // Data de hoje normalizada (sem horas) para comparação
        const now = new Date();
        const todayStr = now.toLocaleDateString('pt-BR'); // "dd/mm/aaaa"

        // 1. Filtrar histórico para remover qualquer snapshot que porventura tenha a data de "hoje"
        // Isso garante que "hoje" seja sempre representado pelos dados LIVE (kpis)
        const cleanHistory = (history || []).filter(h => {
            const hDate = new Date(h.date).toLocaleDateString('pt-BR');
            return hDate !== todayStr;
        });

        // 2. Ordenar histórico
        const sortedHistory = [...cleanHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const rawDates = sortedHistory.map(h => new Date(h.date).getTime());
        // Se não tiver histórico, usa hoje como base
        const minDate = rawDates.length > 0 ? new Date(Math.min(...rawDates)) : new Date();
        const maxDate = new Date(); 

        let filledData: any[] = [];

        if (timeRange === '1M') {
            // LÓGICA DIÁRIA (Mês Atual)
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            
            // Filtra histórico para o mês atual
            const dailyHistory = sortedHistory.filter(h => new Date(h.date) >= startOfMonth);
            
            // Mapeia histórico
            dailyHistory.forEach(point => {
                const profit = (point.totalEquity || 0) - (point.totalInvested || 0);
                const stackBase = Math.min(point.totalEquity || 0, point.totalInvested || 0);
                const stackProfit = Math.max(0, profit);

                filledData.push({
                    label: new Date(point.date).getDate().toString(), 
                    fullDate: new Date(point.date).toLocaleDateString('pt-BR'),
                    sortDate: new Date(point.date),
                    baseBar: stackBase,
                    profitBar: stackProfit,
                    realInvested: point.totalInvested || 0,
                    realEquity: point.totalEquity || 0,
                    realProfit: profit
                });
            });

            // SEMPRE Adiciona o dia atual (Live KPI) se houver patrimônio
            if (kpis.totalEquity > 0) {
                 const profit = kpis.totalEquity - kpis.totalInvested;
                 const stackBase = Math.min(kpis.totalEquity, kpis.totalInvested);
                 const stackProfit = Math.max(0, profit);

                 filledData.push({
                    label: now.getDate().toString(),
                    fullDate: now.toLocaleDateString('pt-BR'),
                    sortDate: now,
                    baseBar: stackBase,
                    profitBar: stackProfit,
                    realInvested: kpis.totalInvested,
                    realEquity: kpis.totalEquity,
                    realProfit: kpis.totalResult,
                    isLive: true // Flag para identificar que é dado vivo
                });
            }

        } else {
            // LÓGICA MENSAL
            minDate.setDate(1);
            minDate.setHours(0,0,0,0);
            
            const historyMap = new Map();
            sortedHistory.forEach(point => {
                const d = new Date(point.date);
                const key = `${d.getFullYear()}-${d.getMonth()}`; 
                historyMap.set(key, {
                    invested: point.totalInvested || 0,
                    equity: point.totalEquity || 0
                });
            });

            let cursor = new Date(minDate);
            let lastInvested = 0;
            let lastEquity = 0;

            // Preenche meses passados
            while (cursor <= maxDate) {
                // Se cursor for mês atual, pulamos para adicionar o Live KPI no final
                if (cursor.getMonth() === now.getMonth() && cursor.getFullYear() === now.getFullYear()) {
                    cursor.setMonth(cursor.getMonth() + 1);
                    continue;
                }

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

            // Adiciona mês atual (Live KPI)
            if (kpis.totalEquity > 0) {
                 const profit = kpis.totalEquity - kpis.totalInvested;
                 const stackBase = Math.min(kpis.totalEquity, kpis.totalInvested);
                 const stackProfit = Math.max(0, profit);

                 filledData.push({
                    label: now.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' }),
                    sortDate: now,
                    baseBar: stackBase,
                    profitBar: stackProfit,
                    realInvested: kpis.totalInvested,
                    realEquity: kpis.totalEquity,
                    realProfit: kpis.totalResult,
                    isLive: true
                });
            }
        }

        // 3. Pós-Processamento: Calcular Variação do Período
        let finalData = filledData;

        if (timeRange === '12M') finalData = filledData.slice(-12);
        else if (timeRange === 'YTD') finalData = filledData.filter(d => d.sortDate.getFullYear() === now.getFullYear());

        const dataWithVariation = finalData.map((item, index) => {
            let prevEquity = 0;
            let prevInvested = 0;

            if (index > 0) {
                // Se não for o primeiro item do array VISÍVEL, pega o anterior do array
                prevEquity = finalData[index - 1].realEquity;
                prevInvested = finalData[index - 1].realInvested;
            } else {
                // Se for o primeiro item visível, tenta buscar no histórico global anterior a ele
                const firstDate = item.sortDate;
                const prevSnapshot = sortedHistory
                    .filter(h => new Date(h.date) < firstDate)
                    .pop(); 
                
                if (prevSnapshot) {
                    prevEquity = prevSnapshot.totalEquity;
                    prevInvested = prevSnapshot.totalInvested;
                }
            }

            // Variação de Mercado = (Variação Patrimônio) - (Aportes Líquidos)
            const equityDiff = item.realEquity - prevEquity;
            const investedDiff = item.realInvested - prevInvested;
            const marketVariation = equityDiff - investedDiff;

            return {
                ...item,
                periodVariation: marketVariation
            };
        });

        return dataWithVariation;

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
            </div>

            <div className="flex-1 w-full relative min-h-0 text-xs">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barGap={0}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        
                        <XAxis 
                            dataKey="label" 
                            axisLine={false} 
                            tickLine={false}
                            minTickGap={10}
                            // Usa o componente customizado para desenhar o ponto live
                            tick={(props) => <CustomXAxisTick {...props} data={chartData} />}
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
                                    const displayLabel = data.fullDate || label;
                                    const variation = data.periodVariation || 0;
                                    const isLive = data.isLive;
                                    
                                    return (
                                        <div className="bg-[#0F1729] border border-slate-700 rounded-xl p-3 shadow-2xl z-50 min-w-[180px]">
                                            <div className="flex justify-between items-center border-b border-slate-800 pb-1 mb-2">
                                                <p className="text-slate-400 text-[10px] font-bold uppercase">{displayLabel}</p>
                                                {isLive && <span className="text-[9px] text-red-500 font-black animate-pulse flex items-center gap-1">● LIVE</span>}
                                            </div>
                                            
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
                                                
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-bold">Variação</span>
                                                    <span className={`font-mono font-bold ${variation >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
                                                        {variation >= 0 ? '+' : ''}{formatTooltipCurrency(variation)}
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
