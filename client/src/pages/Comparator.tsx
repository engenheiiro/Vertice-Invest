
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/dashboard/Header';
import { researchService, RankingItem } from '../services/research';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { formatCurrency, formatPercent } from '../utils/format';
import { SkeletonCard } from '../components/ui';
import { EmptyState } from '../components/ui/EmptyState';
import { GitCompare, Crown, Search, X, Plus, Shield, Target, Zap } from 'lucide-react';

const ASSET_CLASSES: { id: string; label: string }[] = [
    { id: 'STOCK', label: 'Ações BR' },
    { id: 'FII', label: 'FIIs' },
    { id: 'CRYPTO', label: 'Cripto' },
    { id: 'STOCK_US', label: 'Exterior' },
    { id: 'ETF', label: 'ETFs' },
];

const MAX_COMPARE = 3;

const getCurrency = (item: RankingItem): 'BRL' | 'USD' =>
    (item.type === 'CRYPTO' || item.type === 'STOCK_US') ? 'USD' : 'BRL';

const getActionBadge = (action: RankingItem['action']) => (
    <span className={`text-[10px] font-black tracking-tight px-2 py-1 rounded-lg border ${action === 'BUY' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-400 bg-slate-800 border-slate-700'}`}>
        {action === 'BUY' ? 'COMPRAR' : 'AGUARDAR'}
    </span>
);

const getRiskBadge = (profile?: string) => {
    if (profile === 'DEFENSIVE') return <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-900/30 text-emerald-400 border border-emerald-900/50 inline-flex items-center gap-1"><Shield size={10} /> Defensivo</span>;
    if (profile === 'MODERATE') return <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-blue-900/30 text-blue-400 border border-blue-900/50 inline-flex items-center gap-1"><Target size={10} /> Moderado</span>;
    if (profile === 'BOLD') return <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-purple-900/30 text-purple-400 border border-purple-900/50 inline-flex items-center gap-1"><Zap size={10} /> Arrojado</span>;
    return <span className="text-slate-600">-</span>;
};

interface MetricRow {
    label: string;
    get: (item: RankingItem) => string;
    higherIsBetter?: boolean;
    rawValue?: (item: RankingItem) => number | null;
}

export const Comparator = () => {
    const navigate = useNavigate();
    const { hasPlan } = useFeatureAccess();
    const hasAccess = hasPlan('PRO');

    const [assetClass, setAssetClass] = useState('STOCK');
    const [ranking, setRanking] = useState<RankingItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<RankingItem[]>([]);

    useEffect(() => {
        if (!hasAccess) {
            setIsLoading(false);
            return;
        }
        let active = true;
        setIsLoading(true);
        researchService.getLatest(assetClass, 'BUY_HOLD')
            .then((data) => { if (active) setRanking(data?.content?.ranking || []); })
            .catch(() => { if (active) setRanking([]); })
            .finally(() => { if (active) setIsLoading(false); });
        return () => { active = false; };
    }, [assetClass, hasAccess]);

    const searchResults = useMemo(() => {
        const term = search.trim().toUpperCase();
        return ranking
            .filter((r) => !selected.some((s) => s.ticker === r.ticker))
            .filter((r) => !term || r.ticker.toUpperCase().includes(term) || r.name.toUpperCase().includes(term))
            .slice(0, 8);
    }, [ranking, search, selected]);

    const addAsset = (item: RankingItem) => {
        if (selected.length >= MAX_COMPARE) return;
        setSelected((prev) => [...prev, item]);
        setSearch('');
    };

    const removeAsset = (ticker: string) => {
        setSelected((prev) => prev.filter((s) => s.ticker !== ticker));
    };

    const rows: MetricRow[] = useMemo(() => [
        { label: 'Score', get: (i) => i.score.toFixed(0), higherIsBetter: true, rawValue: (i) => i.score },
        { label: 'Preço Atual', get: (i) => formatCurrency(i.currentPrice, getCurrency(i)) },
        { label: 'Preço-Alvo', get: (i) => formatCurrency(i.targetPrice, getCurrency(i)) },
        {
            label: 'Upside',
            get: (i) => i.currentPrice > 0 ? formatPercent(((i.targetPrice / i.currentPrice) - 1) * 100, { sign: true }) : 'N/A',
            higherIsBetter: true,
            rawValue: (i) => i.currentPrice > 0 ? ((i.targetPrice / i.currentPrice) - 1) * 100 : null,
        },
        { label: 'P/L', get: (i) => i.metrics.pl != null ? i.metrics.pl.toFixed(2) : 'N/A' },
        { label: 'P/VP', get: (i) => i.metrics.pvp != null ? i.metrics.pvp.toFixed(2) : 'N/A' },
        {
            label: 'Dividend Yield',
            get: (i) => i.metrics.dy != null ? formatPercent(i.metrics.dy) : 'N/A',
            higherIsBetter: true,
            rawValue: (i) => i.metrics.dy ?? null,
        },
        {
            label: 'ROE',
            get: (i) => i.metrics.roe != null ? formatPercent(i.metrics.roe) : 'N/A',
            higherIsBetter: true,
            rawValue: (i) => i.metrics.roe ?? null,
        },
        { label: 'Margem Líquida', get: (i) => i.metrics.netMargin != null ? formatPercent(i.metrics.netMargin) : 'N/A' },
        { label: 'Beta', get: (i) => i.metrics.beta != null ? i.metrics.beta.toFixed(2) : 'N/A' },
        { label: 'Volatilidade', get: (i) => i.metrics.volatility != null ? formatPercent(i.metrics.volatility) : 'N/A' },
    ], []);

    const bestTicker = (row: MetricRow): string | null => {
        if (!row.higherIsBetter || !row.rawValue) return null;
        let best: { ticker: string; val: number } | null = null;
        for (const item of selected) {
            const val = row.rawValue(item);
            if (val === null || isNaN(val)) continue;
            if (!best || val > best.val) best = { ticker: item.ticker, val };
        }
        return best?.ticker ?? null;
    };

    if (!hasAccess) {
        return (
            <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30">
                <Header />
                <main id="main-content" tabIndex={-1} className="max-w-[1600px] mx-auto p-4 md:p-6 animate-fade-in">
                    <div className="flex flex-col items-center justify-center py-20 bg-base border border-slate-800 rounded-3xl p-10 text-center">
                        <Crown size={40} className="text-blue-500 mb-6" />
                        <h2 className="text-2xl font-black text-white mb-3">Conteúdo Exclusivo PRO</h2>
                        <p className="text-slate-400 max-w-sm mb-8">
                            O comparador de ativos é reservado para assinantes do plano PRO ou superior.
                        </p>
                        <button onClick={() => navigate('/pricing')} className="px-8 py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/20">
                            Fazer Upgrade
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main id="main-content" tabIndex={-1} className="max-w-[1600px] mx-auto p-4 md:p-6 animate-fade-in">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                            <GitCompare className="text-blue-500" />
                            Comparador de Ativos
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">Compare até {MAX_COMPARE} ativos lado a lado pelas métricas-chave do ranking quant.</p>
                    </div>
                </div>

                {/* Seletor de classe + busca */}
                <div className="bg-base border border-slate-800 rounded-2xl p-4 mb-6">
                    <div className="flex gap-1.5 mb-4 flex-wrap" role="tablist" aria-label="Classe de ativo">
                        {ASSET_CLASSES.map((c) => (
                            <button
                                key={c.id}
                                role="tab"
                                aria-selected={assetClass === c.id}
                                onClick={() => setAssetClass(c.id)}
                                className={`min-h-[44px] px-4 rounded-lg text-xs font-bold transition-colors ${assetClass === c.id ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'}`}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>

                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={selected.length >= MAX_COMPARE ? `Máximo de ${MAX_COMPARE} ativos selecionados` : 'Buscar ticker ou nome...'}
                            disabled={selected.length >= MAX_COMPARE}
                            className="w-full bg-card border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                            aria-label="Buscar ativo para comparar"
                        />
                    </div>

                    {search && searchResults.length > 0 && (
                        <ul className="mt-2 border border-slate-800 rounded-xl divide-y divide-slate-800/70 overflow-hidden max-h-64 overflow-y-auto custom-scrollbar">
                            {searchResults.map((item) => (
                                <li key={item.ticker}>
                                    <button
                                        onClick={() => addAsset(item)}
                                        className="w-full min-h-[44px] flex items-center justify-between px-4 py-2 text-left hover:bg-slate-900/60 transition-colors"
                                    >
                                        <span className="flex flex-col">
                                            <span className="text-sm font-bold text-white">{item.ticker}</span>
                                            <span className="text-[11px] text-slate-500 truncate max-w-[260px]">{item.name}</span>
                                        </span>
                                        <span className="flex items-center gap-2 text-blue-400 shrink-0">
                                            <span className="text-xs font-bold">{item.score.toFixed(0)}</span>
                                            <Plus size={16} />
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Chips dos ativos selecionados */}
                    {selected.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4">
                            {selected.map((item) => (
                                <span key={item.ticker} className="inline-flex items-center gap-2 bg-blue-900/20 border border-blue-900/40 text-blue-300 rounded-lg pl-3 pr-1.5 py-1.5 text-xs font-bold">
                                    {item.ticker}
                                    <button
                                        onClick={() => removeAsset(item.ticker)}
                                        aria-label={`Remover ${item.ticker} da comparação`}
                                        className="min-h-[28px] min-w-[28px] flex items-center justify-center text-blue-400 hover:text-white rounded-md hover:bg-blue-900/40 transition-colors"
                                    >
                                        <X size={14} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Tabela comparativa */}
                {isLoading ? (
                    <SkeletonCard className="h-72" />
                ) : selected.length < 2 ? (
                    <EmptyState
                        icon={<GitCompare size={28} />}
                        title="Selecione ao menos 2 ativos"
                        description="Busque e adicione de 2 a 3 ativos acima para ver a comparação lado a lado."
                    />
                ) : (
                    <div className="bg-base border border-slate-800 rounded-2xl overflow-x-auto">
                        <table className="w-full text-left text-sm min-w-[480px]">
                            <thead className="bg-card">
                                <tr>
                                    <th scope="col" className="p-4 font-bold text-slate-500 uppercase text-[11px] sticky left-0 bg-card">Métrica</th>
                                    {selected.map((item) => (
                                        <th key={item.ticker} scope="col" className="p-4 font-bold text-white min-w-[140px]">
                                            <div className="flex flex-col">
                                                <span>{item.ticker}</span>
                                                <span className="text-[10px] text-slate-500 font-normal truncate max-w-[160px]">{item.name}</span>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                <tr>
                                    <th scope="row" className="p-4 text-slate-400 font-bold text-xs sticky left-0 bg-base">Ação</th>
                                    {selected.map((item) => (
                                        <td key={item.ticker} className="p-4">{getActionBadge(item.action)}</td>
                                    ))}
                                </tr>
                                <tr>
                                    <th scope="row" className="p-4 text-slate-400 font-bold text-xs sticky left-0 bg-base">Perfil de Risco</th>
                                    {selected.map((item) => (
                                        <td key={item.ticker} className="p-4">{getRiskBadge(item.riskProfile)}</td>
                                    ))}
                                </tr>
                                {rows.map((row) => {
                                    const winner = bestTicker(row);
                                    return (
                                        <tr key={row.label}>
                                            <th scope="row" className="p-4 text-slate-400 font-bold text-xs sticky left-0 bg-base">{row.label}</th>
                                            {selected.map((item) => (
                                                <td
                                                    key={item.ticker}
                                                    className={`p-4 font-mono ${winner === item.ticker ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}
                                                >
                                                    {row.get(item)}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>
        </div>
    );
};
