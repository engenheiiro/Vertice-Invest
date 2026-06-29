
import React, { useEffect, useState, useMemo } from 'react';
import { walletService } from '../../services/wallet';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, YAxis, CartesianGrid } from 'recharts';
import { Coins, CalendarCheck, TrendingUp, CheckCircle2, Clock, Calculator, Award } from 'lucide-react';
import { useDemo } from '../../contexts/DemoContext';
import { useWallet } from '../../contexts/WalletContext';
import { DEMO_DIVIDENDS } from '../../data/DEMO_DATA';
import { formatCurrency as fmtCurrency, formatCompact } from '../../utils/format';
import AssetLogo from '../common/AssetLogo';
import { DividendGoal, YieldOnCostItem } from '../../types/dividends';
import { simulateReinvestment } from '../../utils/dividendSimulator';

interface DividendData {
    history: {
        month: string;
        value: number;
        breakdown?: { ticker: string; amount: number }[];
    }[];
    provisioned: { ticker: string; date: string; amount: number }[];
    totalAllTime?: number;
    projectedMonthly?: number;
    yieldOnCost?: YieldOnCostItem[];
    goal?: DividendGoal | null;
}

const SIMULATOR_PERIODS = [5, 10, 20, 30] as const;

export const DividendDashboard = () => {
    const [data, setData] = useState<DividendData>({ history: [], provisioned: [], totalAllTime: 0, projectedMonthly: 0, yieldOnCost: [], goal: null });
    const [isLoading, setIsLoading] = useState(true);
    const [timeRange, setTimeRange] = useState<'12M' | 'ALL'>('12M');
    const [simulatorYears, setSimulatorYears] = useState<number>(10);
    const [simulatorContribution, setSimulatorContribution] = useState<string>('0');

    const { isDemoMode } = useDemo();
    const { kpis } = useWallet();

    useEffect(() => {
        const load = async () => {
            if (isDemoMode) {
                // Simula delay e carrega dados estáticos
                setTimeout(() => {
                    setData(DEMO_DIVIDENDS);
                    setIsLoading(false);
                }, 600);
                return;
            }

            try {
                const res = await walletService.getDividends();
                const cleanHistory = Array.isArray(res?.history) ? res.history : [];
                while(cleanHistory.length > 0 && cleanHistory[0].value === 0) {
                    cleanHistory.shift();
                }

                setData({
                    history: cleanHistory,
                    provisioned: Array.isArray(res?.provisioned) ? res.provisioned : [],
                    totalAllTime: res?.totalAllTime || 0,
                    projectedMonthly: res?.projectedMonthly || 0,
                    yieldOnCost: Array.isArray(res?.yieldOnCost) ? res.yieldOnCost : [],
                    goal: res?.goal ?? null,
                });
            } catch (e) {
                console.error("Erro ao carregar dividendos", e);
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, [isDemoMode]);

    const filteredHistory = useMemo(() => {
        if (timeRange === '12M') {
            return data.history.slice(-12);
        }
        return data.history;
    }, [data.history, timeRange]);

    const formatCurrency = (val: number) => fmtCurrency(val);

    const totalProvisioned = data.provisioned.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const sortedYieldOnCost = useMemo(
        () => [...(data.yieldOnCost || [])].sort((a, b) => b.yocPercent - a.yocPercent),
        [data.yieldOnCost],
    );

    // Yield mensal médio do portfólio, derivado da projeção já calculada pelo
    // backend — sem nova chamada de API. Base de patrimônio: equity total da
    // carteira (proxy razoável de "ativos pagadores" sem exigir uma nova
    // integração para isolar só os holdings que distribuem proventos).
    const monthlyYieldRate = kpis.totalEquity > 0 ? (data.projectedMonthly || 0) / kpis.totalEquity : 0;

    const simulation = useMemo(() => simulateReinvestment({
        initialEquity: kpis.totalEquity || 0,
        monthlyYieldRate,
        years: simulatorYears,
        monthlyContribution: parseFloat(simulatorContribution) || 0,
    }), [kpis.totalEquity, monthlyYieldRate, simulatorYears, simulatorContribution]);

    const simulationChartData = useMemo(() => simulation.withReinvestment.map((value, idx) => ({
        month: idx,
        comReinvestimento: value,
        semReinvestimento: simulation.withoutReinvestment[idx],
    })), [simulation]);

    const finalWithReinvestment = simulation.withReinvestment[simulation.withReinvestment.length - 1] || 0;
    const finalWithoutReinvestment = simulation.withoutReinvestment[simulation.withoutReinvestment.length - 1] || 0;
    const reinvestmentDelta = finalWithReinvestment - finalWithoutReinvestment;

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
            
            const parts = label.split('-'); 
            let formattedLabel = label;
            if (parts.length === 2) {
                const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, 1);
                formattedLabel = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                formattedLabel = formattedLabel.charAt(0).toUpperCase() + formattedLabel.slice(1);
            }

            return (
                <div className="bg-elevated border border-gold rounded-lg p-3 shadow-xl min-w-[180px] z-50">
                    <p className="text-xs text-gold font-bold uppercase mb-2 border-b border-gold/30 pb-1">
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
                    <div className="flex justify-between border-t border-gold/30 pt-1">
                        <span className="text-xs text-white font-bold">Total</span>
                        <span className="text-xs text-gold font-mono font-bold">{formatCurrency(dataPoint.value)}</span>
                    </div>
                </div>
            );
        }
        return null;
    };

    if (isLoading) {
        return (
            <div className="bg-base border border-slate-800 rounded-2xl p-6 h-[300px] animate-pulse"></div>
        );
    }

    const contentWidth = Math.max(100, filteredHistory.length * 60); 

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            
            <div className="lg:col-span-2 bg-base border border-slate-800 rounded-2xl p-6 relative overflow-hidden flex flex-col">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                    <div>
                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                            <Coins size={16} className="text-gold" />
                            Evolução de Proventos
                        </h3>
                        <p className="text-xs text-slate-500">Histórico de Pagamentos</p>
                    </div>
                    
                    <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                        <button
                            onClick={() => setTimeRange('12M')}
                            className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                timeRange === '12M' 
                                ? 'bg-gold/20 text-gold shadow-sm border border-gold/50' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            12 Meses
                        </button>
                        <button
                            onClick={() => setTimeRange('ALL')}
                            className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                timeRange === 'ALL' 
                                ? 'bg-gold/20 text-gold shadow-sm border border-gold/50' 
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

            <div className="lg:col-span-1 bg-base border border-slate-800 rounded-2xl p-6 flex flex-col">
                <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-800">
                    <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <CalendarCheck size={16} className="text-emerald-500" />
                            Provisões Futuras
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
                                <div key={idx} className="flex items-center justify-between p-3 bg-panel rounded-xl border border-slate-800/50">
                                    <div className="flex items-center gap-3">
                                        <AssetLogo ticker={item.ticker || 'DIV'} name={item.ticker} size={32} />
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
            </div>

            {/* Yield on Cost por ativo */}
            <div className="lg:col-span-1 bg-base border border-slate-800 rounded-2xl p-6 flex flex-col">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
                    <Award size={16} className="text-gold" />
                    Yield on Cost
                </h3>
                <p className="text-xs text-slate-500 mb-4">Recebido em 12m ÷ custo investido, por ativo</p>

                {sortedYieldOnCost.length > 0 ? (
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 max-h-[260px]">
                        {sortedYieldOnCost.map((item) => (
                            <div key={item.ticker} className="flex items-center justify-between p-2.5 bg-panel rounded-xl border border-slate-800/50">
                                <div className="flex items-center gap-2">
                                    <AssetLogo ticker={item.ticker} name={item.ticker} size={24} />
                                    <span className="text-xs font-bold text-white">{item.ticker}</span>
                                </div>
                                <span className="text-xs font-bold text-gold">{item.yocPercent.toFixed(2)}% a.a.</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-center text-xs text-slate-600 py-6">
                        Ainda sem proventos recebidos nos últimos 12 meses.
                    </div>
                )}
            </div>

            {/* Simulador de Reinvestimento */}
            <div className="lg:col-span-2 bg-base border border-slate-800 rounded-2xl p-6 flex flex-col">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                    <div>
                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                            <TrendingUp size={16} className="text-emerald-500" />
                            Simulador de Reinvestimento
                        </h3>
                        <p className="text-xs text-slate-500">Efeito de reinvestir os proventos vs. retirá-los</p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                            {SIMULATOR_PERIODS.map((y) => (
                                <button
                                    key={y}
                                    onClick={() => setSimulatorYears(y)}
                                    className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${
                                        simulatorYears === y
                                        ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/50'
                                        : 'text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                    {y} anos
                                </button>
                            ))}
                        </div>
                        <div className="relative">
                            <span className="absolute left-2 top-1.5 text-[10px] text-slate-500">R$</span>
                            <input
                                type="number"
                                min="0"
                                value={simulatorContribution}
                                onChange={(e) => setSimulatorContribution(e.target.value)}
                                onWheel={(e) => e.currentTarget.blur()}
                                placeholder="Aporte/mês"
                                className="w-28 bg-card border border-slate-800 rounded px-2 pl-7 py-1.5 text-[10px] text-white focus:border-emerald-500 outline-none font-mono"
                            />
                        </div>
                    </div>
                </div>

                <div className="h-[180px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={simulationChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                            <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}
                                tickFormatter={(m) => `${Math.round(m / 12)}a`} />
                            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}
                                tickFormatter={(v) => formatCompact(v)} width={50} />
                            <Tooltip
                                formatter={(value: number) => formatCurrency(value)}
                                labelFormatter={(m) => `Mês ${m}`}
                                contentStyle={{ backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '11px' }}
                            />
                            <Area type="monotone" dataKey="comReinvestimento" name="Reinvestindo" stroke="#10B981" fill="#10B981" fillOpacity={0.15} strokeWidth={2} />
                            <Area type="monotone" dataKey="semReinvestimento" name="Sem reinvestir" stroke="#64748b" fill="#64748b" fillOpacity={0.08} strokeWidth={2} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                    Reinvestindo, em {simulatorYears} anos seu patrimônio seria de <span className="text-emerald-400 font-bold">{formatCurrency(finalWithReinvestment)}</span>,
                    contra <span className="text-slate-300 font-bold">{formatCurrency(finalWithoutReinvestment)}</span> sem reinvestir —
                    uma diferença de <span className="text-emerald-400 font-bold">{formatCurrency(reinvestmentDelta)}</span>.
                </p>
                <p className="text-[9px] text-slate-600 mt-2">
                    Projeção hipotética com yield constante baseado no fluxo atual de proventos — não é garantia de rentabilidade futura.
                </p>
            </div>

        </div>
    );
};
