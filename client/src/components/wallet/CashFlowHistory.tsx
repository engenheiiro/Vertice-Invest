
import React, { useEffect, useState } from 'react';
import { walletService } from '../../services/wallet';
import { ArrowUpCircle, ArrowDownCircle, Calendar, Loader2, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';

interface Transaction {
    _id: string;
    type: 'BUY' | 'SELL';
    ticker: string;
    quantity: number;
    price: number;
    totalValue: number;
    date: string;
    isCashOp: boolean;
}

type FilterType = 'ALL' | 'CASH' | 'TRADE';

export const CashFlowHistory = () => {
    const { user } = useAuth();
    const [page, setPage] = useState(1);
    const [activeFilter, setActiveFilter] = useState<FilterType>('ALL');
    const [transactions, setTransactions] = useState<Transaction[]>([]);

    // React Query para buscar transações
    // Dependências: page, activeFilter e user.id
    // A chave ['cashFlow'] é invalidada globalmente quando uma transação é adicionada
    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['cashFlow', user?.id, page, activeFilter],
        queryFn: () => walletService.getCashFlow(page, 15, activeFilter),
        staleTime: 1000 * 60 * 2, // 2 minutos
        enabled: !!user?.id
    });

    // Atualiza lista acumulativa quando novos dados chegam
    useEffect(() => {
        if (data?.transactions) {
            if (page === 1) {
                setTransactions(data.transactions);
            } else {
                setTransactions(prev => {
                    // Evita duplicatas ao concatenar (segurança extra)
                    const newIds = new Set(data.transactions.map((t: Transaction) => t._id));
                    return [...prev.filter(t => !newIds.has(t._id)), ...data.transactions];
                });
            }
        }
    }, [data, page]);

    const handleFilterChange = (newFilter: FilterType) => {
        if (newFilter === activeFilter) return;
        setActiveFilter(newFilter);
        setPage(1);
        setTransactions([]); // Limpa visualmente para dar feedback de troca
    };

    const loadMore = () => {
        if (data?.pagination?.hasMore) {
            setPage(prev => prev + 1);
        }
    };

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden min-h-[500px] flex flex-col">
            <div className="p-5 border-b border-slate-800 bg-[#0B101A] flex flex-col md:flex-row justify-between items-center gap-4">
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
                <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                    <FilterButton active={activeFilter === 'ALL'} onClick={() => handleFilterChange('ALL')} label="Tudo" />
                    <FilterButton active={activeFilter === 'CASH'} onClick={() => handleFilterChange('CASH')} label="Reserva" />
                    <FilterButton active={activeFilter === 'TRADE'} onClick={() => handleFilterChange('TRADE')} label="Investimentos" />
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {isLoading && page === 1 ? (
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
                            
                            let title = '';
                            let subtitle = '';
                            
                            if (isCash) {
                                title = isBuy ? 'Aporte na Reserva' : 'Resgate / Uso';
                                subtitle = 'Movimentação de Caixa';
                            } else {
                                title = `${isBuy ? 'Compra' : 'Venda'} de ${tx.ticker}`;
                                subtitle = `${tx.quantity} unid. a ${formatCurrency(tx.price)}`;
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
                                                <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                                                    <Calendar size={10} />
                                                    {new Date(tx.date).toLocaleDateString('pt-BR')}
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
                                        <p className={`text-sm font-mono font-bold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {isBuy ? '+' : '-'} {formatCurrency(tx.totalValue)}
                                        </p>
                                        <span className="text-[9px] font-bold uppercase text-slate-600 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                            {isCash ? 'CAIXA' : 'TRADE'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {data?.pagination?.hasMore && (
                    <div className="p-4 border-t border-slate-800 bg-[#0B101A] text-center">
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
        className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${
            active 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
        }`}
    >
        {label}
    </button>
);
