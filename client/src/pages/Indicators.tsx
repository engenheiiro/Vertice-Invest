
import React, { useEffect, useState } from 'react';
import { Header } from '../components/dashboard/Header';
import { researchService } from '../services/research';
import { Activity, TrendingUp, TrendingDown, RefreshCw, Layers, Calendar, DollarSign, Percent, ShieldCheck } from 'lucide-react';

export const Indicators = () => {
    const [data, setData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const result = await researchService.getMacroData();
            setData(result);
        } catch (error) {
            console.error("Erro ao carregar indicadores", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // Formatações
    const fmtPct = (val: number) => val ? `${val.toFixed(2)}%` : '-';
    const fmtCurrency = (val: number) => val ? `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main className="max-w-[1600px] mx-auto p-6 animate-fade-in">
                
                {/* Header Section */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                            <Activity className="text-blue-500" />
                            Painel de Indicadores
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">Monitoramento em tempo real dos principais índices e taxas.</p>
                    </div>
                    <button 
                        onClick={loadData}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-all border border-slate-700"
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                        Atualizar
                    </button>
                </div>

                {/* --- GRID INDICADORES MACRO --- */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-10">
                    <IndicatorCard 
                        label="SELIC" 
                        value={data?.selic?.value} 
                        suffix="%" 
                        desc="Meta BCB" 
                        color="text-emerald-400" 
                        icon={<TargetIcon />} 
                    />
                    <IndicatorCard 
                        label="CDI" 
                        value={data?.cdi?.value} 
                        suffix="%" 
                        desc="Taxa DI" 
                        color="text-emerald-400" 
                        icon={<TrendingUp size={16} />} 
                    />
                    <IndicatorCard 
                        label="IPCA (12m)" 
                        value={data?.ipca?.value} 
                        suffix="%" 
                        desc="Inflação" 
                        color="text-yellow-400" 
                        icon={<Percent size={16} />} 
                    />
                    <IndicatorCard 
                        label="Ibovespa" 
                        value={data?.ibov?.value} 
                        isCurrency={false} 
                        desc="Pts" 
                        change={data?.ibov?.change} 
                    />
                    <IndicatorCard 
                        label="Dólar PTAX" 
                        value={data?.usd?.value} 
                        isCurrency={true} 
                        desc="BRL/USD" 
                        change={data?.usd?.change} 
                    />
                    <IndicatorCard 
                        label="S&P 500" 
                        value={data?.spx?.value} 
                        isCurrency={false} 
                        desc="US Pts" 
                        change={data?.spx?.change} 
                    />
                    <IndicatorCard 
                        label="Bitcoin" 
                        value={data?.btc?.value} 
                        isCurrency={true} 
                        currencyPrefix="$"
                        desc="USD" 
                        color="text-purple-400" 
                        change={data?.btc?.change} 
                    />
                </div>

                {/* --- MESA DE RENDA FIXA (TESOURO DIRETO) --- */}
                <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                    <div className="p-6 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800">
                                <ShieldCheck size={20} className="text-emerald-500" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white uppercase tracking-wide">Mesa de Renda Fixa</h2>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                    Títulos do Tesouro Nacional
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead className="bg-[#0F131E] text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                <tr>
                                    <th className="px-6 py-4">Título</th>
                                    <th className="px-6 py-4">Tipo</th>
                                    <th className="px-6 py-4 text-right">Rentabilidade Anual</th>
                                    <th className="px-6 py-4 text-right">Investimento Mín.</th>
                                    <th className="px-6 py-4 text-right">Vencimento</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50 text-sm">
                                {data?.bonds?.length > 0 ? (
                                    data.bonds.map((bond: any) => (
                                        <tr key={bond._id} className="hover:bg-slate-900/40 transition-colors group">
                                            <td className="px-6 py-4 font-bold text-slate-200 group-hover:text-white">
                                                {bond.title}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`text-[10px] px-2 py-1 rounded font-bold uppercase ${getBondTypeStyle(bond.type)}`}>
                                                    {bond.type}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right font-mono font-bold text-emerald-400">
                                                {bond.index === 'PRE' ? '' : bond.index + ' + '}{bond.rate.toFixed(2)}%
                                            </td>
                                            <td className="px-6 py-4 text-right text-slate-300">
                                                {fmtCurrency(bond.minInvestment)}
                                            </td>
                                            <td className="px-6 py-4 text-right text-slate-400 font-medium">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Calendar size={14} />
                                                    {bond.maturityDate}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="p-8 text-center text-slate-500">
                                            {isLoading ? 'Carregando títulos...' : 'Nenhum título disponível no momento.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </main>
        </div>
    );
};

// Componentes Auxiliares

const IndicatorCard = ({ label, value, suffix = '', desc, color = 'text-white', icon, isCurrency, currencyPrefix = 'R$', change }: any) => (
    <div className="bg-[#080C14] border border-slate-800 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition-colors relative overflow-hidden group">
        <div className="flex justify-between items-start mb-2 relative z-10">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
            {icon && <div className="text-slate-600">{icon}</div>}
        </div>
        
        <div className="relative z-10">
            <h3 className={`text-xl font-black ${color} tracking-tight`}>
                {isCurrency 
                    ? `${currencyPrefix} ${value?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) || '0,00'}` 
                    : value?.toLocaleString('pt-BR') || '0.00'
                }
                {suffix}
            </h3>
            
            <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-slate-600 font-medium">{desc}</span>
                {change !== undefined && (
                    <span className={`text-[10px] font-bold flex items-center ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {change >= 0 ? <TrendingUp size={10} className="mr-1" /> : <TrendingDown size={10} className="mr-1" />}
                        {Math.abs(change).toFixed(2)}%
                    </span>
                )}
            </div>
        </div>

        {/* Background Glow */}
        <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-slate-800/50 rounded-full blur-[40px] group-hover:bg-slate-700/50 transition-colors"></div>
    </div>
);

const TargetIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="6"></circle>
        <circle cx="12" cy="12" r="2"></circle>
    </svg>
);

const getBondTypeStyle = (type: string) => {
    switch(type) {
        case 'IPCA': return 'bg-purple-900/30 text-purple-400 border border-purple-900/50';
        case 'SELIC': return 'bg-blue-900/30 text-blue-400 border border-blue-900/50';
        case 'PREFIXADO': return 'bg-emerald-900/30 text-emerald-400 border border-emerald-900/50';
        case 'RENDAMAIS': return 'bg-amber-900/30 text-amber-400 border border-amber-900/50';
        case 'EDUCA': return 'bg-pink-900/30 text-pink-400 border border-pink-900/50';
        default: return 'bg-slate-800 text-slate-400';
    }
};
