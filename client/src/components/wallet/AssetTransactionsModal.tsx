
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Calendar, TrendingUp, TrendingDown, History, Loader2 } from 'lucide-react';
import { walletService } from '../../services/wallet';
import { useWallet } from '../../contexts/WalletContext';

interface Transaction {
    _id: string;
    type: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    totalValue: number;
    date: string;
}

interface AssetTransactionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    ticker: string;
}

export const AssetTransactionsModal: React.FC<AssetTransactionsModalProps> = ({ isOpen, onClose, ticker }) => {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    
    const { refreshWallet } = useWallet();

    // Reset ao abrir
    useEffect(() => {
        if (isOpen && ticker) {
            setTransactions([]);
            setPage(1);
            setHasMore(false);
            loadTransactions(1, true);
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen, ticker]);

    const loadTransactions = async (pageNum: number, isInitial = false) => {
        if (isInitial) setIsLoading(true);
        else setIsLoadingMore(true);

        try {
            const data = await walletService.getTransactions(ticker, pageNum, 10);
            
            if (isInitial) {
                setTransactions(data.transactions);
            } else {
                setTransactions(prev => [...prev, ...data.transactions]);
            }
            
            setHasMore(data.pagination.hasMore);
            setPage(pageNum);

        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
        }
    };

    const handleLoadMore = () => {
        if (!isLoadingMore && hasMore) {
            loadTransactions(page + 1);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Tem certeza que deseja excluir esta movimentação? O preço médio será recalculado.")) return;
        
        try {
            await walletService.deleteTransaction(id);
            // Recarrega a primeira página para garantir consistência
            loadTransactions(1, true);
            refreshWallet(); // Invalida queries globais
        } catch (e) {
            alert("Erro ao excluir.");
        }
    };

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    if (!isOpen) return null;

    return createPortal(
        <div className="relative z-[150]" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
            
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative w-full max-w-2xl bg-[#080C14] border border-slate-700 rounded-3xl overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
                        
                        {/* Header */}
                        <div className="p-5 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800">
                                    <History size={20} className="text-blue-500" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white tracking-tight">Extrato: {ticker}</h2>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                        Histórico de Movimentações
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Listagem */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#05070A] p-4">
                            {isLoading ? (
                                <div className="flex items-center justify-center py-10">
                                    <Loader2 className="animate-spin text-blue-500" />
                                </div>
                            ) : transactions.length === 0 ? (
                                <div className="text-center py-10 text-slate-500 text-sm">Nenhuma transação encontrada.</div>
                            ) : (
                                <div className="space-y-3">
                                    {transactions.map((tx) => (
                                        <div key={tx._id} className="flex items-center justify-between p-4 rounded-xl bg-[#0F131E] border border-slate-800 hover:border-slate-700 transition-colors group">
                                            
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
                                                            {new Date(tx.date).toLocaleDateString('pt-BR')}
                                                        </span>
                                                    </div>
                                                    <div className="text-sm font-bold text-white mt-0.5">
                                                        {tx.quantity} <span className="text-xs text-slate-500 font-normal">cotas a</span> {formatCurrency(tx.price)}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6">
                                                <div className="text-right">
                                                    <p className="text-[10px] text-slate-500 uppercase font-bold">Total</p>
                                                    <p className="text-sm font-mono text-slate-300">{formatCurrency(tx.totalValue)}</p>
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
