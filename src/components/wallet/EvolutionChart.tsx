import React, { useMemo } from 'react';
import { useWallet } from '../../contexts/WalletContext';

export const EvolutionChart = () => {
    const { kpis } = useWallet();

    // Gera dados históricos fictícios baseados no patrimônio atual
    // (Em um app real, isso viria de uma API de histórico)
    const historyData = useMemo(() => {
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const dataPoints = [];
        let currentVal = kpis.totalEquity * 0.65; // Começa com 65% do valor atual há 12 meses

        // Loop para gerar 12 meses de dados
        for (let i = 0; i < 12; i++) {
            // Crescimento aleatório + aportes fictícios
            const growth = 1 + (Math.random() * 0.08 - 0.02); 
            currentVal = i === 11 ? kpis.totalEquity : currentVal * growth;
            
            dataPoints.push({
                month: months[i],
                value: currentVal
            });
        }
        return dataPoints;
    }, [kpis.totalEquity]);

    // Lógica SVG
    const width = 1000;
    const height = 300;
    const padding = 40;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    const minVal = Math.min(...historyData.map(d => d.value)) * 0.9;
    const maxVal = Math.max(...historyData.map(d => d.value)) * 1.05;
    
    const getX = (index: number) => padding + (index / (historyData.length - 1)) * graphWidth;
    const getY = (value: number) => height - padding - ((value - minVal) / (maxVal - minVal)) * graphHeight;

    // Constrói o caminho da linha (Polyline)
    const points = historyData.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');
    
    // Constrói o caminho da área (fecha embaixo)
    const areaPoints = `${points} ${getX(historyData.length - 1)},${height - padding} ${getX(0)},${height - padding}`;

    const formatCurrency = (val: number) => {
        if (val >= 1000000) return `R$ ${(val/1000000).toFixed(1)}M`;
        if (val >= 1000) return `R$ ${(val/1000).toFixed(0)}k`;
        return `R$ ${val.toFixed(0)}`;
    };

    if (kpis.totalEquity === 0) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[380px] flex items-center justify-center">
                <p className="text-slate-500 text-sm">Adicione ativos para ver a evolução.</p>
            </div>
        );
    }

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[380px] flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-start mb-4 z-10">
                <div>
                    <h3 className="text-base font-bold text-white">Evolução Patrimonial</h3>
                    <p className="text-xs text-slate-500">Histórico acumulado (12 meses)</p>
                </div>
                <div className="text-right">
                     <span className="text-xs font-bold text-emerald-500 bg-emerald-900/20 px-2 py-0.5 rounded border border-emerald-900/50">
                        +35.4% este ano (Simulado)
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
                        const y = height - padding - (p * graphHeight);
                        return (
                            <g key={i}>
                                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1e293b" strokeWidth="1" strokeDasharray="4" />
                                <text x={padding - 10} y={y + 4} textAnchor="end" className="fill-slate-600 text-[10px] font-mono">
                                    {formatCurrency(minVal + p * (maxVal - minVal))}
                                </text>
                            </g>
                        );
                    })}

                    {/* Area Fill */}
                    <polygon points={areaPoints} fill="url(#chartGradient)" />

                    {/* Line Stroke */}
                    <polyline points={points} fill="none" stroke="#3B82F6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

                    {/* Dots on points */}
                    {historyData.map((d, i) => (
                        <circle 
                            key={i} 
                            cx={getX(i)} 
                            cy={getY(d.value)} 
                            r={i === historyData.length - 1 ? 5 : 0} 
                            className="fill-blue-500 stroke-[#080C14] stroke-2"
                        />
                    ))}

                    {/* X Axis Labels */}
                    {historyData.map((d, i) => (
                        <text key={i} x={getX(i)} y={height - 10} textAnchor="middle" className="fill-slate-500 text-[10px] font-bold uppercase">
                            {d.month}
                        </text>
                    ))}
                </svg>
            </div>
        </div>
    );
};