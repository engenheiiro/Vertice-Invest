
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, PlusCircle, DollarSign, BarChart2, Tag, ArrowUpCircle, ArrowDownCircle, Search, Info } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useWallet, AssetType } from '../../contexts/WalletContext';
import { walletService } from '../../services/wallet';

interface AddAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AddAssetModal: React.FC<AddAssetModalProps> = ({ isOpen, onClose }) => {
    const { addAsset, assets } = useWallet();
    const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
    const [validationError, setValidationError] = useState('');
    const [transactionType, setTransactionType] = useState<'BUY' | 'SELL'>('BUY');
    const [isSearching, setIsSearching] = useState(false);

    const [form, setForm] = useState({
        ticker: '',
        name: '', 
        type: 'STOCK' as AssetType,
        quantity: '',
        price: '',
        date: new Date().toISOString().split('T')[0]
    });

    // Refs para controle de debounce
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Reset e Bloqueio de Scroll
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            setStatus('idle');
            setValidationError('');
            setTransactionType('BUY'); // Padrão Compra
        } else {
            document.body.style.overflow = 'unset';
            setForm({ ticker: '', name: '', type: 'STOCK', quantity: '', price: '', date: new Date().toISOString().split('T')[0] });
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    useEffect(() => {
        if (form.type === 'CASH') {
            setForm(prev => ({ ...prev, ticker: 'RESERVA', quantity: '', price: '1,00' }));
        } else if (form.type === 'CRYPTO') {
            setForm(prev => ({ ...prev, ticker: '', quantity: '', price: '' }));
        } else {
             // Mantém ticker se já existir, senão limpa
             setForm(prev => ({ ...prev, quantity: '', price: prev.price }));
        }
    }, [form.type]);

    // Função de Busca de Ativo (Auto-fill)
    const handleTickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toUpperCase();
        setForm(prev => ({ ...prev, ticker: val }));

        if (transactionType === 'SELL' || form.type === 'CASH') return;

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (val.length >= 4) {
            setIsSearching(true);
            searchTimeoutRef.current = setTimeout(async () => {
                try {
                    const data = await walletService.searchAsset(val);
                    if (data && data.ticker === val) {
                        setForm(prev => ({ 
                            ...prev, 
                            name: data.name, 
                            price: data.price ? data.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : prev.price 
                        }));
                    }
                } catch (error) {
                    console.error("Ativo não encontrado");
                } finally {
                    setIsSearching(false);
                }
            }, 800);
        }
    };

    // Handler para Seleção de Ativo na Venda
    const handleSellAssetSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedTicker = e.target.value;
        const asset = assets.find(a => a.ticker === selectedTicker);
        
        if (asset) {
            setForm(prev => ({
                ...prev,
                ticker: selectedTicker,
                name: asset.name,
                type: asset.type,
                price: asset.currentPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
            }));
        } else {
            setForm(prev => ({ ...prev, ticker: selectedTicker }));
        }
    };

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if(val === '') { setForm({...form, price: ''}); return; }
        setForm({...form, price: val});
    };
    
    const handlePriceBlur = () => {
        if (!form.price) return;
        let val = form.price.replace(',', '.');
        let num = parseFloat(val);
        if (!isNaN(num)) {
            setForm(prev => ({...prev, price: num.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setValidationError('');
        
        let finalQty = Number(form.quantity.replace(',', '.'));
        let finalPrice = Number(form.price.replace(/\./g, '').replace(',', '.'));

        // Validação Numérica Rigorosa
        if (isNaN(finalQty) || finalQty <= 0) {
            setValidationError('A quantidade deve ser um número maior que zero.');
            return;
        }
        if (isNaN(finalPrice) || finalPrice <= 0) {
            setValidationError('O preço deve ser um valor positivo.');
            return;
        }

        // Validação de Venda (Saldo Insuficiente)
        if (transactionType === 'SELL' && form.type !== 'CASH') {
            const owned = assets.find(a => a.ticker === form.ticker);
            if (!owned || owned.quantity < finalQty) {
                setValidationError(`Saldo insuficiente. Você possui ${owned ? owned.quantity : 0} unid.`);
                return;
            }
            // Negativa a quantidade para venda
            finalQty = -finalQty;
        }

        setStatus('loading');

        try {
            let finalTicker = form.ticker.toUpperCase();

            if (form.type === 'CASH') {
                if (transactionType === 'SELL') finalQty = -1; // Saque
                else finalQty = 1; // Aporte
                // Para CASH, o "preço" inserido é o valor total do aporte
            }

            await addAsset({
                ticker: finalTicker,
                name: form.name || finalTicker,
                type: form.type,
                quantity: finalQty,
                averagePrice: finalPrice,
                currency: form.type === 'STOCK_US' ? 'USD' : 'BRL',
                sector: 'General'
            });

            setStatus('success');
            setTimeout(() => {
                setStatus('idle');
                onClose();
            }, 1000);

        } catch (error) {
            console.error(error);
            setStatus('idle');
            setValidationError("Erro ao processar transação.");
        }
    };

    const renderTickerField = () => {
        if (form.type === 'CASH') {
            return (
                <div className="opacity-50 pointer-events-none">
                     <Input label="Ativo (Automático)" value="RESERVA / CAIXA" readOnly containerClassName="mb-0" />
                </div>
            );
        }

        // Se for VENDA, mostra Select com ativos possuídos do tipo selecionado
        if (transactionType === 'SELL') {
            const availableAssets = assets.filter(a => a.type === form.type);
            
            return (
                <div className="flex flex-col gap-1.5 mb-4">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-1">Ativo para Venda</label>
                    <div className="relative">
                        <select 
                            value={form.ticker}
                            onChange={handleSellAssetSelect}
                            className="w-full bg-[#0B101A] text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-[#0F1729] transition-all duration-300 shadow-sm"
                        >
                            <option value="">Selecione um ativo...</option>
                            {availableAssets.map(a => (
                                <option key={a.ticker} value={a.ticker}>
                                    {a.ticker} - {a.quantity} unid.
                                </option>
                            ))}
                        </select>
                        <Search className="absolute right-3 top-3.5 text-slate-600 pointer-events-none" size={16} />
                    </div>
                    {availableAssets.length === 0 && (
                        <p className="text-[10px] text-red-500 font-bold ml-1">Você não possui ativos desta categoria.</p>
                    )}
                </div>
            );
        }

        // MODO COMPRA (Input com Auto-Search)
        let placeholder = "Ex: PETR4";
        if (form.type === 'CRYPTO') placeholder = "Ex: BTC, ETH, SOL";
        if (form.type === 'STOCK_US') placeholder = "Ex: AAPL, NVDA";

        return (
            <div className="relative mb-4">
                <Input 
                    label="Código / Ticker"
                    placeholder={placeholder}
                    value={form.ticker}
                    onChange={handleTickerChange}
                    containerClassName="mb-0"
                    className="uppercase font-mono tracking-wider px-4 py-3"
                />
                {isSearching && (
                    <div className="absolute right-3 top-9">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                )}
            </div>
        );
    };

    const renderQuantityAndPriceFields = () => {
        if (form.type === 'CASH') {
            const label = transactionType === 'BUY' ? "Valor do Aporte (R$)" : "Valor do Saque (R$)";
            return (
                <div className="col-span-2">
                    <div className="relative">
                        <Input 
                            label={label}
                            placeholder="0,00"
                            value={form.price}
                            onChange={handlePriceChange}
                            onBlur={handlePriceBlur}
                            containerClassName="mb-0"
                            className={`pl-4 text-lg font-bold ${transactionType === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}
                        />
                         <DollarSign className="absolute right-4 top-9 text-slate-500 pointer-events-none" size={20} />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 ml-1">
                        {transactionType === 'BUY' ? '* Adicionado ao saldo da Reserva.' : '* Removido do saldo da Reserva.'}
                    </p>
                </div>
            );
        }

        return (
            <>
                <div className="relative">
                    <Input 
                        label={form.type === 'CRYPTO' ? "Quantidade" : "Quantidade (Cotas)"}
                        type="number"
                        step={form.type === 'CRYPTO' ? "0.00000001" : "1"}
                        placeholder={form.type === 'CRYPTO' ? "0.005" : "100"}
                        value={form.quantity}
                        onChange={(e) => setForm({...form, quantity: e.target.value})}
                        containerClassName="mb-0"
                    />
                    <BarChart2 className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                </div>
                
                <div className="relative">
                    <Input 
                        label="Preço Unitário"
                        placeholder="0,00"
                        value={form.price}
                        onChange={handlePriceChange}
                        onBlur={handlePriceBlur}
                        containerClassName="mb-0"
                    />
                    <DollarSign className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                </div>
            </>
        );
    };

    if (!isOpen) return null;

    // --- USO DE PORTAL: Renderiza diretamente no body ---
    return createPortal(
        <div className="relative z-[100]" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            {/* Container Centralizado */}
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 text-center">
                    
                    {/* Modal Panel - Com max-h para evitar scroll da página em telas pequenas */}
                    <div className="relative transform overflow-hidden rounded-2xl bg-[#080C14] border border-slate-800 text-left shadow-2xl transition-all w-full max-w-lg animate-fade-in my-auto max-h-[90vh] flex flex-col">
                        
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-[#0B101A] shrink-0">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <PlusCircle size={18} className="text-blue-500" />
                                Nova Transação
                            </h2>
                            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* TABS DE TIPO DE TRANSAÇÃO */}
                        <div className="grid grid-cols-2 p-1 bg-[#0F131E] border-b border-slate-800">
                            <button
                                onClick={() => setTransactionType('BUY')}
                                className={`flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-all rounded-lg ${
                                    transactionType === 'BUY' 
                                    ? 'bg-emerald-600 text-white shadow-lg' 
                                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                                }`}
                            >
                                <ArrowUpCircle size={14} /> Comprar / Aportar
                            </button>
                            <button
                                onClick={() => setTransactionType('SELL')}
                                className={`flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-all rounded-lg ${
                                    transactionType === 'SELL' 
                                    ? 'bg-red-600 text-white shadow-lg' 
                                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                                }`}
                            >
                                <ArrowDownCircle size={14} /> Vender / Resgatar
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <form onSubmit={handleSubmit} className="space-y-5">
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="col-span-2">
                                        <label className="text-[10px] font-bold uppercase text-slate-500 ml-1 mb-1.5 block">Tipo de Ativo</label>
                                        <div className="relative">
                                            <select 
                                                value={form.type}
                                                onChange={(e) => setForm({...form, type: e.target.value as AssetType, ticker: ''})} // Limpa ticker ao mudar tipo
                                                className="w-full bg-[#0B101A] text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-[#0F1729] transition-all duration-300 shadow-sm"
                                            >
                                                <option value="STOCK">Ações BR</option>
                                                <option value="FII">Fundos Imobiliários</option>
                                                <option value="STOCK_US">Ações Exterior</option>
                                                <option value="CRYPTO">Criptomoedas</option>
                                                <option value="FIXED_INCOME">Renda Fixa</option>
                                                <option value="CASH">Reserva / Caixa</option>
                                            </select>
                                            <Tag className="absolute right-3 top-3.5 text-slate-600 pointer-events-none" size={14} />
                                        </div>
                                    </div>
                                    <Input 
                                        label="Data" type="date" value={form.date}
                                        onChange={(e) => setForm({...form, date: e.target.value})}
                                        containerClassName="mb-0 col-span-1"
                                    />
                                </div>

                                {renderTickerField()}

                                <div className="grid grid-cols-2 gap-4">
                                    {renderQuantityAndPriceFields()}
                                </div>

                                {form.type !== 'CASH' && (
                                    <div className="relative">
                                        <Input 
                                            label="Descrição (Opcional)" placeholder="Ex: Swing Trade, Longo Prazo..."
                                            value={form.name} onChange={(e) => setForm({...form, name: e.target.value})}
                                            containerClassName="mb-0"
                                        />
                                        <div className="absolute right-0 top-0 group">
                                            <Info size={12} className="text-slate-500 cursor-help" />
                                            <div className="absolute right-0 bottom-full mb-2 w-48 bg-slate-800 text-[10px] text-slate-300 p-2 rounded shadow-xl border border-slate-700 hidden group-hover:block z-20">
                                                Use para identificar estratégias ou metas específicas para este ativo.
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {validationError && (
                                    <p className="text-xs text-red-500 font-bold text-center animate-shake bg-red-900/10 p-2 rounded-lg border border-red-900/20">
                                        {validationError}
                                    </p>
                                )}

                                <div className="pt-4 flex gap-3">
                                    <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancelar</Button>
                                    <Button type="submit" status={status} disabled={form.type !== 'CASH' && (!form.ticker || !form.quantity || !form.price)} className="flex-[2]">Confirmar</Button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
