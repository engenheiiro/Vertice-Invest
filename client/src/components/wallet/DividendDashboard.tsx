
import React, { useEffect, useState } from 'react';
import { walletService } from '../../services/wallet';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Coins, CalendarCheck, TrendingUp, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

interface DividendData {
    history: { month: string; value: number }[];
    provisioned: { ticker: string; date: string; amount: number }[];
    totalAllTime?: number; 
}

export const DividendDashboard = () => {
    const [data, setData] = useState<DividendData>({ history: [], provisioned: [], totalAllTime: 0 });
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await walletService.getDividends();
                setData({
                    history: Array.isArray(res?.history) ? res.history : [],
                    provisioned: Array.isArray(res?.provisioned) ? res.provisioned : [],
                    totalAllTime: res?.totalAllTime || 0
                });
            } catch (e) {
                console.error("Erro ao carregar dividendos", e);
                setData({ history: [], provisioned: [], totalAllTime: 0 });
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, []);

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const totalReceived = data.totalAllTime !== undefined 
        ? data.totalAllTime 
        : data.history.reduce((acc, curr) => acc + (curr.value || 0), 0);
        
    const totalProvisioned = data.provisioned.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const isDatePassed = (dateStr: string) => {
        const today = new Date();
        today.setHours(0,0,0,0);
        const target = new Date(dateStr);
        return target <= today;
    };

    if (isLoading) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[300px] animate-pulse"></div>
        );
    }

    const contentWidth = Math.max(100, data.history.length * 50); 

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            
            {/* COLUNA 1: Gráfico de Barras */}
            <div className="lg:col-span-2 bg-[#080C14] border border-slate-800 rounded-2xl p-6 relative overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                            <Coins size={16} className="text-[#D4AF37]" />
                            Evolução de Proventos
                        </h3>
                        <p className="text-xs text-slate-500">Histórico Completo</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] uppercase font-bold text-slate-500">Total Acumulado</p>
                        <p className="text-lg font-mono font-bold text-[#D4AF37]">{formatCurrency(totalReceived)}</p>
                    </div>
                </div>

                <div className="flex-1 w-full text-xs min-h-[200px] overflow-x-auto custom-scrollbar">
                    {data.history.length > 0 ? (
                        <div style={{ width: `${contentWidth}px`, minWidth: '100%', height: '100%' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.history} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <XAxis 
                                        dataKey="month" 
                                        tick={{fill: '#64748b', fontSize: 10}} 
                                        axisLine={false} 
                                        tickLine={false}
                                        tickFormatter={(val) => {
                                            if (!val) return '';
                                            const parts = val.split('-');
                                            if (parts.length < 2) return val;
                                            const date = new Date(parseInt(parts[0]), parseInt(parts[1])-1, 1);
                                            return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
                                        }}
                                        minTickGap={10}
                                        interval={0} 
                                    />
                                    <Tooltip 
                                        cursor={{fill: '#1e293b', opacity: 0.4}}
                                        contentStyle={{ backgroundColor: '#0F1729', borderColor: '#D4AF37', borderRadius: '8px' }}
                                        itemStyle={{ color: '#D4AF37' }}
                                        formatter={(value: number) => [formatCurrency(value), 'Recebido']}
                                    />
                                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                        {data.history.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={index === data.history.length - 1 ? '#D4AF37' : '#334155'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                            Sem histórico de dividendos ainda.
                        </div>
                    )}
                </div>
            </div>

            {/* COLUNA 2: Lista de Provisões */}
            <div className="lg:col-span-1 bg-[#080C14] border border-slate-800 rounded-2xl p-6 flex flex-col">
                <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-800">
                    <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <CalendarCheck size={16} className="text-emerald-500" />
                            Provisões
                        </h3>
                    </div>
                    <span className="text-xs font-bold text-emerald-500 bg-emerald-900/20 px-2 py-0.5 rounded border border-emerald-900/50">
                        {formatCurrency(totalProvisioned)}
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 max-h-[220px]">
                    {data.provisioned.length > 0 ? (
                        data.provisioned.map((item, idx) => {
                            const received = isDatePassed(item.date);
                            
                            return (
                                <div key={idx} className="flex items-center justify-between p-3 bg-[#0F131E] rounded-xl border border-slate-800/50">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300 border border-slate-700">
                                            {item.ticker ? item.ticker.substring(0, 4) : 'DIV'}
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-white">{item.ticker}</p>
                                            <p className="text-[10px] text-slate-500">
                                                {item.date ? new Date(item.date).toLocaleDateString('pt-BR') : '-'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-bold text-emerald-400">+{formatCurrency(item.amount)}</p>
                                        
                                        {received ? (
                                            <span className="text-[9px] text-emerald-500 flex items-center justify-end gap-1 font-bold">
                                                <CheckCircle2 size={10} /> Creditado
                                            </span>
                                        ) : (
                                            <span className="text-[9px] text-blue-400 flex items-center justify-end gap-1 font-bold">
                                                <Clock size={10} /> Agendado
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-center py-10 opacity-50">
                            <AlertCircle size={24} className="mx-auto mb-2 text-slate-600" />
                            <p className="text-xs text-slate-500">Nenhuma provisão encontrada.</p>
                        </div>
                    )}
                </div>
                
                <div className="mt-4 pt-3 border-t border-slate-800">
                    <p className="text-[9px] text-slate-500 text-center flex items-center justify-center gap-1">
                        <TrendingUp size={10} />
                        Reinvestir dividendos gera juros compostos.
                    </p>
                </div>
            </div>

        </div>
    );
};
