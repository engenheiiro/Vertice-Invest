
import React from 'react';
import { PieChart, MoreHorizontal, TrendingUp, TrendingDown, Minus, RefreshCw, Crown, Folder } from 'lucide-react';
import { PortfolioItem } from '../../hooks/useDashboardData';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface AssetTableProps {
    items: PortfolioItem[];
}

export const AssetTable: React.FC<AssetTableProps> = ({ items }) => {
    const { user } = useAuth();
    const navigate = useNavigate();
    
    // ITEM 5: Botão "Aporte Inteligente" agora é PRO, "Rebalanceamento" é BLACK
    const isPro = user?.plan !== 'GUEST' && user?.plan !== 'ESSENTIAL';
    const isBlack = user?.plan === 'BLACK';

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    // ITEM 4: Agrupamento
    const groupedItems = items.reduce((acc, item) => {
        // Mock de tipo e setor, pois PortfolioItem original do dashboard não tinha esses campos.
        // Em um cenário real, esses dados viriam do backend.
        // Vamos inferir visualmente para esta task ou assumir que o backend enviará.
        // Assumindo que PortfolioItem foi estendido ou faremos inferência simples pelo ticker.
        let type = 'OUTROS';
        if (item.ticker.includes('11')) type = 'FIIs / ETFS';
        else if (item.ticker.length <= 5) type = 'AÇÕES BR';
        else type = 'GLOBAL / CRIPTO';

        if (!acc[type]) acc[type] = [];
        acc[type].push(item);
        return acc;
    }, {} as Record<string, PortfolioItem[]>);

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-full">
            <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0B101A]">
                <h3 className="font-bold text-slate-200 flex items-center gap-2">
                    <PieChart size={16} className="text-blue-500" />
                    Carteira Inteligente
                </h3>
                
                {/* ITEM 5: Novos Botões */}
                <div className="flex gap-2">
                    <button 
                        onClick={() => navigate('/wallet')} // Aporte geralmente é feito na Wallet
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border flex items-center gap-1.5 ${
                            isPro 
                            ? 'bg-blue-600/10 text-blue-400 border-blue-600/30 hover:bg-blue-600/20' 
                            : 'bg-slate-800 text-slate-500 border-slate-700 opacity-50 cursor-not-allowed'
                        }`}
                        title={isPro ? "Aporte Inteligente" : "Exclusivo Pro"}
                    >
                        <TrendingUp size={12} /> Aporte Inteligente
                    </button>

                    <button 
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border flex items-center gap-1.5 ${
                            isBlack 
                            ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30 hover:bg-[#D4AF37]/20' 
                            : 'bg-slate-800 text-slate-500 border-slate-700 opacity-50 cursor-not-allowed'
                        }`}
                        title={isBlack ? "Rebalanceamento Automático" : "Exclusivo Black"}
                    >
                        <RefreshCw size={12} /> Rebalanceamento IA
                    </button>
                </div>
            </div>
            
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[750px]">
                    <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500 bg-[#0B101A]">
                            <th className="p-4 font-bold">Ativo</th>
                            {/* ITEM 4: Coluna Setor */}
                            <th className="p-4 font-bold text-left">Setor</th> 
                            <th className="p-4 font-bold text-right">Preço</th>
                            <th className="p-4 font-bold text-right">Posição</th>
                            <th className="p-4 font-bold w-48">Performance</th>
                            <th className="p-4 font-bold text-right">IA Sentimento</th>
                            <th className="p-4 font-bold text-center">Ação</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-slate-800/50">
                        {Object.entries(groupedItems).map(([group, groupItems]) => (
                            <React.Fragment key={group}>
                                {/* ITEM 4: Separador de Grupo */}
                                <tr className="bg-[#0F131E] border-y border-slate-800/50">
                                    <td colSpan={7} className="px-4 py-2">
                                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                                            <Folder size={12} /> {group}
                                        </span>
                                    </td>
                                </tr>

                                {groupItems.map((item) => {
                                    const profit = item.currentPrice - item.avgPrice;
                                    const profitPercent = item.avgPrice > 0 ? (profit / item.avgPrice) * 100 : 0;
                                    const maxRange = Math.max(item.currentPrice, item.avgPrice) * 1.2;

                                    // Mock de setor (ideal vir do backend no PortfolioItem)
                                    const sector = item.name.includes('Tesouro') ? 'Soberano' : 'Geral';

                                    return (
                                        <tr key={item.ticker} className="hover:bg-slate-800/30 transition-colors group">
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300 border border-slate-700">
                                                        {item.ticker.substring(0,2)}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-slate-200">{item.ticker}</p>
                                                        <p className="text-[10px] text-slate-500">{item.name}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            {/* ITEM 4: Coluna Setor */}
                                            <td className="p-4">
                                                <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                                                    {sector}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right font-mono text-slate-300">
                                                {formatCurrency(item.currentPrice)}
                                            </td>
                                            <td className="p-4 text-right">
                                                <p className="font-bold text-slate-200">{formatCurrency(item.currentPrice * item.shares)}</p>
                                                <p className="text-[10px] text-slate-500">{item.shares} un</p>
                                            </td>
                                            
                                            <td className="p-4">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between text-[9px] font-bold">
                                                        <span className="text-slate-500">PM: {item.avgPrice.toFixed(2)}</span>
                                                        <span className={profit >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                                                            {profit >= 0 ? '+' : ''}{profitPercent.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden relative">
                                                        <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10" style={{ left: `${(item.avgPrice / maxRange) * 100}%` }}></div>
                                                        <div 
                                                            className={`h-full rounded-full transition-all duration-700 ${profit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                                            style={{ width: `${(item.currentPrice / maxRange) * 100}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="p-4 text-right">
                                                <SentimentBadge sentiment={item.aiSentiment} score={item.aiScore} />
                                            </td>
                                            <td className="p-4 text-center">
                                                <button className="text-slate-500 hover:text-blue-400 transition-colors p-1 hover:bg-slate-800 rounded">
                                                    <MoreHorizontal size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const SentimentBadge = ({ sentiment, score }: { sentiment: string, score: number }) => {
    let colorClass = 'text-slate-500 bg-slate-800 border-slate-700';
    let label = 'MANTER';
    let Icon = Minus;

    if (sentiment === 'BULLISH') {
        colorClass = 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        label = 'COMPRA';
        Icon = TrendingUp;
    } else if (sentiment === 'BEARISH') {
        colorClass = 'text-red-500 bg-red-500/10 border-red-500/20';
        label = 'VENDA';
        Icon = TrendingDown;
    }

    return (
        <div className="flex flex-col items-end gap-0.5">
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border ${colorClass}`}>
                <span>{label}</span>
                <Icon size={12} />
            </div>
            <span className="text-[9px] text-slate-500 font-mono">Score: {score}</span>
        </div>
    );
};
