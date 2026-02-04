
import React, { useEffect, useState, useMemo } from 'react';
import { walletService } from '../../services/wallet';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Coins, CalendarCheck, TrendingUp, AlertCircle, CheckCircle2, Clock, Calculator } from 'lucide-react';

interface DividendData {
    history: { 
        month: string; 
        value: number;
        breakdown?: { ticker: string; amount: number }[];
    }[];
    provisioned: { ticker: string; date: string; amount: number }[];
    totalAllTime?: number; 
    projectedMonthly?: number; 
}

export const DividendDashboard = () => {
    const [data, setData] = useState<DividendData>({ history: [], provisioned: [], totalAllTime: 0, projectedMonthly: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [timeRange, setTimeRange] = useState<'12M' | 'ALL'>('12M'); // Filtro Temporal

    useEffect(() => {
        const load = async () => {
            try {
                const res = await walletService.getDividends();
                
                let cleanHistory = Array.isArray(res?.history) ? res.history : [];
                // Remove meses zerados iniciais para limpar o gráfico
                while(cleanHistory.length > 0 && cleanHistory[0].value === 0) {
                    cleanHistory.shift();
                }

                setData({
                    history: cleanHistory,
                    provisioned: Array.isArray(res?.provisioned) ? res.provisioned : [],
                    totalAllTime: res?.totalAllTime || 0,
                    projectedMonthly: res?.projectedMonthly || 0
                });
            } catch (e) {
                console.error("Erro ao carregar dividendos", e);
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, []);

    // Lógica de Filtragem dos Dados do Gráfico
    const filteredHistory = useMemo(() => {
        if (timeRange === '12M') {
            return data.history.slice(-12);
        }
        return data.history;
    }, [data.history, timeRange]);

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

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const dataPoint = payload[0].payload;
            const breakdown = dataPoint.breakdown || [];
            
            const parts = label.split('-'); // YYYY-MM
            let formattedLabel = label;
            if (parts.length === 2) {
                const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, 1);
                formattedLabel = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                formattedLabel = formattedLabel.charAt(0).toUpperCase() + formattedLabel.slice(1);
            }

            return (
                <div className="bg-[#0F1729] border border-[#D4AF37] rounded-lg p-3 shadow-xl min-w-[180px] z-50">
                    <p className="text-xs text-[#D4AF37] font-bold uppercase mb-2 border-b border-[#D4AF37]/30 pb-1">
                        {formattedLabel}
                    </p>
                    <div className="space-y-1 mb-2">
                        {breakdown.map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-[10px] text-slate-300">
                                <span>{item.ticker}</span>
                                <span className="font-mono">{formatCurrency(item.amount)}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-between border-t border-[#D4AF37]/30 pt-1">
                        <span className="text-xs text-white font-bold">Total</span>
                        <span className="text-xs text-[#D4AF37] font-mono font-bold">{formatCurrency(dataPoint.value)}</span>
                    </div>
                </div>
            );
        }
        return null;
    };

    if (isLoading) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 h-[300px] animate-pulse"></div>
        );
    }

    // Ajuste da largura do gráfico para scroll horizontal se muitos dados
    const contentWidth = Math.max(100, filteredHistory.length * 60); 

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            
            {/* COLUNA 1: Gráfico de Barras */}
            <div className="lg:col-span-2 bg-[#080C14] border border-slate-800 rounded-2xl p-6 relative overflow-hidden flex flex-col">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                    <div>
                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                            <Coins size={16} className="text-[#D4AF37]" />
                            Evolução de Proventos
                        </h3>
                        <p className="text-xs text-slate-500">Histórico de Pagamentos</p>
                    </div>
                    
                    {/* Filtro Temporal */}
                    <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                        <button
                            onClick={() => setTimeRange('12M')}
                            className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                timeRange === '12M' 
                                ? 'bg-[#D4AF37]/20 text-[#D4AF37] shadow-sm border border-[#D4AF37]/50' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            12 Meses
                        </button>
                        <button
                            onClick={() => setTimeRange('ALL')}
                            className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                timeRange === 'ALL' 
                                ? 'bg-[#D4AF37]/20 text-[#D4AF37] shadow-sm border border-[#D4AF37]/50' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            Desde o Início
                        </button>
                    </div>
                </div>

                <div className="flex-1 w-full text-xs min-h-[200px] overflow-x-auto custom-scrollbar">
                    {filteredHistory.length > 0 ? (
                        <div style={{ width: `${contentWidth}px`, minWidth: '100%', height: '100%' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={filteredHistory} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
                                            const m = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
                                            const y = date.toLocaleDateString('pt-BR', { year: '2-digit' });
                                            return `${m}/${y}`;
                                        }}
                                        minTickGap={10}
                                        interval={0} 
                                    />
                                    <Tooltip content={<CustomTooltip />} cursor={{fill: '#1e293b', opacity: 0.4}} />
                                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                        {filteredHistory.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={index === filteredHistory.length - 1 ? '#D4AF37' : '#334155'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                            Sem histórico de dividendos para este período.
                        </div>
                    )}
                </div>
            </div>

            {/* COLUNA 2: Lista de Provisões ou Estimativa */}
            <div className="lg:col-span-1 bg-[#080C14] border border-slate-800 rounded-2xl p-6 flex flex-col">
                <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-800">
                    <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <CalendarCheck size={16} className="text-emerald-500" />
                            Provisões Futuras
                        </h3>
                    </div>
                    {/* Se tiver provisão real, mostra ela. Se não, mostra 0 ou estimativa */}
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
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-6">
                            <div className="p-3 bg-slate-900 rounded-full border border-slate-800">
                                <Calculator size={24} className="text-slate-500" />
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 mb-1">Nenhuma provisão confirmada.</p>
                                {data.projectedMonthly && data.projectedMonthly > 0 ? (
                                    <>
                                        <p className="text-[10px] text-slate-500 mb-2">Baseado no Yield do seu portfólio, estimamos:</p>
                                        <p className="text-sm font-bold text-white bg-slate-800 px-3 py-1 rounded-lg border border-slate-700 inline-block">
                                            ~ {formatCurrency(data.projectedMonthly)} / mês
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-[10px] text-slate-600">Adicione ativos pagadores de dividendos.</p>
                                )}
                            </div>
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
