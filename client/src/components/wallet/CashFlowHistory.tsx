
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, ArrowDownCircle, Calendar, Check, ChevronDown, Loader2, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';
import { DEMO_TRANSACTIONS } from '../../data/DEMO_DATA';
import { formatCalendarDate, formatCurrency as fmtCurrency, formatQuantity, PRIVACY_MASK_SHORT } from '../../utils/format';

interface Transaction {
    _id: string;
    type: 'BUY' | 'SELL';
    ticker: string;
    quantity: number;
    price: number;
    totalValue: number;
    date: string;
    isCashOp: boolean;
    cashName?: string;
    assetClass?: 'STOCK' | 'FII' | 'CRYPTO' | 'FIXED_INCOME' | 'STOCK_US' | 'OURO' | 'CASH';
    assetType?: 'STOCK' | 'FII' | 'ETF' | 'CRYPTO' | 'FIXED_INCOME' | 'STOCK_US' | 'OURO' | 'CASH';
    /** Moeda NATIVA do lançamento (US$ para STOCK_US/CRYPTO). `price` e `totalValue`
     * são gravados nela, não em BRL — formatar tudo como R$ inflava a leitura do
     * extrato e não fechava com o "Valor Aplicado" da carteira. */
    currency?: 'BRL' | 'USD';
}

type FilterType = 'ALL' | 'CASH' | 'TRADE' | 'STOCK' | 'FII' | 'ETF' | 'CRYPTO' | 'FIXED_INCOME' | 'STOCK_US' | 'OURO';

const PRIMARY_FILTERS: { value: Extract<FilterType, 'ALL' | 'CASH' | 'TRADE'>; label: string }[] = [
    { value: 'ALL', label: 'Tudo' },
    { value: 'CASH', label: 'Reserva' },
    { value: 'TRADE', label: 'Investimentos' },
];

const CATEGORY_FILTERS: { value: Exclude<FilterType, 'ALL' | 'CASH' | 'TRADE'>; label: string }[] = [
    { value: 'STOCK', label: 'Ações' },
    { value: 'FII', label: 'FIIs' },
    { value: 'ETF', label: 'ETFs' },
    { value: 'CRYPTO', label: 'Cripto' },
    { value: 'FIXED_INCOME', label: 'Renda Fixa' },
    { value: 'STOCK_US', label: 'Exterior' },
    { value: 'OURO', label: 'Ouro' },
];

const CLASS_LABELS: Record<NonNullable<Transaction['assetClass']>, string> = {
    STOCK: 'AÇÃO',
    FII: 'FII',
    CRYPTO: 'CRIPTO',
    FIXED_INCOME: 'RENDA FIXA',
    STOCK_US: 'EXTERIOR',
    OURO: 'OURO',
    CASH: 'RESERVA',
};

const TYPE_LABELS: Record<NonNullable<Transaction['assetType']>, string> = {
    STOCK: 'AÇÃO',
    FII: 'FII',
    ETF: 'ETF',
    CRYPTO: 'CRIPTO',
    FIXED_INCOME: 'RENDA FIXA',
    STOCK_US: 'EXTERIOR',
    OURO: 'OURO',
    CASH: 'RESERVA',
};

const filterDemoTransactions = (transactions: Transaction[], filter: FilterType) => {
    if (filter === 'ALL') return transactions;
    if (filter === 'CASH') return transactions.filter(tx => tx.isCashOp || tx.assetClass === 'CASH');
    if (filter === 'TRADE') return transactions.filter(tx => !tx.isCashOp && tx.assetClass !== 'CASH');
    if (filter === 'OURO') return transactions.filter(tx => tx.assetClass === 'OURO');
    return transactions.filter(tx => tx.assetType === filter);
};

export const CashFlowHistory = () => {
    
    const { activeWalletId, isWalletScopeReady, isPrivacyMode, dataSource } = useWallet();
    const { isDemoMode } = useDemo();
    const [page, setPage] = useState(1);
    const [activeFilter, setActiveFilter] = useState<FilterType>('ALL');
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isCategoryOpen, setIsCategoryOpen] = useState(false);
    const categoryMenuRef = useRef<HTMLDivElement>(null);

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['cashFlow', activeWalletId, page, activeFilter],
        queryFn: () => dataSource.getCashFlow(page, 15, activeFilter),
        staleTime: 1000 * 60 * 2,
        enabled: !isDemoMode && isWalletScopeReady // Desativa query real no demo; espera o escopo da carteira
    });

    useEffect(() => {
        if (isDemoMode) {
            // Em modo demo, carrega dados estáticos
            setTransactions(filterDemoTransactions(DEMO_TRANSACTIONS.transactions as Transaction[], activeFilter));
            return;
        }

        if (data?.transactions) {
            if (page === 1) {
                setTransactions(data.transactions);
            } else {
                setTransactions(prev => {
                    const newIds = new Set(data.transactions.map((t: Transaction) => t._id));
                    return [...prev.filter(t => !newIds.has(t._id)), ...data.transactions];
                });
            }
        }
    }, [data, page, isDemoMode, activeFilter]);

    useEffect(() => {
        if (!isCategoryOpen) return;
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!categoryMenuRef.current?.contains(event.target as Node)) setIsCategoryOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, [isCategoryOpen]);

    const handleFilterChange = (newFilter: FilterType) => {
        setIsCategoryOpen(false);
        if (newFilter === activeFilter) return;
        setActiveFilter(newFilter);
        setPage(1);
        if (!isDemoMode) setTransactions([]); 
    };

    const loadMore = () => {
        if (!isDemoMode && data?.pagination?.hasMore) {
            setPage(prev => prev + 1);
        }
    };

    const formatCurrency = (val: number, currency: 'BRL' | 'USD' = 'BRL') => fmtCurrency(val, currency, { privacy: isPrivacyMode });
    const isInvestmentFilter = activeFilter !== 'ALL' && activeFilter !== 'CASH';
    const categoryLabel = !isInvestmentFilter
        ? 'Categoria'
        : activeFilter === 'TRADE'
            ? 'Todas as categorias'
            : CATEGORY_FILTERS.find(filter => filter.value === activeFilter)?.label || 'Categoria';

    return (
        <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden min-h-[500px] flex flex-col">
            <div className="p-5 border-b border-slate-800 bg-card flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800 text-blue-500">
                        <FileText size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider">
                            Extrato Global
                        </h3>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                            Histórico de Operações
                        </p>
                    </div>
                </div>

                {/* Filtros */}
                <div className="flex w-full md:w-auto flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="flex bg-deep p-1 rounded-lg border border-slate-800">
                        {PRIMARY_FILTERS.map(filter => (
                            <FilterButton
                                key={filter.value}
                                active={filter.value === 'TRADE' ? isInvestmentFilter : activeFilter === filter.value}
                                onClick={() => handleFilterChange(filter.value)}
                                label={filter.label}
                            />
                        ))}
                    </div>

                    <div ref={categoryMenuRef} className="relative min-w-[190px]">
                        <button
                            type="button"
                            aria-label={`Categoria de investimento: ${categoryLabel}`}
                            aria-haspopup="listbox"
                            aria-expanded={isCategoryOpen}
                            onClick={() => setIsCategoryOpen(open => !open)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') setIsCategoryOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-3 rounded-lg border py-2 pl-3 pr-3 text-[10px] font-bold uppercase outline-none transition-colors ${
                                isInvestmentFilter
                                    ? 'border-blue-500/40 bg-blue-500/10 text-blue-300 focus:ring-2 focus:ring-blue-500/30'
                                    : 'border-slate-800 bg-deep text-slate-500 hover:text-slate-300 focus:ring-2 focus:ring-slate-700'
                            }`}
                        >
                            <span className="truncate">{categoryLabel}</span>
                            <ChevronDown
                                size={14}
                                aria-hidden="true"
                                className={`shrink-0 transition-transform ${isCategoryOpen ? 'rotate-180' : ''} ${isInvestmentFilter ? 'text-blue-400' : 'text-slate-600'}`}
                            />
                        </button>

                        {isCategoryOpen && (
                            <div
                                role="listbox"
                                aria-label="Categorias de investimento"
                                className="absolute right-0 top-[calc(100%+6px)] z-30 w-full min-w-[210px] rounded-xl border border-slate-700 bg-base p-1.5 shadow-2xl shadow-black/60"
                            >
                                {([{ value: 'TRADE', label: 'Todas as categorias' }, ...CATEGORY_FILTERS] as { value: FilterType; label: string }[]).map(filter => {
                                    const selected = activeFilter === filter.value;
                                    return (
                                        <button
                                            key={filter.value}
                                            type="button"
                                            role="option"
                                            aria-label={filter.label}
                                            aria-selected={selected}
                                            onClick={() => handleFilterChange(filter.value)}
                                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[10px] font-bold uppercase transition-colors ${
                                                selected
                                                    ? 'bg-blue-600 text-white'
                                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                            }`}
                                        >
                                            <span>{filter.label}</span>
                                            {selected && <Check size={13} aria-hidden="true" />}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {(isLoading && page === 1 && !isDemoMode) ? (
                    <div className="h-64 flex items-center justify-center">
                        <Loader2 className="animate-spin text-slate-600" />
                    </div>
                ) : transactions.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 bg-slate-900/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-800">
                            <FileText className="text-slate-600" size={24} />
                        </div>
                        <p className="text-slate-400 text-sm font-medium">Nenhum registro encontrado.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-800/50">
                        {transactions.map((tx) => {
                            const isBuy = tx.type === 'BUY';
                            const isCash = tx.isCashOp || tx.ticker === 'RESERVA';
                            const cur = tx.currency ?? 'BRL';

                            let title = '';
                            let subtitle = '';

                            if (isCash) {
                                const cofre = tx.cashName || 'Reserva';
                                title = isBuy ? `Aporte em ${cofre}` : `Resgate de ${cofre}`;
                                subtitle = 'Movimentação de Caixa';
                            } else {
                                title = `${isBuy ? 'Compra' : 'Venda'} de ${tx.ticker}`;
                                // Quantidade sai junto no modo privacidade: com o preço
                                // mascarado, ela sozinha ainda dimensionaria a operação.
                                subtitle = `${isPrivacyMode ? PRIVACY_MASK_SHORT : formatQuantity(tx.quantity)} unid. a ${formatCurrency(tx.price, cur)}`;
                            }

                            return (
                                <div key={tx._id} className="p-4 flex items-center justify-between hover:bg-slate-900/30 transition-colors group">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-2.5 rounded-xl border ${
                                            isBuy 
                                                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                                                : 'bg-red-500/10 text-red-500 border-red-500/20'
                                        }`}>
                                            {isBuy ? <ArrowUpCircle size={18} /> : <ArrowDownCircle size={18} />}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-200 group-hover:text-white transition-colors">
                                                {title}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[10px] text-slate-500 flex items-center gap-1 tabular-nums">
                                                    <Calendar size={10} />
                                                    {formatCalendarDate(tx.date)}
                                                </span>
                                                {!isCash && (
                                                    <span className="text-[10px] text-slate-600 border-l border-slate-700 pl-2">
                                                        {subtitle}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="text-right">
                                        <p className={`text-sm tabular-nums font-bold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {isBuy ? '+' : '-'} {formatCurrency(tx.totalValue, cur)}
                                        </p>
                                        <span className="text-[9px] font-bold uppercase text-slate-600 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                            {isCash
                                                ? 'RESERVA'
                                                : (tx.assetType ? TYPE_LABELS[tx.assetType] : tx.assetClass ? CLASS_LABELS[tx.assetClass] : 'INVESTIMENTO')}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {data?.pagination?.hasMore && !isDemoMode && (
                    <div className="p-4 border-t border-slate-800 bg-card text-center">
                        <button 
                            onClick={loadMore}
                            disabled={isFetching}
                            className="text-xs font-bold text-blue-500 hover:text-blue-400 transition-colors flex items-center justify-center gap-2 w-full"
                        >
                            {isFetching ? <Loader2 size={12} className="animate-spin" /> : 'Carregar Mais Histórico'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const FilterButton = ({ active, onClick, label }: any) => (
    <button
        onClick={onClick}
        aria-pressed={active}
        className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${
            active 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
        }`}
    >
        {label}
    </button>
);
