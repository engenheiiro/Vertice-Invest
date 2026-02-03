
import React, { useMemo, useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
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

    // --- ALGORITMO DE PREENCHIMENTO TEMPORAL (TIME-FILLING) ---
    // Garante que não haja buracos no gráfico entre a primeira compra e hoje.
    const chartData = useMemo(() => {
        if (!history || history.length === 0) return [];

        // 1. Encontrar data inicial e final
        // Se a data inicial for muito antiga, respeita o filtro, senão pega a primeira transação
        const rawDates = history.map(h => new Date(h.date).getTime());
        const minDate = new Date(Math.min(...rawDates));
        const maxDate = new Date(); // Sempre vai até hoje

        // Ajuste para o início do mês para normalização
        minDate.setDate(1);
        minDate.setHours(0,0,0,0);
        
        // 2. Mapear dados existentes para busca rápida O(1)
        const historyMap = new Map();
        history.forEach(point => {
            const d = new Date(point.date);
            const key = `${d.getFullYear()}-${d.getMonth()}`; // Chave única por mês
            // Mantemos o último registro de cada mês (sobrescreve se houver múltiplos)
            historyMap.set(key, {
                invested: point.totalInvested || 0,
                equity: point.totalEquity || 0
            });
        });

        const filledData = [];
        let cursor = new Date(minDate);
        
        // Estado anterior para "Carry Over" (preencher meses vazios com valor anterior)
        let lastInvested = 0;
        let lastEquity = 0;

        // Se o histórico começar "do nada" com valor alto, tentamos pegar o primeiro valor real
        // Mas a lógica de carry over cuida disso na iteração.

        // 3. Loop Mês a Mês
        while (cursor <= maxDate) {
            const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
            const monthLabel = cursor.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' }); // 01/24
            
            const existingData = historyMap.get(key);

            if (existingData) {
                lastInvested = existingData.invested;
                lastEquity = existingData.equity;
            }

            // Lógica Visual de Barras Empilhadas:
            // A altura total da barra deve ser SEMPRE igual ao Patrimônio (lastEquity).
            // - Base (Verde Escuro): Valor Investido (Limitado ao Equity se houver prejuízo)
            // - Topo (Verde Claro): Lucro (Equity - Investido)
            // Se houver prejuízo (Equity < Invested), a barra será menor que o investido, mas correta visualmente.
            
            const baseValue = Math.min(lastInvested, lastEquity); // A parte "Sólida"
            const profitValue = Math.max(0, lastEquity - lastInvested); // A parte "Lucro"
            
            // Só adiciona se houver algum valor (evita meses zerados antes do primeiro aporte se a lógica de data falhar)
            if (lastEquity > 0 || lastInvested > 0) {
                filledData.push({
                    label: monthLabel,
                    sortDate: new Date(cursor), // Para filtro
                    investedDisplay: baseValue,
                    profitDisplay: profitValue,
                    
                    // Dados reais para Tooltip
                    realInvested: lastInvested,
                    realEquity: lastEquity,
                    realProfit: lastEquity - lastInvested
                });
            }

            // Avança 1 mês
            cursor.setMonth(cursor.getMonth() + 1);
        }

        // 4. Adiciona o estado "Agora" (Live) se ainda não estiver incluso no mês atual
        // Isso garante que o usuário veja a rentabilidade do segundo atual
        const currentKey = `${new Date().getFullYear()}-${new Date().getMonth()}`;
        if (!historyMap.has(currentKey)) {
             const baseValue = Math.min(kpis.totalInvested, kpis.totalEquity);
             const profitValue = Math.max(0, kpis.totalEquity - kpis.totalInvested);
             
             // Remove o último se for do mesmo mês (para atualizar com dados live)
             if (filledData.length > 0 && filledData[filledData.length - 1].label === new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' })) {
                 filledData.pop();
             }

             if (kpis.totalEquity > 0) {
                filledData.push({
                    label: new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' }),
                    sortDate: new Date(),
                    investedDisplay: baseValue,
                    profitDisplay: profitValue,
                    realInvested: kpis.totalInvested,
                    realEquity: kpis.totalEquity,
                    realProfit: kpis.totalResult
                });
             }
        }

        // 5. Filtragem de Tempo (Fatiamento do Array já preenchido)
        let finalData = filledData;
        const now = new Date();

        if (timeRange === '12M') {
            // Pega os últimos 12 meses
            finalData = filledData.slice(-12);
        } else if (timeRange === 'YTD') {
            finalData = filledData.filter(d => d.sortDate.getFullYear() === now.getFullYear());
        }

        return finalData;
    }, [history, kpis, timeRange]);

    // Cálculo dinâmico da largura da barra para evitar sobreposição
    const barSize = chartData.length > 24 ? 12 : (chartData.length > 12 ? 20 : 35);

    if (kpis.totalEquity === 0 && chartData.length === 0) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[420px] flex flex-col items-center justify-center text-center relative overflow-hidden group">
                <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center mb-4 border border-slate-800 shadow-xl">
                    <BarChart3 className="text-slate-600" size={32} />
                </div>
                <h3 className="text-white font-bold mb-1">Evolução do Patrimônio</h3>
                <p className="text-slate-500 text-xs max-w-[200px]">
                    Adicione ativos para visualizar o gráfico de barras mensais.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[420px] flex flex-col relative overflow-hidden shadow-sm hover:border-slate-700 transition-colors">
            
            {/* Header com Filtros */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 z-10 relative">
                <div>
                    <h3 className="text-base font-bold text-white">Evolução do Patrimônio</h3>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                        <p className="text-xs text-slate-400">Valor aplicado</p>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 ml-2"></span>
                        <p className="text-xs text-slate-400">Ganho capital</p>
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

            {/* Gráfico */}
            <div className="flex-1 w-full relative min-h-0 text-xs">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barGap={2}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        
                        <XAxis 
                            dataKey="label" 
                            tick={{fill: '#64748b', fontSize: 10, fontWeight: 500}} 
                            axisLine={false} 
                            tickLine={false}
                            minTickGap={30} // Evita sobreposição de datas
                            dy={10}
                        />
                        
                        <YAxis 
                            tickFormatter={formatCurrency}
                            tick={{fill: '#64748b', fontSize: 10}}
                            axisLine={false}
                            tickLine={false}
                        />
                        
                        <Tooltip 
                            cursor={{ fill: '#1e293b', opacity: 0.4 }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                        <div className="bg-[#0F1729] border border-slate-700 rounded-xl p-3 shadow-2xl z-50 min-w-[180px]">
                                            <p className="text-slate-400 text-[10px] font-bold uppercase mb-2 border-b border-slate-800 pb-1">{label}</p>
                                            
                                            <div className="space-y-1.5">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-emerald-600 font-medium">Aplicado</span>
                                                    <span className="text-slate-200 font-mono">{formatTooltipCurrency(data.realInvested)}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-emerald-400 font-medium">Rentabilidade</span>
                                                    <span className={`font-mono ${data.realProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {data.realProfit >= 0 ? '+' : ''}{formatTooltipCurrency(data.realProfit)}
                                                    </span>
                                                </div>
                                                <div className="border-t border-slate-800 pt-1.5 mt-1 flex justify-between items-center">
                                                    <span className="text-white font-bold text-xs">Patrimônio</span>
                                                    <span className="text-white font-bold font-mono text-sm">{formatTooltipCurrency(data.realEquity)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        
                        {/* Barra Base: Investido (Visualmente ajustado para nunca exceder Equity se prejuízo) */}
                        <Bar 
                            dataKey="investedDisplay" 
                            stackId="a" 
                            fill="#059669" // Emerald 600 (Mais escuro)
                            radius={[0, 0, 4, 4]} // Arredonda embaixo
                            maxBarSize={50}
                            barSize={barSize}
                            animationDuration={1500}
                        />
                        
                        {/* Barra Topo: Lucro (Só existe se Equity > Investido) */}
                        <Bar 
                            dataKey="profitDisplay" 
                            stackId="a" 
                            fill="#34D399" // Emerald 400 (Mais claro)
                            radius={[4, 4, 0, 0]} // Arredonda topo
                            maxBarSize={50}
                            barSize={barSize}
                            animationDuration={1500}
                        />
                        
                        {/* Linha de Referência Zero */}
                        <ReferenceLine y={0} stroke="#334155" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
