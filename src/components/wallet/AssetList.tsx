import React, { useState } from 'react';
import { useWallet, AssetType, Asset } from '../../contexts/WalletContext';
import { TrendingUp, TrendingDown, MoreHorizontal, Trash2 } from 'lucide-react';

export const AssetList = () => {
    const { assets, removeAsset } = useWallet();
    const [activeTab, setActiveTab] = useState<AssetType | 'ALL'>('ALL');

    // Mapeamento de Labels para as Tabs
    const tabs: { id: AssetType | 'ALL'; label: string }[] = [
        { id: 'ALL', label: 'Visão Geral' },
        { id: 'STOCK', label: 'Ações BR' },
        { id: 'FII', label: 'FIIs' },
        { id: 'STOCK_US', label: 'Exterior' },
        { id: 'CRYPTO', label: 'Cripto' },
        { id: 'FIXED_INCOME', label: 'Renda Fixa' },
        { id: 'CASH', label: 'Caixa' },
    ];

    // Filtragem
    const filteredAssets = activeTab === 'ALL' 
        ? assets 
        : assets.filter(a => a.type === activeTab);

    // Totais da Tab Atual
    const totalInTab = filteredAssets.reduce((acc, asset) => acc + (asset.quantity * asset.currentPrice * (asset.currency === 'USD' ? 5 : 1)), 0);

    const formatCurrency = (val: number, currency: string = 'BRL') => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(val);

    const formatPercent = (val: number) => `${val > 0 ? '+' : ''}${val.toFixed(2)}%`;

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Tabs de Navegação */}
            <div className="flex overflow-x-auto gap-2 border-b border-slate-800/60 pb-1 no-scrollbar">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`
                            whitespace-nowrap px-4 py-2 rounded-lg text-xs font-bold transition-all
                            ${activeTab === tab.id 
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                            }
                        `}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Cabeçalho de Totais da Categoria */}
            {activeTab !== 'ALL' && assets.length > 0 && (
                <div className="flex items-center justify-between bg-slate-900/30 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 font-bold uppercase">Total em {tabs.find(t => t.id === activeTab)?.label}</span>
                    <span className="text-lg font-bold text-white">{formatCurrency(totalInTab)}</span>
                </div>
            )}

            {/* Tabela de Ativos */}
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500 bg-[#0B101A]">
                                <th className="p-4 font-bold">Ativo</th>
                                <th className="p-4 font-bold text-right">Preço Médio</th>
                                <th className="p-4 font-bold text-right">Preço Atual</th>
                                <th className="p-4 font-bold text-right">Saldo Atual</th>
                                <th className="p-4 font-bold text-right">Rentabilidade</th>
                                <th className="p-4 font-bold text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm divide-y divide-slate-800/50">
                            {filteredAssets.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-slate-500">
                                        Nenhum ativo encontrado nesta categoria.
                                    </td>
                                </tr>
                            ) : (
                                filteredAssets.map((asset) => {
                                    const totalValue = asset.quantity * asset.currentPrice;
                                    const costValue = asset.quantity * asset.averagePrice;
                                    const profit = totalValue - costValue;
                                    const profitPercent = (profit / costValue) * 100;

                                    return (
                                        <tr key={asset.id} className="hover:bg-slate-800/30 transition-colors group">
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded bg-slate-800 flex items-center justify-center font-bold text-xs border border-slate-700 ${
                                                        asset.type === 'CRYPTO' ? 'text-purple-400' :
                                                        asset.type === 'STOCK_US' ? 'text-blue-400' : 'text-slate-300'
                                                    }`}>
                                                        {asset.ticker.substring(0, 2)}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-slate-200">{asset.ticker}</p>
                                                        <p className="text-[10px] text-slate-500">{asset.name}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4 text-right text-slate-400 font-mono">
                                                {formatCurrency(asset.averagePrice, asset.currency)}
                                            </td>
                                            <td className="p-4 text-right text-slate-300 font-mono font-bold">
                                                {formatCurrency(asset.currentPrice, asset.currency)}
                                            </td>
                                            <td className="p-4 text-right">
                                                <p className="font-bold text-white">
                                                    {formatCurrency(totalValue, asset.currency)}
                                                </p>
                                                <p className="text-[10px] text-slate-500">
                                                    {asset.quantity} un
                                                </p>
                                            </td>
                                            <td className="p-4 text-right">
                                                <div className={`flex flex-col items-end ${profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                    <span className="font-bold flex items-center gap-1">
                                                        {profit >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                        {formatPercent(profitPercent)}
                                                    </span>
                                                    <span className="text-[10px] opacity-80">
                                                        {profit >= 0 ? '+' : ''}{formatCurrency(profit, asset.currency)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-center">
                                                <button 
                                                    onClick={() => {
                                                        if(confirm(`Remover ${asset.ticker} da carteira?`)) removeAsset(asset.id);
                                                    }}
                                                    className="p-2 text-slate-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                                    title="Remover Ativo"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};