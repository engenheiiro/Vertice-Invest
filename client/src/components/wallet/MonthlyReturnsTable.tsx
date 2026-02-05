
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { walletService } from '../../services/wallet';
import { Loader2, Calendar, AlertCircle } from 'lucide-react';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';
import { DEMO_PERFORMANCE } from '../../data/DEMO_DATA';

interface MonthData {
    value: number | null; 
}

interface YearRow {
    year: number;
    months: MonthData[]; 
    ytd: number; 
    accumulated: number;
}

export const MonthlyReturnsTable = () => {
    const { isPrivacyMode } = useWallet();
    const { isDemoMode } = useDemo();

    const { data: rawData, isLoading } = useQuery({
        queryKey: ['walletPerformance'], 
        queryFn: walletService.getPerformance,
        staleTime: 1000 * 60 * 10,
        enabled: !isDemoMode // Desativa query real se for Demo
    });

    const tableData = useMemo(() => {
        // Seleciona a fonte de dados (Real ou Demo)
        const sourceData = isDemoMode ? DEMO_PERFORMANCE : rawData;

        if (!sourceData || !Array.isArray(sourceData) || sourceData.length === 0) return [];

        const sortedData = [...sourceData].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const monthEndValues = new Map<string, number>();
        const yearsSet = new Set<number>();

        sortedData.forEach((point: any) => {
            const dateStr = point.date.split('T')[0]; 
            const [y, m] = dateStr.split('-'); 
            const key = `${y}-${m}`; 
            
            yearsSet.add(parseInt(y));
            monthEndValues.set(key, point.wallet);
        });

        const years = Array.from(yearsSet).sort((a, b) => b - a); 
        const rows: YearRow[] = [];

        let lastYearCloseValue = 0; 

        years.reverse().forEach(year => { 
            const months: MonthData[] = [];
            
            for (let m = 1; m <= 12; m++) {
                const monthKey = `${year}-${String(m).padStart(2, '0')}`;
                const prevMonthKey = `${m === 1 ? year - 1 : year}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
                
                const currentValue = monthEndValues.get(monthKey);
                let prevValue = monthEndValues.get(prevMonthKey);
                
                if (prevValue === undefined) {
                    if (m === 1) prevValue = lastYearCloseValue;
                    else prevValue = undefined; 
                }

                if (currentValue !== undefined) {
                    if (prevValue === undefined) {
                        const firstDataPoint: any = sortedData[0];
                        const firstDate = new Date(firstDataPoint.date);
                        // Ajuste para pegar mês correto (getMonth é 0-index)
                        if (firstDate.getFullYear() === year && (firstDate.getMonth() + 1) === m) {
                            prevValue = 0; 
                        }
                    }

                    if (prevValue !== undefined) {
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

            const lastMonthWithData = [...months].reverse().find(m => m.value !== null);
            const lastVal = monthEndValues.get(`${year}-12`) || Array.from(monthEndValues.entries()).filter(([k]) => k.startsWith(`${year}-`)).pop()?.[1];
            
            let ytd = 0;
            if (lastVal !== undefined) {
                const startVal = lastYearCloseValue;
                const factorEnd = 1 + (lastVal / 100);
                const factorStart = 1 + (startVal / 100);
                ytd = ((factorEnd / factorStart) - 1) * 100;
            }

            const decValue = monthEndValues.get(`${year}-12`);
            if (decValue !== undefined) lastYearCloseValue = decValue;
            else lastYearCloseValue = lastVal || 0;

            const accumulatedTotal = lastVal !== undefined ? lastVal : 0;

            rows.push({
                year,
                months,
                ytd,
                accumulated: accumulatedTotal
            });
        });

        return rows.reverse(); 
    }, [rawData, isDemoMode]);

    const formatPercent = (val: number | null) => {
        if (val === null) return '-';
        if (isPrivacyMode && !isDemoMode) return '•••';
        return `${val > 0 ? '+' : ''}${val.toFixed(2)}%`;
    };

    const getColor = (val: number | null) => {
        if (val === null) return 'text-slate-600';
        if (val > 0) return 'text-emerald-400';
        if (val < 0) return 'text-red-400';
        return 'text-slate-400'; 
    };

    if (isLoading && !isDemoMode) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[200px] flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-500" />
            </div>
        );
    }

    if (tableData.length === 0) {
        return null; 
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
