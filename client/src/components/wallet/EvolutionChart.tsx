
import React, { useMemo } from 'react';
import { useWallet } from '../../contexts/WalletContext';

export const EvolutionChart = () => {
    const { kpis, history } = useWallet();

    const chartData = useMemo(() => {
        // Se temos histórico real, usamos ele
        if (history && history.length > 0) {
            const mapped = history.map(h => {
                const dateObj = new Date(h.date);
                // Validação de data segura e formatação curta (ex: Jan, Fev)
                const dateStr = isNaN(dateObj.getTime()) 
                    ? 'Data' 
                    : dateObj.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
                
                return {
                    date: dateStr,
                    fullDate: dateObj.toLocaleDateString('pt-BR'),
                    value: Number(h.totalEquity) || 0
                };
            });

            // Adiciona o ponto atual
            mapped.push({
                date: 'Atual',
                fullDate: 'Hoje',
                value: kpis.totalEquity
            });

            // Se tiver apenas 1 ponto, cria um ponto zero anterior para dar a sensação de linha
            if (mapped.length < 2) {
                return [
                    { date: 'Início', fullDate: 'Início', value: 0 },
                    ...mapped
                ];
            }
            
            // Pega os últimos 6 a 12 meses para melhor visualização
            return mapped.slice(-12);
        }

        // Simulação inicial se não houver histórico
        if (kpis.totalEquity > 0) {
            return [
                { date: 'Início', value: 0 },
                { date: 'Agora', value: kpis.totalEquity }
            ];
        }

        return [];
    }, [history, kpis.totalEquity]);

    // Lógica SVG
    const width = 1000;
    const height = 300;
    const padding = 50; // Aumentado para caber o texto embaixo
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    const hasData = chartData.length > 0;
    
    let minVal = hasData ? Math.min(...chartData.map(d => d.value)) : 0;
    let maxVal = hasData ? Math.max(...chartData.map(d => d.value)) : 100;

    if (minVal === maxVal) {
        minVal = minVal * 0.9; 
        maxVal = maxVal * 1.1; 
    }
    if (maxVal === 0) maxVal = 100;

    const range = maxVal - minVal;

    const getX = (index: number) => {
        const count = chartData.length;
        if (count <= 1) return padding;
        return padding + (index / (count - 1)) * graphWidth;
    };

    const getY = (value: number) => {
        const ratio = (value - minVal) / range;
        return height - padding - (ratio * graphHeight);
    };

    const points = chartData.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');
    
    const areaPoints = hasData 
        ? `${points} ${getX(chartData.length - 1)},${height - padding} ${getX(0)},${height - padding}`
        : '';

    const formatCurrency = (val: number) => {
        if (val >= 1000000) return `R$ ${(val/1000000).toFixed(1)}M`;
        if (val >= 1000) return `R$ ${(val/1000).toFixed(0)}k`;
        return `R$ ${val.toFixed(0)}`;
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
            <div className="flex justify-between items-start mb-2 z-10">
                <div>
                    <h3 className="text-base font-bold text-white">Evolução Patrimonial</h3>
                    <p className="text-xs text-slate-500">Crescimento mês a mês</p>
                </div>
                <div className="text-right">
                     <span className={`text-xs font-bold px-2 py-0.5 rounded border ${kpis.totalResult >= 0 ? 'text-emerald-500 bg-emerald-900/20 border-emerald-900/50' : 'text-red-500 bg-red-900/20 border-red-900/50'}`}>
                        {kpis.totalResult >= 0 ? '+' : ''}{kpis.totalResultPercent.toFixed(2)}% Total
                     </span>
                </div>
            </div>

            <div className="flex-1 w-full relative">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
                    <defs>
                        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                        </linearGradient>
                    </defs>

                    {/* Linhas de Grade e Valores Y */}
                    {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
                        const val = minVal + p * range;
                        const y = getY(val);
                        return (
                            <g key={i}>
                                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1e293b" strokeWidth="1" strokeDasharray="4" />
                                <text x={padding - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[10px] font-mono font-medium">
                                    {formatCurrency(val)}
                                </text>
                            </g>
                        );
                    })}

                    {/* Área e Linha */}
                    {hasData && <polygon points={areaPoints} fill="url(#chartGradient)" />}
                    {hasData && <polyline points={points} fill="none" stroke="#3B82F6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}

                    {/* Pontos e Rótulos X (Meses) */}
                    {chartData.map((d, i) => (
                        <g key={i}>
                            <circle 
                                cx={getX(i)} 
                                cy={getY(d.value)} 
                                r={i === chartData.length - 1 ? 5 : 3} 
                                className="fill-blue-500 stroke-[#080C14] stroke-2 hover:r-6 transition-all cursor-pointer"
                            >
                                <title>{d.fullDate}: {formatCurrency(d.value)}</title>
                            </circle>
                            
                            {/* Rótulo do Mês - Renderizado abaixo do gráfico */}
                            <text 
                                x={getX(i)} 
                                y={height - 15} 
                                textAnchor="middle" 
                                className="fill-slate-400 text-[11px] font-bold uppercase tracking-wider"
                            >
                                {d.date}
                            </text>
                        </g>
                    ))}
                </svg>
            </div>
        </div>
    );
};
