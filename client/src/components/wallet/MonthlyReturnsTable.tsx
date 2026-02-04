
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { walletService } from '../../services/wallet';
import { Loader2, Calendar, AlertCircle } from 'lucide-react';
import { useWallet } from '../../contexts/WalletContext';

interface PerformancePoint {
    date: string;
    wallet: number; // TWRR Acumulado em %
}

interface MonthData {
    value: number | null; // Null se não houver dados (ex: futuro)
}

interface YearRow {
    year: number;
    months: MonthData[]; // Índices 0 (Jan) a 11 (Dez)
    ytd: number; // Year to Date
    accumulated: number; // Acumulado Total até o fim deste ano
}

export const MonthlyReturnsTable = () => {
    const { isPrivacyMode } = useWallet();

    // Reutiliza o cache do React Query se o gráfico já tiver carregado os dados
    const { data: rawData, isLoading } = useQuery({
        queryKey: ['walletPerformance'], // Mesma key usada (se implementada no chart) ou nova
        queryFn: walletService.getPerformance,
        staleTime: 1000 * 60 * 10, // 10 minutos de cache
    });

    const tableData = useMemo(() => {
        if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return [];

        // 1. Ordenar cronologicamente
        const sortedData = [...rawData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Mapa auxiliar: 'YYYY-MM' -> Último valor acumulado do mês
        const monthEndValues = new Map<string, number>();
        const yearsSet = new Set<number>();

        sortedData.forEach(point => {
            const date = new Date(point.date);
            // Ajuste de fuso horário simples (pegar a parte da data YYYY-MM-DD)
            const dateStr = point.date.split('T')[0]; 
            const [y, m] = dateStr.split('-'); 
            const key = `${y}-${m}`; // Ex: "2024-01"
            
            yearsSet.add(parseInt(y));
            
            // Sobrescreve sempre, garantindo que o último dia do mês fique salvo
            monthEndValues.set(key, point.wallet);
        });

        const years = Array.from(yearsSet).sort((a, b) => b - a); // Decrescente (2025, 2024...)
        const rows: YearRow[] = [];

        // Valor inicial da carteira (base 0%)
        let lastYearCloseValue = 0; 

        // Encontrar o valor "Zero" real (o dia anterior ao primeiro registro, ou assumir 0)
        // O backend TWRR começa em 0 no dia 1.

        years.reverse().forEach(year => { // Processa do mais antigo para o mais novo para calcular acumulado corretamente
            const months: MonthData[] = [];
            let yearStartValue = lastYearCloseValue;
            
            // Se for o primeiro ano, precisamos ver se começou no meio do ano
            // A lógica abaixo calcula mês a mês geometricamente
            
            let currentAccumulatedInYear = 0; // Acumulado do ano (YTD)

            for (let m = 1; m <= 12; m++) {
                const monthKey = `${year}-${String(m).padStart(2, '0')}`;
                const prevMonthKey = `${m === 1 ? year - 1 : year}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
                
                const currentValue = monthEndValues.get(monthKey);
                
                // Busca o valor do mês anterior. 
                // Se não existir mês anterior no mapa (ex: começou em Março), tentamos buscar o último dia disponível antes disso.
                // Simplificação: Se não tem mês anterior e é o primeiro mês de dados, a base é 0.
                let prevValue = monthEndValues.get(prevMonthKey);
                
                if (prevValue === undefined) {
                    // Caso especial: Início do histórico no meio do ano ou ano anterior sem dados
                    if (m === 1) {
                        prevValue = lastYearCloseValue;
                    } else {
                        // Se não tem mês anterior (ex: buraco), assume o último valor conhecido ou null
                        // Aqui assumimos null para não inventar rentabilidade
                        prevValue = undefined; 
                    }
                }

                // Se temos valor atual, calculamos. 
                // Nota: O primeiro mês de dados deve ser comparado com 0 (base inicial).
                if (currentValue !== undefined) {
                    // Se prevValue for undefined (ex: antes do início da carteira), usamos 0 se for o primeiro registro global
                    if (prevValue === undefined) {
                        // Verifica se este é o primeiro mês absoluto de dados
                        const firstDataPoint = sortedData[0];
                        const firstDate = new Date(firstDataPoint.date);
                        if (firstDate.getFullYear() === year && (firstDate.getMonth() + 1) === m) {
                            prevValue = 0; // Base inicial
                        }
                    }

                    if (prevValue !== undefined) {
                        // Cálculo Geométrico: (1 + Atual%) / (1 + Anterior%) - 1
                        const factorCurrent = 1 + (currentValue / 100);
                        const factorPrev = 1 + (prevValue / 100);
                        const monthlyReturn = ((factorCurrent / factorPrev) - 1) * 100;
                        
                        months.push({ value: monthlyReturn });
                    } else {
                        months.push({ value: null });
                    }
                } else {
                    months.push({ value: null });
                }
            }

            // Fechamento do ano
            // Replacement for findLast to fix TS error
            const lastMonthWithData = [...months].reverse().find(m => m.value !== null);
            const yearEndValue = monthEndValues.get(`${year}-12`) ?? monthEndValues.get(`${year}-${new Date().getMonth() + 1}`) ?? (lastMonthWithData ? sortedData[sortedData.length-1].wallet : null);
            
            // YTD: (1 + FinalAno) / (1 + InicioAnoReal) - 1
            // Precisamos pegar o valor exato do final do ano anterior (ou 0 se for o primeiro)
            let ytd = 0;
            const lastVal = monthEndValues.get(`${year}-12`) || Array.from(monthEndValues.entries()).filter(([k]) => k.startsWith(`${year}-`)).pop()?.[1];
            
            if (lastVal !== undefined) {
                const startVal = lastYearCloseValue;
                const factorEnd = 1 + (lastVal / 100);
                const factorStart = 1 + (startVal / 100);
                ytd = ((factorEnd / factorStart) - 1) * 100;
            }

            // Atualiza base para o próximo ano (Valor de Dezembro deste ano)
            const decValue = monthEndValues.get(`${year}-12`);
            if (decValue !== undefined) {
                lastYearCloseValue = decValue;
            } else {
                // Se o ano não acabou, o "fechamento" para cálculo do próximo ano (que não existe) seria o atual
                // Mas para a variável de loop, mantemos o último conhecido se for o último ano
                lastYearCloseValue = lastVal || 0;
            }

            // Acumulado Total (Simplesmente o valor da cota no final do ano)
            const accumulatedTotal = lastVal !== undefined ? lastVal : 0;

            rows.push({
                year,
                months,
                ytd,
                accumulated: accumulatedTotal
            });
        });

        return rows.reverse(); // Volta para ordem decrescente (2025 no topo)
    }, [rawData]);

    const formatPercent = (val: number | null) => {
        if (val === null) return '-';
        if (isPrivacyMode) return '•••';
        return `${val > 0 ? '+' : ''}${val.toFixed(2)}%`;
    };

    const getColor = (val: number | null) => {
        if (val === null) return 'text-slate-600';
        if (val > 0) return 'text-emerald-400';
        if (val < 0) return 'text-red-400';
        return 'text-slate-400'; // Zero
    };

    if (isLoading) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[200px] flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-500" />
            </div>
        );
    }

    if (tableData.length === 0) {
        return null; // Não mostra nada se não tiver dados
    }

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden shadow-sm hover:border-slate-700 transition-colors animate-fade-in">
            <div className="p-5 border-b border-slate-800 bg-[#0B101A] flex items-center gap-2">
                <Calendar size={16} className="text-blue-500" />
                <h3 className="font-bold text-slate-200 text-sm">Rentabilidade Mensal</h3>
            </div>
            
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-center border-collapse text-xs">
                    <thead>
                        <tr className="bg-[#0F131E] text-slate-500 font-bold border-b border-slate-800">
                            <th className="p-3 text-left pl-6">Ano</th>
                            <th className="p-3">Jan</th>
                            <th className="p-3">Fev</th>
                            <th className="p-3">Mar</th>
                            <th className="p-3">Abr</th>
                            <th className="p-3">Mai</th>
                            <th className="p-3">Jun</th>
                            <th className="p-3">Jul</th>
                            <th className="p-3">Ago</th>
                            <th className="p-3">Set</th>
                            <th className="p-3">Out</th>
                            <th className="p-3">Nov</th>
                            <th className="p-3">Dez</th>
                            <th className="p-3 font-black text-white bg-slate-800/30 border-l border-slate-800">Ano</th>
                            <th className="p-3 font-black text-white bg-slate-800/30">Acum.</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {tableData.map((row) => (
                            <tr key={row.year} className="hover:bg-slate-800/20 transition-colors group">
                                <td className="p-3 text-left pl-6 font-bold text-white bg-[#0B101A] border-r border-slate-800/50">
                                    {row.year}
                                </td>
                                {row.months.map((m, idx) => (
                                    <td key={idx} className={`p-3 font-mono font-medium ${getColor(m.value)}`}>
                                        {formatPercent(m.value)}
                                    </td>
                                ))}
                                <td className={`p-3 font-mono font-bold border-l border-slate-800 bg-slate-900/20 ${getColor(row.ytd)}`}>
                                    {formatPercent(row.ytd)}
                                </td>
                                <td className={`p-3 font-mono font-bold bg-slate-900/20 ${getColor(row.accumulated)}`}>
                                    {formatPercent(row.accumulated)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            
            <div className="p-3 bg-[#0B101A] border-t border-slate-800 text-[10px] text-slate-500 text-center flex items-center justify-center gap-1.5">
                <AlertCircle size={10} />
                <span>Valores baseados na cota diária da carteira (TWRR). Rentabilidade passada não garante futuro.</span>
            </div>
        </div>
    );
};
