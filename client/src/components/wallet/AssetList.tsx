
import React, { useState } from 'react';
import { useWallet, AssetType, Asset } from '../../contexts/WalletContext';
import { TrendingUp, TrendingDown, Trash2, Folder, PieChart, History, ChevronDown, ChevronRight, EyeOff, Pencil } from 'lucide-react';
import { AssetTransactionsModal } from './AssetTransactionsModal';
import { RenameReserveModal } from './RenameReserveModal';
import { formatCurrency as fmtCurrency, type Currency } from '../../utils/format';
import { useConfirm } from '../../hooks/useConfirm';
import AssetLogo from '../common/AssetLogo';
import { getAssetSubtitle } from '../../utils/assetDisplay';

/** Título exibido na lista: cofrinhos (CASH) mostram o nome; demais, o ticker. */
const assetTitle = (asset: Asset): string =>
    asset.type === 'CASH' ? (asset.name || 'Reserva') : asset.ticker;

const TYPE_LABELS: Record<string, string> = {
    STOCK: 'Ações Brasil',
    FII: 'Fundos Imobiliários',
    STOCK_US: 'Exterior',
    ETF: 'ETFs',
    CRYPTO: 'Criptoativos',
    FIXED_INCOME: 'Renda Fixa',
    OURO: 'Ouro',
    CASH: 'Caixa / Reserva'
};

// Acento de cor por classe (espelha a paleta do donut de Distribuição): tinge o
// ícone do grupo, o rótulo e a barra de alocação — dando identidade a cada classe.
const CLASS_ACCENT: Record<string, { label: string; icon: string; bar: string }> = {
    STOCK:        { label: 'text-blue-400',    icon: 'bg-blue-500/10 text-blue-400',       bar: 'bg-blue-500' },
    FII:          { label: 'text-emerald-400', icon: 'bg-emerald-500/10 text-emerald-400', bar: 'bg-emerald-500' },
    STOCK_US:     { label: 'text-cyan-400',    icon: 'bg-cyan-500/10 text-cyan-400',       bar: 'bg-cyan-500' },
    ETF:          { label: 'text-teal-400',    icon: 'bg-teal-500/10 text-teal-400',       bar: 'bg-teal-500' },
    CRYPTO:       { label: 'text-fuchsia-400', icon: 'bg-fuchsia-500/10 text-fuchsia-400', bar: 'bg-fuchsia-500' },
    FIXED_INCOME: { label: 'text-amber-400',   icon: 'bg-amber-500/10 text-amber-400',     bar: 'bg-amber-500' },
    OURO:         { label: 'text-yellow-400',  icon: 'bg-yellow-500/10 text-yellow-400',   bar: 'bg-yellow-500' },
    CASH:         { label: 'text-slate-300',   icon: 'bg-slate-700/60 text-slate-300',     bar: 'bg-slate-500' },
};
const accentOf = (type: string) => CLASS_ACCENT[type] || CLASS_ACCENT.CASH;
const pluralAtivos = (n: number) => `${n} ${n === 1 ? 'Ativo' : 'Ativos'}`;

export const AssetList = () => {
    const { assets, removeAsset, kpis, targetAllocation, isPrivacyMode } = useWallet();
    const confirm = useConfirm();

    const [historyTicker, setHistoryTicker] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    const formatCurrency = (val: number | null | undefined, currency: Currency = 'BRL') =>
        fmtCurrency(val, currency, { privacy: isPrivacyMode });

    const formatPercent = (val: number | null | undefined) => {
        const v = val || 0;
        if (!isFinite(v) || isNaN(v)) return '0.00%';
        return `${Math.abs(v).toFixed(2)}%`;
    };

    // Duas métricas por ativo, alinhadas ao Investidor10:
    //  • Variação      = só preço/cotação → (saldo − custo) / custo.
    //  • Rentabilidade = retorno total    → (saldo − custo + proventos) / custo.
    // Em ativos que nunca pagaram proventos as duas coincidem (esperado).
    const assetMetrics = (a: Asset) => {
        const cost = a.totalCost || 0;
        const capital = (a.totalValue || 0) - cost;
        const div = a.dividendsReceived || 0;
        return {
            capital,
            dividends: div,
            totalResult: capital + div,
            variationPct: cost > 0 ? (capital / cost) * 100 : 0,
            rentabilityPct: cost > 0 ? ((capital + div) / cost) * 100 : 0,
        };
    };

    const groupMetrics = (items: Asset[]) => {
        let value = 0, cost = 0, dividends = 0;
        items.forEach(i => {
            value += i.totalValue || 0;
            cost += i.totalCost || 0;
            dividends += i.dividendsReceived || 0;
        });
        const capital = value - cost;
        return {
            capital,
            dividends,
            totalResult: capital + dividends,
            variationPct: cost > 0 ? (capital / cost) * 100 : 0,
            rentabilityPct: cost > 0 ? ((capital + dividends) / cost) * 100 : 0,
        };
    };

    const toggleGroup = (type: string) => {
        setCollapsedGroups(prev => ({ ...prev, [type]: !prev[type] }));
    };

    // Agrupa por classe (type): ETF nacional é grupo próprio "ETFs"; ETFs internacionais
    // têm type STOCK_US e listam sob "Exterior", coerente com a Distribuição e o % ideal.
    const groupedAssets = assets.reduce((acc, asset) => {
        if (!acc[asset.type]) acc[asset.type] = [];
        acc[asset.type].push(asset);
        return acc;
    }, {} as Record<string, Asset[]>);

    // OURO mantido no fim para exibir holdings legados de ouro (não cadastrável mais).
    const typeOrder = ['STOCK', 'FII', 'STOCK_US', 'ETF', 'FIXED_INCOME', 'CRYPTO', 'OURO', 'CASH'];
    const visibleTypes = typeOrder.filter(type => groupedAssets[type] && groupedAssets[type].length > 0);

    return (
        <>
            <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden animate-fade-in">
                <div className="p-5 border-b border-slate-800 bg-card flex justify-between items-center">
                    <h3 className="font-bold text-slate-200 flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-[9px] bg-slate-800 text-slate-300 flex items-center justify-center">
                            <Folder size={16} />
                        </span>
                        Detalhamento por Classe
                    </h3>
                    {isPrivacyMode && (
                        <div className="text-[10px] text-slate-500 flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                            <EyeOff size={10} /> Modo Privado
                        </div>
                    )}
                </div>

                {/* (M4) Mobile: cards empilhados no lugar da tabela larga (evita scroll-x). */}
                <div className="md:hidden divide-y divide-slate-800/50">
                    {visibleTypes.map(type => {
                        const groupItems = groupedAssets[type];
                        const isCollapsed = collapsedGroups[type];
                        const totalValueGroup = groupItems.reduce((acc, item) => acc + (item.totalValue || 0), 0);
                        const gm = groupMetrics(groupItems);
                        const accent = accentOf(type);

                        return (
                            <div key={type}>
                                <button
                                    onClick={() => toggleGroup(type)}
                                    className="w-full flex items-center justify-between px-4 py-3 bg-panel text-left"
                                >
                                    <span className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 min-w-0 ${accent.label}`}>
                                        {isCollapsed ? <ChevronRight size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
                                        <span className={`w-6 h-6 rounded-[7px] flex items-center justify-center shrink-0 ${accent.icon}`}><PieChart size={13} /></span>
                                        <span className="truncate">{TYPE_LABELS[type]}</span>
                                        <span className="text-[10px] text-slate-500 shrink-0">({groupItems.length})</span>
                                    </span>
                                    <span className="text-right shrink-0 ml-3">
                                        <span className="block text-white tabular-nums font-bold text-sm">{formatCurrency(totalValueGroup)}</span>
                                        <span className="flex items-center justify-end gap-2 text-[11px] font-bold">
                                            <span className={gm.capital >= 0 ? 'text-emerald-500' : 'text-red-500'} title="Variação do preço (sem proventos)">
                                                {gm.capital >= 0 ? '+' : '-'}{formatPercent(gm.variationPct)}
                                            </span>
                                            <span className="text-slate-700">·</span>
                                            <span className={gm.totalResult >= 0 ? 'text-emerald-500' : 'text-red-500'} title="Rentabilidade total (preço + proventos)">
                                                {gm.totalResult >= 0 ? '+' : '-'}{formatPercent(gm.rentabilityPct)}
                                            </span>
                                        </span>
                                    </span>
                                </button>

                                {!isCollapsed && groupItems.map((asset) => {
                                    const m = assetMetrics(asset);
                                    const isVarUp = m.capital >= 0;
                                    const isRentUp = m.totalResult >= 0;
                                    return (
                                        <div key={asset.id} className="flex items-center justify-between px-4 py-3 bg-base">
                                            <div className="min-w-0 flex-1 flex items-center gap-3">
                                                <AssetLogo ticker={asset.ticker} type={asset.type} currency={asset.currency} name={asset.name} size={32} />
                                                <div className="min-w-0">
                                                    <p className="font-bold text-slate-200 text-sm truncate">{assetTitle(asset)}</p>
                                                    <p className="text-[10px] text-slate-500 truncate">
                                                        {asset.type === 'CASH'
                                                            ? 'Caixa / Reserva'
                                                            : `${asset.quantity} un · PM ${formatCurrency(asset.averagePrice, asset.currency)}`}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <div className="text-right">
                                                    <p className="font-bold text-white text-sm">{formatCurrency(asset.totalValue, 'BRL')}</p>
                                                    <p className="flex items-center justify-end gap-2 text-[11px] font-bold">
                                                        <span className={isVarUp ? 'text-emerald-500' : 'text-red-500'} title="Variação do preço (sem proventos)">
                                                            {isVarUp ? '+' : '-'}{formatPercent(m.variationPct)}
                                                        </span>
                                                        <span className="text-slate-700">·</span>
                                                        <span className={`flex items-center gap-0.5 ${isRentUp ? 'text-emerald-500' : 'text-red-500'}`} title="Rentabilidade total (preço + proventos)">
                                                            {isRentUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                                                            {isRentUp ? '+' : '-'}{formatPercent(m.rentabilityPct)}
                                                        </span>
                                                    </p>
                                                </div>
                                                <div className="flex flex-col">
                                                    {asset.type === 'CASH' && (
                                                        <button
                                                            onClick={() => setRenameTarget({ id: asset.id, name: asset.name || '' })}
                                                            aria-label={`Renomear ${assetTitle(asset)}`}
                                                            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-emerald-400 transition-colors"
                                                        >
                                                            <Pencil size={16} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => setHistoryTicker(asset.ticker)}
                                                        aria-label={`Histórico de ${assetTitle(asset)}`}
                                                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-blue-400 transition-colors"
                                                    >
                                                        <History size={16} />
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            const ok = await confirm({
                                                                title: 'Remover ativo',
                                                                message: `Remover ${asset.ticker} e todo o histórico de transações? Esta ação não pode ser desfeita. Atenção: se este ativo teve vendas no ano, ele deixará de aparecer no Relatório de Imposto de Renda — gere/exporte o IR do ano antes de remover.`,
                                                                confirmText: 'Remover',
                                                                isDestructive: true,
                                                            });
                                                            if (ok) removeAsset(asset.id);
                                                        }}
                                                        aria-label={`Remover ${asset.ticker}`}
                                                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-red-500 transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>

                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[860px]">
                        <caption className="sr-only">Lista de ativos da carteira com preço médio, preço atual, saldo, variação e rentabilidade</caption>
                        <thead>
                            <tr className="bg-card border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                                <th scope="col" className="p-4 font-bold">Ativo</th>
                                <th scope="col" className="p-4 font-bold text-right">Preço Médio</th>
                                <th scope="col" className="p-4 font-bold text-right">Preço Atual</th>
                                <th scope="col" className="p-4 font-bold text-right">Saldo Atual (R$)</th>
                                <th scope="col" className="p-4 font-bold text-right">% Classe</th>
                                <th scope="col" className="p-4 font-bold text-right" title="Variação do preço: cotação atual vs. preço médio (não inclui proventos).">Variação</th>
                                <th scope="col" className="p-4 font-bold text-right" title="Retorno total sobre o custo: valorização do preço + proventos recebidos.">Rentabilidade</th>
                                <th scope="col" className="p-4 font-bold text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {visibleTypes.map(type => {
                                const groupItems = groupedAssets[type];
                                const isCollapsed = collapsedGroups[type];
                                
                                const totalValueGroup = groupItems.reduce((acc, item) => acc + (item.totalValue || 0), 0);
                                const allocationPercent = (kpis.totalEquity || 0) > 0 ? (totalValueGroup / kpis.totalEquity) * 100 : 0;
                                const idealPercent = targetAllocation[type as AssetType] || 0;
                                const gm = groupMetrics(groupItems);
                                const accent = accentOf(type);

                                return (
                                    <React.Fragment key={type}>
                                        <tr
                                            className="bg-panel border-y border-slate-800/50 cursor-pointer hover:bg-elevated transition-colors"
                                            onClick={() => toggleGroup(type)}
                                        >
                                            <td colSpan={8} className="px-4 py-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <span className={`shrink-0 ${accent.label}`}>
                                                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                                        </span>
                                                        <span className={`w-7 h-7 rounded-[8px] flex items-center justify-center ${accent.icon}`}>
                                                            <PieChart size={15} />
                                                        </span>
                                                        <span className={`text-xs font-bold uppercase tracking-widest ${accent.label}`}>
                                                            {TYPE_LABELS[type]}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-slate-500 bg-elevated px-2 py-0.5 rounded border border-slate-800/50">
                                                            {pluralAtivos(groupItems.length)}
                                                        </span>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-6 text-[10px] md:text-xs">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-slate-500 font-bold uppercase text-[9px]">Total</span>
                                                            <span className="text-white tabular-nums font-bold">{formatCurrency(totalValueGroup)}</span>
                                                        </div>
                                                        
                                                        <div className="flex flex-col items-end" title="Variação do preço (sem proventos)">
                                                            <span className="text-slate-500 font-bold uppercase text-[9px]">Variação</span>
                                                            <span className={`font-bold ${gm.capital >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                                {gm.capital >= 0 ? '+' : '-'}{formatPercent(gm.variationPct)}
                                                            </span>
                                                        </div>

                                                        <div className="flex flex-col items-end" title="Retorno total: preço + proventos">
                                                            <span className="text-slate-500 font-bold uppercase text-[9px]">Rentabilidade</span>
                                                            <span className={`font-bold ${gm.totalResult >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                                {gm.totalResult >= 0 ? '+' : '-'}{formatPercent(gm.rentabilityPct)}
                                                            </span>
                                                        </div>

                                                        <div className="flex flex-col items-end min-w-[100px]">
                                                            <span className="text-slate-500 font-bold uppercase text-[9px]">Alocação (Ideal: {idealPercent}%)</span>
                                                            <div className="flex items-center gap-2 w-full justify-end">
                                                                <span className="text-white font-bold">{allocationPercent.toFixed(1)}%</span>
                                                                <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                                    <div className={`h-full ${accent.bar}`} style={{ width: `${Math.min(allocationPercent, 100)}%` }}></div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>

                                        {!isCollapsed && groupItems.map((asset) => {
                                            const isUSD = asset.type === 'STOCK_US' || asset.currency === 'USD';

                                            // Variação (só preço) e Rentabilidade (preço + proventos) da
                                            // posição. Saldo/custo já vêm em BRL e convertidos do backend.
                                            // Recalcular por (currentPrice − averagePrice) zerava o CASH,
                                            // pois o backend força currentPrice = 1 para Caixa/Reserva.
                                            const m = assetMetrics(asset);
                                            const isVarUp = m.capital >= 0;
                                            const isRentUp = m.totalResult >= 0;

                                            // % da Classe
                                            const percentOfClass = totalValueGroup > 0 ? (asset.totalValue / totalValueGroup) * 100 : 0;

                                            return (
                                                <tr key={asset.id} className="hover:bg-slate-800/30 transition-colors border-b border-slate-800/30 last:border-0 group animate-fade-in">
                                                    <td className="p-4 pl-8">
                                                        <div className="flex items-center gap-3">
                                                            <AssetLogo ticker={asset.ticker} type={asset.type} currency={asset.currency} name={asset.name} size={32} />
                                                            <div>
                                                                <p className="font-bold text-slate-200">{assetTitle(asset)}</p>
                                                                <p className="text-[10px] text-slate-500">{getAssetSubtitle(asset)}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-right text-slate-400 tabular-nums">
                                                        {formatCurrency(asset.averagePrice, asset.currency)}
                                                    </td>
                                                    <td className="p-4 text-right text-slate-300 tabular-nums font-bold">
                                                        {formatCurrency(asset.currentPrice, asset.currency)}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <p className="font-bold text-white">
                                                            {formatCurrency(asset.totalValue, 'BRL')}
                                                        </p>
                                                        {isUSD && !isPrivacyMode && (
                                                            <p className="text-[10px] text-blue-400/70 tabular-nums">
                                                                ({formatCurrency(asset.currentPrice * asset.quantity, 'USD')})
                                                            </p>
                                                        )}
                                                        {!isUSD && (
                                                            <p className="text-[10px] text-slate-500">
                                                                {asset.quantity} un
                                                            </p>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <span className="text-xs font-bold text-slate-400 bg-elevated px-2 py-0.5 rounded border border-slate-800">
                                                            {percentOfClass.toFixed(1)}%
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <span className={`font-bold flex items-center justify-end gap-1 ${isVarUp ? 'text-emerald-500' : 'text-red-500'}`} title="Variação do preço (sem proventos)">
                                                            {isVarUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                            {isVarUp ? '+' : '-'}{formatPercent(m.variationPct)}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <div className={`flex flex-col items-end ${isRentUp ? 'text-emerald-500' : 'text-red-500'}`} title="Retorno total: valorização + proventos recebidos">
                                                            <span className="font-bold flex items-center gap-1">
                                                                {isRentUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                                {isRentUp ? '+' : '-'}{formatPercent(m.rentabilityPct)}
                                                            </span>
                                                            <span className="text-[10px] opacity-80">
                                                                {isRentUp ? '+' : ''}{formatCurrency(m.totalResult, 'BRL')}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <div className="flex items-center justify-center gap-1.5">
                                                            {asset.type === 'CASH' && (
                                                                <button
                                                                    onClick={() => setRenameTarget({ id: asset.id, name: asset.name || '' })}
                                                                    className="w-8 h-8 flex items-center justify-center border border-slate-800 rounded-lg text-slate-500 hover:text-emerald-400 hover:border-emerald-500/40 transition-colors"
                                                                    title="Renomear Reserva"
                                                                >
                                                                    <Pencil size={15} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => setHistoryTicker(asset.ticker)}
                                                                className="w-8 h-8 flex items-center justify-center border border-slate-800 rounded-lg text-slate-500 hover:text-blue-400 hover:border-blue-500/40 transition-colors"
                                                                title="Ver Histórico"
                                                            >
                                                                <History size={15} />
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    const ok = await confirm({
                                                                        title: 'Remover ativo',
                                                                        message: `Remover ${asset.ticker} e todo o histórico de transações? Esta ação não pode ser desfeita. Atenção: se este ativo teve vendas no ano, ele deixará de aparecer no Relatório de Imposto de Renda — gere/exporte o IR do ano antes de remover.`,
                                                                        confirmText: 'Remover',
                                                                        isDestructive: true,
                                                                    });
                                                                    if (ok) removeAsset(asset.id);
                                                                }}
                                                                className="w-8 h-8 flex items-center justify-center border border-slate-800 rounded-lg text-slate-500 hover:text-red-500 hover:border-red-500/40 transition-colors"
                                                                title="Remover Ativo"
                                                            >
                                                                <Trash2 size={15} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <AssetTransactionsModal
                isOpen={!!historyTicker}
                ticker={historyTicker || ''}
                onClose={() => setHistoryTicker(null)}
            />

            <RenameReserveModal
                isOpen={!!renameTarget}
                assetId={renameTarget?.id || null}
                currentName={renameTarget?.name || ''}
                onClose={() => setRenameTarget(null)}
            />
        </>
    );
};
