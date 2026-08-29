
import React, { useState } from 'react';
import { useWallet, AssetType, Asset, UsSubKey } from '../../contexts/WalletContext';
import { TrendingUp, TrendingDown, Trash2, Folder, PieChart, History, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, EyeOff, Pencil } from 'lucide-react';
import { AssetTransactionsModal } from './AssetTransactionsModal';
import { RenameReserveModal } from './RenameReserveModal';
import { SectorPopover } from './SectorPopover';
import type { SectorKind } from '../../utils/sectorAllocation';
import { formatCurrency as fmtCurrency, formatQuantity as fmtQuantity, PRIVACY_MASK_SHORT, type Currency } from '../../utils/format';
import { useConfirm } from '../../hooks/useConfirm';
import AssetLogo from '../common/AssetLogo';
import AssetTags from '../common/AssetTags';
import { getAssetSubtitle, getAssetTags, displayUnitPrices } from '../../utils/assetDisplay';
import { allocationBucket, sumReserveValue, isReserveAsset, usSubKeyOf } from '../../utils/allocation';

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
    CASH: 'Reserva / Caixa'
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

// Classes que ganham o donut de setores no cabeçalho, com a chave de agrupamento
// de cada uma. Renda Fixa/Reserva não têm setor; Exterior e Cripto ficam de fora
// por enquanto (o setor de ativo US chega em inglês e a cripto não tem setor).
const SECTOR_PIE_CLASSES: Record<string, SectorKind | undefined> = {
    STOCK: 'STOCK',
    FII: 'FII',
};
const pluralAtivos = (n: number) => `${n} ${n === 1 ? 'Ativo' : 'Ativos'}`;

/**
 * Valor "na curva" a exibir junto do total de um título marcado a mercado.
 *
 * `null` quando não há o que contrastar: posição na curva (o total JÁ é a curva)
 * ou diferença menor que um centavo — mostrar "na curva R$ 828,50" embaixo de
 * "R$ 828,50" só ocuparia espaço.
 */
const curveValueOf = (asset: { pricingSource?: 'MTM' | 'ACCRUAL' | null; accruedValue?: number | null; totalValue: number }): number | null => {
    if (asset.pricingSource !== 'MTM' || typeof asset.accruedValue !== 'number') return null;
    return Math.abs(asset.accruedValue - asset.totalValue) >= 0.01 ? asset.accruedValue : null;
};

/**
 * Renda fixa e caixa não têm preço unitário digitado que signifique algo — a
 * régua está em `displayUnitPrices` (utils/assetDisplay), compartilhada com o
 * Terminal para que as duas telas contem a mesma história. Quando não há preço,
 * a célula fica com um traço em vez de um número enganoso.
 */
const hasUnitPrice = (asset: Asset): boolean => asset.type !== 'FIXED_INCOME' && asset.type !== 'CASH';
const unitPricesOf = (asset: Asset) =>
    displayUnitPrices(asset, { average: asset.averagePrice, current: asset.currentPrice });
const NO_UNIT_PRICE = <span className="text-slate-600">—</span>;
const TYPE_ORDER = ['STOCK', 'FII', 'STOCK_US', 'FIXED_INCOME', 'CRYPTO', 'OURO', 'CASH'];
const MOBILE_ASSET_LIST_QUERY = '(max-width: 767px)';

const initialCollapsedGroups = (): Record<string, boolean> => {
    if (typeof window === 'undefined' || !window.matchMedia?.(MOBILE_ASSET_LIST_QUERY).matches) return {};
    return Object.fromEntries(TYPE_ORDER.map(type => [type, true]));
};

const wholePercentSplit = <K extends string>(values: Record<K, number>): Record<K, number> => {
    const keys = Object.keys(values) as K[];
    const total = keys.reduce((sum, key) => sum + Math.max(Number(values[key]) || 0, 0), 0);
    const percentages = {} as Record<K, number>;
    if (total <= 0) {
        keys.forEach(key => { percentages[key] = 0; });
        return percentages;
    }

    const fractions = {} as Record<K, number>;
    let allocated = 0;
    keys.forEach(key => {
        const exact = (Math.max(Number(values[key]) || 0, 0) / total) * 100;
        percentages[key] = Math.floor(exact);
        fractions[key] = exact - percentages[key];
        allocated += percentages[key];
    });

    // Maior resto: distribui os pontos faltantes sem deixar a soma arredondada fugir de 100%.
    [...keys]
        .sort((a, b) => fractions[b] - fractions[a])
        .slice(0, 100 - allocated)
        .forEach(key => { percentages[key] += 1; });

    return percentages;
};

const EXTERIOR_LABELS: Record<UsSubKey, string> = {
    STOCK: 'Stocks',
    REIT: 'REITs',
    ETF: 'ETFs',
    DOLLAR: 'Dólar',
};

export const AssetList = () => {
    const { assets, removeAsset, kpis, targetAllocation, isPrivacyMode, isReadOnly } = useWallet();
    const confirm = useConfirm();

    const [historyTicker, setHistoryTicker] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
    // No layout mobile, mostra primeiro o resumo de cada classe; o usuário expande
    // somente o grupo que deseja consultar. Tablet/desktop permanecem abertos.
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(initialCollapsedGroups);

    const formatCurrency = (val: number | null | undefined, currency: Currency = 'BRL') =>
        fmtCurrency(val, currency, { privacy: isPrivacyMode });

    // Quantidade também é tamanho de posição: com o preço público na tela, exibi-la
    // no modo privacidade entregaria de volta o valor que a máscara escondeu.
    const formatQuantity = (val: number | null | undefined) =>
        isPrivacyMode ? PRIVACY_MASK_SHORT : fmtQuantity(val);

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

    // Agrupa pelo BALDE DE ALOCAÇÃO (C1), coerente com a Distribuição: ativos de Reserva
    // (CASH ou RF marcada) caem em "Caixa / Reserva"; RF não-reserva fica em "Renda Fixa".
    // ETFs usam a exposição econômica: BOVA11 em Ações Brasil; IVVB11 em Exterior.
    // type/currency permanecem intactos para preço, transação e tributação.
    const groupedAssets = assets.reduce((acc, asset) => {
        const cls = allocationBucket(asset);
        if (!acc[cls]) acc[cls] = [];
        acc[cls].push(asset);
        return acc;
    }, {} as Record<string, Asset[]>);

    // Dentro da classe, do MAIOR peso para o menor — mesma regra do detalhamento
    // por setor (`sectorAllocation.ts`). Sem isto a ordem era a de criação da
    // posição, então a mesma carteira saía diferente conforme tivesse sido
    // cadastrada à mão ou importada (no extrato da B3 o ticker que entra
    // primeiro é só o primeiro alfabético da data mais recente).
    // O desempate por ticker não é enfeite: sem ele, posições de valor igual
    // (ou zeradas) trocam de lugar entre renders.
    Object.values(groupedAssets).forEach(items => {
        items.sort((a, b) => (b.totalValue || 0) - (a.totalValue || 0)
            || assetTitle(a).localeCompare(assetTitle(b), 'pt-BR'));
    });

    // Divisão Ações individuais vs ETFs de exposição Brasil. Os percentuais
    // são relativos ao próprio grupo de Ações Brasil e, portanto, somam 100%.
    const isNationalEtf = (a: Asset) => a.type === 'ETF';
    const stockSplit = (items: Asset[]) => {
        let stock = 0, etf = 0;
        items.forEach(i => { if (isNationalEtf(i)) etf += i.totalValue || 0; else stock += i.totalValue || 0; });
        const pct = wholePercentSplit({ stock, etf });
        return { stock, etf, stockPercent: pct.stock, etfPercent: pct.etf };
    };

    // Exterior pode reunir stocks/REITs em USD e ETFs negociados nos EUA ou na B3
    // (ex.: IVVB11 com allocationClass STOCK_US). O detalhamento usa a própria classe.
    const exteriorSplit = (items: Asset[]) => {
        const values: Record<UsSubKey, number> = { STOCK: 0, REIT: 0, ETF: 0, DOLLAR: 0 };
        items.forEach(item => {
            const key: UsSubKey = item.type === 'ETF' ? 'ETF' : usSubKeyOf(item);
            values[key] += item.totalValue || 0;
        });
        const pct = wholePercentSplit(values);
        const label = (Object.keys(values) as UsSubKey[])
            .filter(key => values[key] > 0)
            .map(key => `${EXTERIOR_LABELS[key]} ${pct[key]}%`)
            .join(' · ');
        return { values, label };
    };

    // Base de alocação = patrimônio − reserva. Denominador ÚNICO dos percentuais
    // de investimento (corrige a distorção: antes usava kpis.totalEquity, que
    // inclui a reserva e diluía o % de todas as classes de investimento).
    const reserveValue = sumReserveValue(assets);
    const allocationBase = Math.max((kpis.totalEquity || 0) - reserveValue, 0);

    // ETF é distribuído pela allocationClass. OURO no fim p/ holdings legados.
    const visibleTypes = TYPE_ORDER.filter(type => groupedAssets[type] && groupedAssets[type].length > 0);

    // Toggle global: se TODAS as classes estão contraídas, o botão expande; caso
    // contrário contrai tudo (inclusive quando só parte está aberta).
    const allCollapsed = visibleTypes.length > 0 && visibleTypes.every(type => collapsedGroups[type]);
    const toggleAllGroups = () => {
        setCollapsedGroups(allCollapsed
            ? {}
            : Object.fromEntries(visibleTypes.map(type => [type, true])));
    };

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
                    <div className="flex items-center gap-2">
                        {isPrivacyMode && (
                            <div className="text-[10px] text-slate-500 flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                                <EyeOff size={10} /> Modo Privado
                            </div>
                        )}
                        {visibleTypes.length > 0 && (
                            <button
                                onClick={toggleAllGroups}
                                aria-expanded={!allCollapsed}
                                title={allCollapsed ? 'Expandir todas as classes' : 'Contrair todas as classes'}
                                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white bg-elevated hover:bg-slate-700/50 px-2.5 py-1.5 rounded-lg border border-slate-800 transition-colors"
                            >
                                {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
                                <span className="hidden sm:inline">{allCollapsed ? 'Expandir' : 'Contrair'}</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* (M4) Mobile: cards empilhados no lugar da tabela larga (evita scroll-x). */}
                <div className="md:hidden divide-y divide-slate-800/50">
                    {visibleTypes.map(type => {
                        const groupItems = groupedAssets[type];
                        const isCollapsed = collapsedGroups[type];
                        const totalValueGroup = groupItems.reduce((acc, item) => acc + (item.totalValue || 0), 0);
                        const gm = groupMetrics(groupItems);
                        const accent = accentOf(type);
                        const sectorKind = SECTOR_PIE_CLASSES[type];
                        const sp = stockSplit(groupItems);
                        const exterior = exteriorSplit(groupItems);
                        const showStockSplit = type === 'STOCK' && sp.etf > 0 && totalValueGroup > 0;
                        const showExteriorSplit = type === 'STOCK_US' && exterior.values.ETF > 0 && totalValueGroup > 0;

                        return (
                            <div key={type}>
                                <button
                                    onClick={() => toggleGroup(type)}
                                    aria-expanded={!isCollapsed}
                                    className="w-full flex items-center justify-between px-4 py-3 bg-panel text-left"
                                >
                                    <span className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 min-w-0 ${accent.label}`}>
                                        {isCollapsed ? <ChevronRight size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
                                        <span className={`w-6 h-6 rounded-[7px] flex items-center justify-center shrink-0 ${accent.icon}`}><PieChart size={13} /></span>
                                        <span className="flex flex-col min-w-0">
                                            <span className="flex items-center gap-2 min-w-0">
                                                <span className="truncate">{TYPE_LABELS[type]}</span>
                                                <span className="text-[10px] text-slate-500 shrink-0">({groupItems.length})</span>
                                            </span>
                                            {showStockSplit && (
                                                <span className="text-[9px] text-slate-500 font-semibold normal-case tracking-normal">
                                                    Ações {sp.stockPercent}% · ETFs {sp.etfPercent}%
                                                </span>
                                            )}
                                            {showExteriorSplit && (
                                                <span className="text-[9px] text-slate-500 font-semibold normal-case tracking-normal">
                                                    {exterior.label}
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                    <span className="text-right shrink-0 ml-3">
                                        <span className="block text-white tabular-nums font-bold text-sm">{formatCurrency(totalValueGroup)}</span>
                                        <span className="flex items-center justify-end gap-2 text-[11px] font-bold">
                                            {Math.abs(gm.rentabilityPct - gm.variationPct) >= 0.005 && (
                                                <>
                                                    <span className={gm.capital >= 0 ? 'text-emerald-500' : 'text-red-500'} title="Variação do preço (sem proventos)">
                                                        {gm.capital >= 0 ? '+' : '-'}{formatPercent(gm.variationPct)}
                                                    </span>
                                                    <span className="text-slate-700">·</span>
                                                </>
                                            )}
                                            <span className={gm.totalResult >= 0 ? 'text-emerald-500' : 'text-red-500'} title="Rentabilidade total (preço + proventos)">
                                                {gm.totalResult >= 0 ? '+' : '-'}{formatPercent(gm.rentabilityPct)}
                                            </span>
                                        </span>
                                    </span>
                                </button>

                                {/* Fora do <button> do cabeçalho: botão dentro de botão é HTML inválido. */}
                                {sectorKind && (
                                    <div className="flex px-4 pb-3 -mt-1 bg-panel">
                                        <SectorPopover items={groupItems} kind={sectorKind} isPrivacyMode={isPrivacyMode} variant="touch" />
                                    </div>
                                )}

                                {!isCollapsed && groupItems.map((asset) => {
                                    const m = assetMetrics(asset);
                                    const isVarUp = m.capital >= 0;
                                    const isRentUp = m.totalResult >= 0;
                                    return (
                                        <div key={asset.id} className="flex items-center justify-between px-4 py-3 bg-base">
                                            <div className="min-w-0 flex-1 flex items-center gap-3">
                                                <AssetLogo ticker={asset.ticker} type={asset.type} currency={asset.currency} name={asset.name} isReserve={isReserveAsset(asset)} size={32} />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                        <span className="font-bold text-slate-200 text-sm truncate">{assetTitle(asset)}</span>
                                                        <AssetTags tags={getAssetTags(asset)} size="sm" />
                                                    </div>
                                                    <p className="text-[10px] text-slate-500 truncate">
                                                        {isReserveAsset(asset)
                                                            ? 'Reserva / Caixa'
                                                            : curveValueOf(asset) !== null
                                                                ? `na curva ${formatCurrency(curveValueOf(asset) as number, 'BRL')}`
                                                                : hasUnitPrice(asset)
                                                                    ? `${formatQuantity(asset.quantity)} un · PM ${formatCurrency(asset.averagePrice, asset.currency)}`
                                                                    : `investido ${formatCurrency(asset.totalCost, 'BRL')}`}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <div className="text-right">
                                                    <p className="font-bold text-white text-sm">{formatCurrency(asset.totalValue, 'BRL')}</p>
                                                    <p className="flex items-center justify-end gap-2 text-[11px] font-bold">
                                                        {Math.abs(m.rentabilityPct - m.variationPct) >= 0.005 && (
                                                            <>
                                                                <span className={isVarUp ? 'text-emerald-500' : 'text-red-500'} title="Variação do preço (sem proventos)">
                                                                    {isVarUp ? '+' : '-'}{formatPercent(m.variationPct)}
                                                                </span>
                                                                <span className="text-slate-700">·</span>
                                                            </>
                                                        )}
                                                        <span className={`flex items-center gap-0.5 ${isRentUp ? 'text-emerald-500' : 'text-red-500'}`} title="Rentabilidade total (preço + proventos)">
                                                            {isRentUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                                                            {isRentUp ? '+' : '-'}{formatPercent(m.rentabilityPct)}
                                                        </span>
                                                    </p>
                                                </div>
                                                {/* Ações em LINHA: empilhadas na vertical, os ícones esticavam a
                                                    linha p/ ~130px e o "remover" caía ao lado do ativo seguinte,
                                                    dando a impressão de pertencer à linha de baixo.
                                                    Em modo leitura (link público) nenhuma delas existe — inclusive
                                                    o histórico, que é dado privado de transações. */}
                                                {!isReadOnly && <div className="flex items-center">
                                                    {asset.type === 'CASH' && (
                                                        <button
                                                            onClick={() => setRenameTarget({ id: asset.id, name: asset.name || '' })}
                                                            aria-label={`Renomear ${assetTitle(asset)}`}
                                                            className="min-h-[44px] w-9 flex items-center justify-center text-slate-600 hover:text-emerald-400 transition-colors"
                                                        >
                                                            <Pencil size={16} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => setHistoryTicker(asset.ticker)}
                                                        aria-label={`Histórico de ${assetTitle(asset)}`}
                                                        className="min-h-[44px] w-9 flex items-center justify-center text-slate-600 hover:text-blue-400 transition-colors"
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
                                                        className="min-h-[44px] w-9 flex items-center justify-center text-slate-600 hover:text-red-500 transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>}
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
                                {/* Coluna de ações só existe onde há o que fazer: no link
                                    público (leitura) ela sai junto com os botões. */}
                                {!isReadOnly && <th scope="col" className="p-4 font-bold text-center">Ações</th>}
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {visibleTypes.map(type => {
                                const groupItems = groupedAssets[type];
                                const isCollapsed = collapsedGroups[type];
                                
                                const totalValueGroup = groupItems.reduce((acc, item) => acc + (item.totalValue || 0), 0);
                                // Reserva: % do PATRIMÔNIO total (quanto do total está guardado).
                                // Investimento: % da BASE (patrimônio − reserva), coerente com o donut.
                                const isReserveGroup = type === 'CASH';
                                const allocationPercent = isReserveGroup
                                    ? ((kpis.totalEquity || 0) > 0 ? (totalValueGroup / kpis.totalEquity) * 100 : 0)
                                    : (allocationBase > 0 ? (totalValueGroup / allocationBase) * 100 : 0);
                                const idealPercent = targetAllocation[type as AssetType] || 0;
                                const gm = groupMetrics(groupItems);
                                const accent = accentOf(type);
                                const sectorKind = SECTOR_PIE_CLASSES[type];
                                // Ações BR: decompõe o % do grupo em Ações individuais vs ETFs nacionais.
                                const sp = stockSplit(groupItems);
                                const exterior = exteriorSplit(groupItems);
                                const showStockSplit = type === 'STOCK' && sp.etf > 0 && totalValueGroup > 0;
                                const showExteriorSplit = type === 'STOCK_US' && exterior.values.ETF > 0 && totalValueGroup > 0;

                                return (
                                    <React.Fragment key={type}>
                                        <tr
                                            className="bg-panel border-y border-slate-800/50 cursor-pointer hover:bg-elevated transition-colors"
                                            onClick={() => toggleGroup(type)}
                                        >
                                            <td colSpan={isReadOnly ? 7 : 8} className="px-4 py-3">
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
                                                        {/* Donut de concentração setorial sem sair da lista: FII por
                                                            segmento (papel, shopping, logística…), ação por macro-setor. */}
                                                        {sectorKind && (
                                                            <SectorPopover items={groupItems} kind={sectorKind} isPrivacyMode={isPrivacyMode} />
                                                        )}
                                                        {showStockSplit && (
                                                            <span className="text-[10px] text-slate-500 font-semibold normal-case tracking-normal">
                                                                Ações {sp.stockPercent}% · ETFs {sp.etfPercent}%
                                                            </span>
                                                        )}
                                                        {showExteriorSplit && (
                                                            <span className="text-[10px] text-slate-500 font-semibold normal-case tracking-normal">
                                                                {exterior.label}
                                                            </span>
                                                        )}
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

                                                        {/* Reserva/Caixa não entra na Distribuição da Carteira nem na
                                                            Distribuição Ideal — por isso não exibe % de alocação. */}
                                                        {isReserveGroup ? (
                                                            <div className="flex flex-col items-end min-w-[100px]">
                                                                <span className="text-slate-500 font-bold uppercase text-[9px]">Reserva</span>
                                                                <span className="text-slate-400 font-bold text-[11px]">Fora da distribuição</span>
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-col items-end min-w-[100px]">
                                                                {/* A meta é o plano do dono e não é publicada no link:
                                                                    em leitura o rótulo mostra só a alocação real. */}
                                                                <span className="text-slate-500 font-bold uppercase text-[9px]">
                                                                    {isReadOnly ? 'Alocação' : `Alocação (Ideal: ${idealPercent}%)`}
                                                                </span>
                                                                <div className="flex items-center gap-2 w-full justify-end">
                                                                    <span className="text-white font-bold">{allocationPercent.toFixed(1)}%</span>
                                                                    <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                                        <div className={`h-full ${accent.bar}`} style={{ width: `${Math.min(allocationPercent, 100)}%` }}></div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
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
                                            const curveValue = curveValueOf(asset);
                                            const unitPrices = unitPricesOf(asset);

                                            return (
                                                <tr key={asset.id} className="hover:bg-slate-800/30 transition-colors border-b border-slate-800/30 last:border-0 group animate-fade-in">
                                                    <td className="p-4 pl-8">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <AssetLogo ticker={asset.ticker} type={asset.type} currency={asset.currency} name={asset.name} isReserve={isReserveAsset(asset)} size={32} />
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-1.5 min-w-0">
                                                                    <span className="font-bold text-slate-200 truncate">{assetTitle(asset)}</span>
                                                                    <AssetTags tags={getAssetTags(asset)} />
                                                                </div>
                                                                <p className="text-[10px] text-slate-500 truncate">
                                                                    {/* A fração implícita acompanha o PU: sem ela, "R$ 2.984,46"
                                                                        ao lado de um saldo de R$ 746,12 não fecha na cabeça de
                                                                        ninguém. Com ela, 0,25 × 2.984,46 é o próprio saldo. */}
                                                                    {asset.matured
                                                                        ? 'Vencido — sugerimos resgatar'
                                                                        : `${getAssetSubtitle(asset)}${asset.treasuryUnits ? ` · ${formatQuantity(asset.treasuryUnits)} un` : ''}`}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-right text-slate-400 tabular-nums">
                                                        {unitPrices ? formatCurrency(unitPrices.average, asset.currency) : NO_UNIT_PRICE}
                                                    </td>
                                                    <td className="p-4 text-right text-slate-300 tabular-nums font-bold">
                                                        {unitPrices ? formatCurrency(unitPrices.current, asset.currency) : NO_UNIT_PRICE}
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
                                                        {/* RF marcada: o total é o valor de RESGATE hoje. O valor na
                                                            curva (levar ao vencimento) vem logo abaixo — num IPCA+
                                                            longo os dois divergem de verdade, e mostrar só um número
                                                            sem dizer qual é seria enganoso. Substitui a contagem de
                                                            unidades, que em renda fixa não diz nada. */}
                                                        {curveValue !== null ? (
                                                            <p className="text-[10px] text-slate-500 tabular-nums" title="Valor na curva: quanto o título vale levado até o vencimento, pela taxa contratada.">
                                                                na curva {formatCurrency(curveValue, 'BRL')}
                                                            </p>
                                                        ) : !isUSD && (
                                                            <p className="text-[10px] text-slate-500">
                                                                {/* Em RF/caixa a contagem de unidades é tão vazia quanto o
                                                                    preço unitário ("16.800 un" numa reserva). O que ancora
                                                                    o saldo ali é o quanto entrou. */}
                                                                {hasUnitPrice(asset)
                                                                    ? `${formatQuantity(asset.quantity)} un`
                                                                    : `investido ${formatCurrency(asset.totalCost, 'BRL')}`}
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
                                                    {!isReadOnly && <td className="p-4 text-center">
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
                                                    </td>}
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
