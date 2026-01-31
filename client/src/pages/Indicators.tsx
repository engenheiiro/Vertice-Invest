
import React, { useEffect, useState, useMemo } from 'react';
import { Header } from '../components/dashboard/Header';
import { researchService } from '../services/research';
import { Activity, TrendingUp, TrendingDown, RefreshCw, ShieldCheck, Database, ArrowUpDown, Target, Percent, ChevronUp, ChevronDown, Landmark, Filter } from 'lucide-react';

type SortKey = 'title' | 'type' | 'rate' | 'minInvestment' | 'maturityDate';
type FilterType = 'ALL' | 'IPCA' | 'PREFIXADO' | 'SELIC' | 'OUTROS';

// LISTA ATUALIZADA - DAY AFTER
const POPULAR_CDB_LCI = [
    { _id: 'sofisa', title: 'Sofisa Direto', type: 'CDB', rate: 110, index: 'CDI', minInvestment: 1.00, issuer: 'Sofisa', maturity: 'Imediata' },
    { _id: 'nu_reserva', title: 'Nubank (Caixinha Reserva)', type: 'RDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'Nubank', maturity: 'Imediata' },
    { _id: 'nu_turbo', title: 'Nubank (Caixinha Turbo)', type: 'RDB', rate: 115, index: 'CDI', minInvestment: 1.00, issuer: 'Nubank', maturity: 'Imediata (Max 5k)' },
    { _id: 'inter', title: 'Banco Inter (Meu Porquinho)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'Banco Inter', maturity: 'Imediata' },
    { _id: 'mp', title: 'Mercado Pago (Conta)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'Mercado Pago', maturity: 'Imediata' },
    { _id: 'picpay', title: 'PicPay (Cofrinhos)', type: 'CDB', rate: 102, index: 'CDI', minInvestment: 1.00, issuer: 'PicPay', maturity: 'Imediata' },
    { _id: 'pagbank', title: 'PagBank (Conta Rendeira)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'PagBank', maturity: 'Imediata' },
    { _id: 'itau', title: 'Itaú (Iti)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'Itaú', maturity: 'Imediata' },
    { _id: '99pay', title: '99Pay (Lucrativa)', type: 'CDB', rate: 110, index: 'CDI', minInvestment: 1.00, issuer: '99Pay', maturity: 'Imediata (Limitada)' },
    { _id: 'c6', title: 'C6 Bank (CDB Cartão)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 100.00, issuer: 'C6 Bank', maturity: 'Imediata' }
];

export const Indicators = () => {
    const [data, setData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'type', direction: 'asc' });
    const [filterType, setFilterType] = useState<FilterType>('ALL');
    
    const [isTreasuryOpen, setIsTreasuryOpen] = useState(false);
    const [isPrivateFixedOpen, setIsPrivateFixedOpen] = useState(false); // ALTERAÇÃO: Inicia fechado (collapsed)

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

    const handleSort = (key: SortKey) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedBonds = useMemo(() => {
        if (!data?.bonds) return [];
        
        let filtered = data.bonds;
        if (filterType !== 'ALL') {
            if (filterType === 'OUTROS') {
                filtered = filtered.filter((b: any) => !['IPCA', 'PREFIXADO', 'SELIC'].includes(b.type));
            } else {
                filtered = filtered.filter((b: any) => b.type === filterType);
            }
        }

        return [...filtered].sort((a: any, b: any) => {
            if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
            if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data?.bonds, sortConfig, filterType]);

    const fmtCurrency = (val: number) => val ? `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main className="max-w-[1600px] mx-auto p-6 animate-fade-in">
                {/* Header e Grid de Indicadores */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                            <Activity className="text-blue-500" />
                            Painel de Indicadores
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">Monitoramento em tempo real dos principais índices e taxas.</p>
                        <p className="text-slate-600 text-[10px] mt-0.5">* Atualização automática a cada 15 minutos.</p>
                    </div>
                    <button 
                        onClick={loadData}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-all border border-slate-700"
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                        {isLoading ? 'Atualizando...' : 'Atualizar Dados'}
                    </button>
                </div>

                {/* Resto do componente mantido... */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-10">
                    <IndicatorCard label="SELIC" value={data?.selic?.value} suffix="%" desc="Meta BCB" color="text-emerald-400" icon={<Target size={16} />} />
                    <IndicatorCard label="CDI" value={data?.cdi?.value} suffix="%" desc="Taxa DI" color="text-emerald-400" icon={<TrendingUp size={16} />} />
                    <IndicatorCard label="IPCA (12m)" value={data?.ipca?.value} suffix="%" desc="Inflação" color="text-yellow-400" icon={<Percent size={16} />} />
                    
                    <IndicatorCard label="Ibovespa" value={data?.ibov?.value} isCurrency={false} desc="Pts" change={data?.ibov?.change} />
                    <IndicatorCard label="Dólar PTAX" value={data?.usd?.value} isCurrency={true} desc="BRL/USD" change={data?.usd?.change} />
                    <IndicatorCard label="S&P 500" value={data?.spx?.value} isCurrency={false} desc="US Pts" change={data?.spx?.change} />
                    <IndicatorCard label="Bitcoin" value={data?.btc?.value} isCurrency={true} currencyPrefix="$" desc="USD" color="text-purple-400" change={data?.btc?.change} />
                </div>

                {/* --- CONTÊINER 1: TESOURO DIRETO --- */}
                <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative z-0 mb-6">
                    <div 
                        className="p-6 border-b border-slate-800 bg-[#0B101A] flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-[#0F131E] transition-colors"
                        onClick={() => setIsTreasuryOpen(!isTreasuryOpen)}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800">
                                <ShieldCheck size={20} className="text-emerald-500" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white uppercase tracking-wide">Tesouro Direto</h2>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-1">
                                    <Database size={10} /> Base Oficial: {data?.bonds?.length || 0} Títulos
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            {isTreasuryOpen && (
                                <div className="hidden md:flex items-center gap-2 bg-slate-900/50 p-1 rounded-lg border border-slate-800 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                                    <Filter size={14} className="text-slate-500 ml-2" />
                                    {['ALL', 'IPCA', 'PREFIXADO', 'SELIC'].map((ft) => (
                                        <button
                                            key={ft}
                                            onClick={() => setFilterType(ft as FilterType)}
                                            className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${
                                                filterType === ft 
                                                ? 'bg-blue-600 text-white shadow-lg' 
                                                : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                            }`}
                                        >
                                            {ft === 'ALL' ? 'Todos' : ft}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
                                {isTreasuryOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                        </div>
                    </div>

                    {isTreasuryOpen && (
                        <div className="overflow-x-auto relative z-10 animate-fade-in">
                            <table className="w-full text-left border-collapse min-w-[800px]">
                                <thead className="bg-[#0F131E] text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-30 shadow-sm">
                                    <tr>
                                        <SortableHeader label="Título Público" sortKey="title" currentSort={sortConfig} onSort={handleSort} align="left" />
                                        <SortableHeader label="Tipo" sortKey="type" currentSort={sortConfig} onSort={handleSort} align="left" />
                                        <SortableHeader label="Rentabilidade Anual" sortKey="rate" currentSort={sortConfig} onSort={handleSort} align="right" />
                                        <SortableHeader label="Investimento Mín." sortKey="minInvestment" currentSort={sortConfig} onSort={handleSort} align="right" />
                                        <SortableHeader label="Vencimento" sortKey="maturityDate" currentSort={sortConfig} onSort={handleSort} align="right" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50 text-sm">
                                    {sortedBonds.length > 0 ? (
                                        sortedBonds.map((bond: any) => (
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
                                                    {bond.maturityDate}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={5} className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
                                                <Database size={32} className="mb-2 opacity-50" />
                                                <p className="font-bold">Base de dados sincronizando...</p>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* --- CONTÊINER 2: CDBS & COFRINHOS --- */}
                <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative z-0">
                    <div 
                        className="p-6 border-b border-slate-800 bg-[#0B101A] flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-[#0F131E] transition-colors"
                        onClick={() => setIsPrivateFixedOpen(!isPrivateFixedOpen)}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800">
                                <Landmark size={20} className="text-blue-500" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white uppercase tracking-wide">CDBs, Caixinhas & Cofrinhos</h2>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-1">
                                    <Database size={10} /> Bancos Digitais & Corretoras
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
                                {isPrivateFixedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                        </div>
                    </div>

                    {isPrivateFixedOpen && (
                        <div className="overflow-x-auto relative z-10 animate-fade-in">
                            <table className="w-full text-left border-collapse min-w-[800px]">
                                <thead className="bg-[#0F131E] text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-30 shadow-sm">
                                    <tr>
                                        <th className="px-6 py-4">Produto</th>
                                        <th className="px-6 py-4">Emissor</th>
                                        <th className="px-6 py-4 text-right">Rentabilidade</th>
                                        <th className="px-6 py-4 text-right">Mínimo</th>
                                        <th className="px-6 py-4 text-right">Vencimento / Liquidez</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50 text-sm">
                                    {POPULAR_CDB_LCI.map((item) => (
                                        <tr key={item._id} className="hover:bg-slate-900/40 transition-colors group">
                                            <td className="px-6 py-4 font-bold text-slate-200 group-hover:text-white">
                                                {item.title}
                                            </td>
                                            <td className="px-6 py-4 text-slate-400">
                                                {item.issuer}
                                            </td>
                                            <td className="px-6 py-4 text-right font-mono font-bold text-blue-400">
                                                {item.rate}% do {item.index}
                                            </td>
                                            <td className="px-6 py-4 text-right text-slate-300">
                                                {fmtCurrency(item.minInvestment)}
                                            </td>
                                            <td className="px-6 py-4 text-right text-slate-400 font-medium">
                                                {item.maturity}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

            </main>
        </div>
    );
};

// ... (Subcomponentes mantidos inalterados) ...
const SortableHeader = ({ label, sortKey, currentSort, onSort, align, icon }: any) => (
    <th 
        className={`px-6 py-4 cursor-pointer hover:text-white transition-colors text-${align} bg-[#0F131E]`}
        onClick={() => onSort(sortKey)}
    >
        <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
            {label}
            {icon}
            <ArrowUpDown size={10} className={currentSort.key === sortKey ? 'text-blue-500' : 'text-slate-700'} />
        </div>
    </th>
);

const IndicatorCard = ({ label, value, suffix = '', desc, color = 'text-white', icon, isCurrency, currencyPrefix = 'R$', change }: any) => {
    let ChangeIcon = null;
    let changeColor = 'text-slate-500';
    
    if (change > 0) {
        ChangeIcon = TrendingUp;
        changeColor = 'text-emerald-500';
    } else if (change < 0) {
        ChangeIcon = TrendingDown;
        changeColor = 'text-red-500';
    }

    return (
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
                    {change !== undefined && ChangeIcon && (
                        <span className={`text-[10px] font-bold flex items-center ${changeColor}`}>
                            <ChangeIcon size={10} className="mr-1" />
                            {Math.abs(change).toFixed(2)}%
                        </span>
                    )}
                </div>
            </div>
            <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-slate-800/50 rounded-full blur-[40px] group-hover:bg-slate-700/50 transition-colors"></div>
        </div>
    );
};

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
