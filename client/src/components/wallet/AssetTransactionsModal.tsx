
import React, { useEffect } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { X, Trash2, Calendar, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { walletService } from '../../services/wallet';
import { useWallet } from '../../contexts/WalletContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { useDemo } from '../../contexts/DemoContext';
import { formatCalendarDate, formatCurrency as fmtCurrency, PRIVACY_MASK_SHORT } from '../../utils/format';
import AssetLogo from '../common/AssetLogo';

interface Transaction {
    _id: string;
    type: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    totalValue: number;
    date: string;
    /** Moeda nativa do lançamento, resolvida no servidor (gravada > posição > BRL). */
    currency?: 'BRL' | 'USD';
}

interface TransactionsPage {
    transactions: Transaction[];
    pagination: { hasMore: boolean };
}

interface AssetTransactionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    ticker: string;
}

export const AssetTransactionsModal: React.FC<AssetTransactionsModalProps> = ({ isOpen, onClose, ticker }) => {
    const { refreshWallet, assets, activeWalletId, isWalletScopeReady, isPrivacyMode } = useWallet();
    const asset = assets.find((a) => a.ticker === ticker);
    const assetType = asset?.type;
    // Cofrinhos (CASH) exibem o nome amigável; demais ativos, o próprio ticker.
    const displayName = asset?.type === 'CASH' ? (asset.name || 'Reserva') : ticker;
    const { addToast } = useToast();
    const { isDemoMode } = useDemo();
    const confirm = useConfirm();
    const queryClient = useQueryClient();

    // Demo: os ativos são fictícios (DEMO_ASSETS) e não têm extrato. Buscar
    // na API trazia as movimentações REAIS de um ticker homônimo para o tour.
    const queryEnabled = isOpen && !!ticker && !isDemoMode && !!isWalletScopeReady;
    // Extrato paginado em cache por carteira + ativo: reabrir o mesmo ativo mostra
    // na hora o que já veio e revalida por trás (staleTime 0 — uma compra lançada
    // em outro lugar precisa aparecer ao reabrir).
    const transactionsQuery = useInfiniteQuery({
        queryKey: ['walletTransactions', activeWalletId, ticker],
        queryFn: ({ pageParam }): Promise<TransactionsPage> => walletService.getTransactions(ticker, pageParam, 10, activeWalletId),
        initialPageParam: 1,
        getNextPageParam: (last: TransactionsPage, _all: TransactionsPage[], lastPageParam: number) =>
            last?.pagination?.hasMore ? lastPageParam + 1 : undefined,
        enabled: queryEnabled,
        staleTime: 0,
    });
    const transactions: Transaction[] = queryEnabled
        ? (transactionsQuery.data?.pages ?? []).flatMap((p) => p?.transactions ?? [])
        : [];
    const isLoading = queryEnabled && transactionsQuery.isPending;
    const hasMore = queryEnabled && !!transactionsQuery.hasNextPage;
    const isLoadingMore = transactionsQuery.isFetchingNextPage;

    // Trava o scroll da página enquanto o modal está aberto.
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; };
    }, [isOpen]);

    const handleLoadMore = () => {
        if (!isLoadingMore && hasMore) transactionsQuery.fetchNextPage();
    };

    const handleDelete = async (id: string) => {
        // Mutação de carteira no demo é no-op: durante o tour um clique aqui
        // apagaria uma movimentação real do usuário.
        if (isDemoMode) {
            addToast('Modo demonstração: nenhuma movimentação foi alterada.', 'info');
            return;
        }
        const ok = await confirm({
            title: 'Excluir movimentação',
            message: 'Tem certeza que deseja excluir esta movimentação? O preço médio será recalculado.',
            confirmText: 'Excluir',
            isDestructive: true,
        });
        if (!ok) return;

        try {
            await walletService.deleteTransaction(id, activeWalletId);
            // Recarrega o extrato para garantir consistência (preço médio recalculado)
            queryClient.invalidateQueries({ queryKey: ['walletTransactions', activeWalletId, ticker] });
            refreshWallet(); // Invalida queries globais
            addToast('Movimentação excluída.', 'success');
        } catch {
            addToast('Erro ao excluir a movimentação.', 'error');
        }
    };

    // Preço/total da transação são gravados na moeda NATIVA do ativo (US$ para
    // STOCK_US/CRYPTO). Formatar em R$ mostrava "R$ 400,00" numa compra de US$ 400.
    // A moeda vem resolvida do servidor por lançamento; a posição só serve de rede
    // caso a resposta seja de uma versão anterior da API.
    const fallbackCurrency: 'BRL' | 'USD' =
        asset?.currency === 'USD' || assetType === 'STOCK_US' || assetType === 'CRYPTO' ? 'USD' : 'BRL';
    const formatCurrency = (val: number, currency: 'BRL' | 'USD' = fallbackCurrency) =>
        fmtCurrency(val, currency, { privacy: isPrivacyMode });

    if (!isOpen) return null;

    return createPortal(
        <div className="relative z-[150]" role="dialog" aria-modal="true">
            <div role="presentation" className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
            
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-2xl bg-base border border-slate-700 rounded-3xl overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
                        
                        {/* Header */}
                        <div className="p-5 border-b border-slate-800 bg-card flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <AssetLogo ticker={ticker} type={assetType} size={40} />
                                <div>
                                    <h2 className="text-lg font-bold text-white tracking-tight">Extrato: {displayName}</h2>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                        Histórico de Movimentações
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} aria-label="Fechar" className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Listagem */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar bg-deep p-4">
                            {isLoading ? (
                                <div className="flex items-center justify-center py-10">
                                    <Loader2 className="animate-spin text-blue-500" />
                                </div>
                            ) : transactions.length === 0 ? (
                                <div className="text-center py-10 text-slate-500 text-sm">Nenhuma transação encontrada.</div>
                            ) : (
                                <div className="space-y-3">
                                    {transactions.map((tx) => (
                                        <div key={tx._id} className="flex items-center justify-between p-4 rounded-xl bg-panel border border-slate-800 hover:border-slate-700 transition-colors group">
                                            
                                            <div className="flex items-center gap-4">
                                                <div className={`p-2 rounded-lg ${tx.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                                    {tx.type === 'BUY' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-black uppercase ${tx.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            {tx.type === 'BUY' ? 'Compra' : 'Venda'}
                                                        </span>
                                                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                                            <Calendar size={10} />
                                                            {formatCalendarDate(tx.date)}
                                                        </span>
                                                    </div>
                                                    <div className="text-sm font-bold text-white mt-0.5">
                                                        {isPrivacyMode ? PRIVACY_MASK_SHORT : tx.quantity} <span className="text-xs text-slate-500 font-normal">cotas a</span> {formatCurrency(tx.price, tx.currency)}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6">
                                                <div className="text-right">
                                                    <p className="text-[10px] text-slate-500 uppercase font-bold">Total</p>
                                                    <p className="text-sm tabular-nums text-slate-300">{formatCurrency(tx.totalValue, tx.currency)}</p>
                                                </div>
                                                
                                                <button 
                                                    onClick={() => handleDelete(tx._id)}
                                                    className="p-2 text-slate-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Excluir movimentação"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Load More Trigger */}
                                    {hasMore && (
                                        <button 
                                            onClick={handleLoadMore}
                                            disabled={isLoadingMore}
                                            className="w-full py-3 mt-4 text-xs font-bold text-slate-400 hover:text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
                                        >
                                            {isLoadingMore ? <Loader2 className="animate-spin" size={14} /> : 'Carregar Mais Antigas'}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
