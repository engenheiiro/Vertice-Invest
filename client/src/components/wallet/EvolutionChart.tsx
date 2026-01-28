
import React, { useMemo } from 'react';
import { useWallet } from '../../contexts/WalletContext';

export const EvolutionChart = () => {
    const { kpis, history } = useWallet();

    const chartData = useMemo(() => {
        // Se temos histórico real, usamos ele
        if (history && history.length > 0) {
            const mapped = history.map(h => {
                const dateObj = new Date(h.date);
                // Validação de data segura
                const dateStr = isNaN(dateObj.getTime()) 
                    ? 'Data' 
                    : dateObj.toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' });
                
                return {
                    date: dateStr,
                    value: Number(h.totalEquity) || 0
                };
            });

            // Adiciona o ponto atual ("Agora") para o gráfico ficar realtime
            mapped.push({
                date: 'Agora',
                value: kpis.totalEquity
            });

            // Se tiver apenas 1 ou 2 pontos (usuário muito novo), preenche com mock "zero" atrás para visual
            if (mapped.length < 3) {
                return [
                    { date: 'Início', value: 0 },
                    ...mapped
                ];
            }
            
            // Pega apenas os últimos 12 pontos para não poluir
            return mapped.slice(-12);
        }

        // Se NÃO temos histórico (usuário acabou de criar conta e adicionar ativos)
        // Mostramos uma linha reta do zero até o valor atual
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
    const padding = 40;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    const hasData = chartData.length > 0;
    
    // Cálculo seguro de Min/Max para evitar linha plana (divisão por zero)
    let minVal = hasData ? Math.min(...chartData.map(d => d.value)) : 0;
    let maxVal = hasData ? Math.max(...chartData.map(d => d.value)) : 100;

    // Se min e max forem iguais (linha reta), cria um range artificial
    if (minVal === maxVal) {
        minVal = minVal * 0.95; // 5% abaixo
        maxVal = maxVal * 1.05; // 5% acima
    }
    
    // Fallback se valores forem zero
    if (maxVal === 0) maxVal = 100;

    const range = maxVal - minVal;

    const getX = (index: number) => {
        const count = chartData.length;
        if (count <= 1) return padding; // Evita divisão por zero se só tiver 1 ponto
        return padding + (index / (count - 1)) * graphWidth;
    };

    const getY = (value: number) => {
        const ratio = (value - minVal) / range;
        return height - padding - (ratio * graphHeight);
    };

    const points = chartData.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');
    
    // Garante que a área fecha corretamente no eixo X
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
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[380px] flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-start mb-4 z-10">
                <div>
                    <h3 className="text-base font-bold text-white">Evolução Patrimonial</h3>
                    <p className="text-xs text-slate-500">
                        {history.length > 0 ? 'Histórico Real' : 'Simulação Inicial'}
                    </p>
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

                    {/* Grid Lines Horizontais */}
                    {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
                        const val = minVal + p * range;
                        const y = getY(val);
                        return (
                            <g key={i}>
                                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1e293b" strokeWidth="1" strokeDasharray="4" />
                                <text x={padding - 10} y={y + 4} textAnchor="end" className="fill-slate-600 text-[10px] font-mono">
                                    {formatCurrency(val)}
                                </text>
                            </g>
                        );
                    })}

                    {/* Area Fill */}
                    {hasData && <polygon points={areaPoints} fill="url(#chartGradient)" />}

                    {/* Line Stroke */}
                    {hasData && <polyline points={points} fill="none" stroke="#3B82F6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}

                    {/* Dots on points */}
                    {chartData.map((d, i) => (
                        <circle 
                            key={i} 
                            cx={getX(i)} 
                            cy={getY(d.value)} 
                            r={i === chartData.length - 1 ? 5 : 3} 
                            className="fill-blue-500 stroke-[#080C14] stroke-2 hover:r-6 transition-all cursor-pointer"
                        >
                            <title>{d.date}: {formatCurrency(d.value)}</title>
                        </circle>
                    ))}

                    {/* X Axis Labels */}
                    {chartData.map((d, i) => (
                        <text key={i} x={getX(i)} y={height - 10} textAnchor="middle" className="fill-slate-500 text-[10px] font-bold uppercase">
                            {d.date}
                        </text>
                    ))}
                </svg>
            </div>
        </div>
    );
};
