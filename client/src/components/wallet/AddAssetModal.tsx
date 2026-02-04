
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, PlusCircle, DollarSign, BarChart2, Tag, ArrowUpCircle, ArrowDownCircle, Search, Loader2, Clock, CheckCircle2, TrendingUp, Percent, Edit3, ShieldCheck } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useWallet, AssetType } from '../../contexts/WalletContext';
import { walletService } from '../../services/wallet';
import { marketService } from '../../services/market';

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
    
    const [isFetchingPrice, setIsFetchingPrice] = useState(false);
    const [priceSource, setPriceSource] = useState<'manual' | 'historical'>('manual');
    const [historicalDateFound, setHistoricalDateFound] = useState<string | null>(null);
    const [isCurrentPrice, setIsCurrentPrice] = useState(false); 
    
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);

    const [form, setForm] = useState({
        ticker: '',
        name: '', 
        type: 'STOCK' as AssetType,
        quantity: '',
        price: '',
        rate: '', 
        date: new Date().toISOString().split('T')[0]
    });

    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const priceFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const modalRef = useRef<HTMLDivElement>(null);

    // Reset ao abrir o modal
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            setStatus('idle');
            setValidationError('');
            setTransactionType('BUY');
            setSearchResults([]);
            setPriceSource('manual');
            setHistoricalDateFound(null);
            setIsCurrentPrice(false);
            // Default inicial limpo
            setForm({ 
                ticker: '', 
                name: '', 
                type: 'STOCK', 
                quantity: '', 
                price: '', 
                rate: '', 
                date: new Date().toISOString().split('T')[0] 
            }); 
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    // Busca de Preço Automático
    useEffect(() => {
        if (!isOpen || form.type === 'CASH' || form.type === 'FIXED_INCOME' || !form.ticker || form.ticker.length < 3 || !form.date) {
            return;
        }
        
        if (priceFetchTimeoutRef.current) clearTimeout(priceFetchTimeoutRef.current);

        setIsFetchingPrice(true);
        setHistoricalDateFound(null);
        setIsCurrentPrice(false);

        priceFetchTimeoutRef.current = setTimeout(async () => {
            try {
                const today = new Date().toISOString().split('T')[0];
                let priceData = null;
                let isLive = false;

                if (form.date === today) {
                    const quote = await marketService.getCurrentQuote(form.ticker);
                    if (quote && quote.price > 0) {
                        priceData = { price: quote.price };
                        isLive = true;
                    }
                } else if (form.date < today) {
                    const history = await marketService.getHistoricalPrice(form.ticker, form.date, form.type);
                    if (history && history.price > 0) {
                        priceData = history;
                    }
                }
                
                if (priceData && priceData.price) {
                    const fmtPrice = priceData.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    setForm(prev => ({ ...prev, price: fmtPrice }));
                    setPriceSource('historical'); 
                    if (isLive) setIsCurrentPrice(true);
                    else if (priceData.foundDate && priceData.foundDate !== form.date) setHistoricalDateFound(priceData.foundDate); 
                } else {
                    setPriceSource('manual');
                }
            } catch (err) {
                console.error("Erro ao buscar preço", err);
            } finally {
                setIsFetchingPrice(false);
            }
        }, 800);

    }, [form.date, form.ticker, form.type, isOpen]);

    // Fechar dropdown ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedDate = e.target.value;
        setForm(prev => ({ ...prev, date: selectedDate }));
    };

    const handleTypeSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newType = e.target.value as AssetType;
        
        let defaultRate = '';
        let defaultQty = '';
        let defaultTicker = ''; 

        if (newType === 'FIXED_INCOME') {
            defaultRate = '10,00';
            defaultQty = '1';
        } else if (newType === 'CASH') {
            defaultTicker = 'RESERVA';
            defaultQty = ''; // Valor monetário vai no price
        }

        setForm(prev => ({
            ...prev,
            type: newType,
            ticker: defaultTicker,
            rate: defaultRate,
            quantity: defaultQty,
            price: '' 
        }));
    };

    const handleTickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toUpperCase();
        setForm(prev => ({ ...prev, ticker: val }));

        if (transactionType === 'SELL' || form.type === 'CASH') return;

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        const minChars = form.type === 'FIXED_INCOME' ? 2 : 3;

        if (val.length >= minChars) {
            setIsSearching(true);
            searchTimeoutRef.current = setTimeout(async () => {
                try {
                    const results = await walletService.searchAsset(val);
                    if (results && Array.isArray(results) && results.length > 0) {
                        setSearchResults(results);
                        setShowDropdown(true);
                    } else {
                        if (form.type === 'FIXED_INCOME') {
                            setSearchResults([{
                                ticker: val,
                                name: `Criar: ${val}`,
                                type: 'FIXED_INCOME',
                                isManual: true
                            }]);
                            setShowDropdown(true);
                        } else {
                            setSearchResults([]);
                            setShowDropdown(false);
                        }
                    }
                } catch (error) {
                    console.error("Erro busca");
                } finally {
                    setIsSearching(false);
                }
            }, 300);
        } else {
            setSearchResults([]);
            setShowDropdown(false);
        }
    };

    const handleSelectResult = (result: any) => {
        let rateVal = form.rate;
        // Auto-preenche a taxa se disponível e válida no resultado da busca
        if (result.rate !== undefined && result.rate !== null) {
            rateVal = result.rate.toString().replace('.', ',');
            if (!rateVal.includes(',')) rateVal += ',00';
        }

        const finalTicker = result.isManual ? result.ticker : (result.ticker || result.name);
        const finalName = result.name || result.ticker;
        const finalType = result.type ? (result.type as AssetType) : form.type;
        
        const finalQty = finalType === 'FIXED_INCOME' ? '1' : form.quantity;

        setForm(prev => ({ 
            ...prev, 
            ticker: finalTicker, 
            name: finalName, 
            type: finalType,
            rate: rateVal, 
            quantity: finalQty
        }));
        
        setShowDropdown(false);
        setSearchResults([]);
    };

    const handleSellAssetSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedTicker = e.target.value;
        const asset = assets.find(a => a.ticker === selectedTicker);
        if (asset) {
            setForm(prev => ({
                ...prev,
                ticker: selectedTicker,
                name: asset.name || '',
                type: asset.type,
                price: asset.currentPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
            }));
        } else {
            setForm(prev => ({ ...prev, ticker: selectedTicker }));
        }
    };

    const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value;
        if (val.includes('-')) return;
        setForm({ ...form, quantity: val });
    };

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value;
        if (val.includes('-')) return;
        setForm({...form, price: val});
        setPriceSource('manual'); 
        setIsCurrentPrice(false);
    };
    
    const parseCurrencyToFloat = (value: string) => {
        if (!value) return NaN;
        let clean = value.replace(/\./g, '').replace(',', '.');
        return parseFloat(clean);
    };

    const handlePriceBlur = () => {
        if (!form.price) return;
        let num = parseCurrencyToFloat(form.price);
        if (!isNaN(num) && num >= 0) {
            setForm(prev => ({...prev, price: num.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setValidationError('');
        
        let finalQty = 0;
        let finalPrice = 0;

        if (form.type === 'CASH') {
            const rawAmount = parseCurrencyToFloat(form.price);
            if (isNaN(rawAmount) || rawAmount <= 0) {
                setValidationError('O valor deve ser válido.');
                return;
            }
            finalQty = rawAmount;
            finalPrice = 1;
            
            if (transactionType === 'SELL') {
                const owned = assets.find(a => a.ticker === 'RESERVA');
                if (!owned || owned.quantity < finalQty) {
                    setValidationError(`Saldo insuficiente. Disponível: ${owned ? owned.quantity.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}) : 'R$ 0,00'}`);
                    return;
                }
                finalQty = -finalQty;
            }

        } else {
            finalQty = parseFloat(form.quantity.replace(',', '.')); 
            finalPrice = parseCurrencyToFloat(form.price);

            if (isNaN(finalQty) || finalQty <= 0) {
                setValidationError('A quantidade deve ser um número válido maior que zero.');
                return;
            }
            if (isNaN(finalPrice) || finalPrice < 0) { 
                setValidationError('O preço deve ser um valor válido.');
                return;
            }

            if (transactionType === 'SELL') {
                const owned = assets.find(a => a.ticker === form.ticker);
                if (!owned || owned.quantity < finalQty) {
                    setValidationError(`Saldo insuficiente. Você possui ${owned ? owned.quantity : 0} unid.`);
                    return;
                }
                finalQty = -finalQty;
            }
        }

        let finalRate = form.rate ? parseFloat(form.rate.replace(',', '.')) : 0;

        setStatus('loading');

        try {
            let finalTicker = form.ticker.toUpperCase();

            await addAsset({
                ticker: finalTicker,
                name: form.name || finalTicker,
                type: form.type,
                quantity: finalQty,
                price: finalPrice, 
                averagePrice: finalPrice, 
                currency: form.type === 'STOCK_US' ? 'USD' : 'BRL',
                sector: 'General',
                date: form.date,
                fixedIncomeRate: finalRate
            });

            setStatus('success');
            setTimeout(() => {
                setStatus('idle');
                onClose();
            }, 1000);

        } catch (error) {
            console.error(error);
            setStatus('idle');
            setValidationError("Erro ao processar transação. Verifique os dados.");
        }
    };

    const renderTickerField = () => {
        if (form.type === 'CASH') {
            return (
                <div className="opacity-80 pointer-events-none">
                     <Input label="Ativo (Automático)" value="RESERVA / CAIXA" readOnly containerClassName="mb-0" />
                     {/* INDICADOR VISUAL REFORÇADO */}
                     <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-emerald-900/20 border border-emerald-900/50 rounded-lg">
                        <ShieldCheck size={14} className="text-emerald-500" />
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">
                            Rentabilidade: 100% do CDI (Padrão)
                        </span>
                     </div>
                </div>
            );
        }

        if (transactionType === 'SELL') {
            const availableAssets = assets.filter(a => a.type === form.type && a.quantity > 0);
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
                        <p className="text-[10px] text-red-500 font-bold ml-1">Você não possui ativos desta categoria para vender.</p>
                    )}
                </div>
            );
        }

        let placeholder = "Ex: PETR4";
        if (form.type === 'CRYPTO') placeholder = "Ex: BTC, ETH";
        if (form.type === 'STOCK_US') placeholder = "Ex: AAPL, NVDA";
        if (form.type === 'FIXED_INCOME') placeholder = "Busque: Tesouro, Nubank, CDB...";

        return (
            <div className="relative mb-4" ref={modalRef}>
                <Input 
                    label={form.type === 'FIXED_INCOME' ? "Nome do Título / Produto" : "Código / Ticker"}
                    placeholder={placeholder}
                    value={form.ticker}
                    onChange={handleTickerChange}
                    onFocus={() => { if(searchResults.length > 0) setShowDropdown(true); }}
                    containerClassName="mb-0"
                    className="uppercase font-mono tracking-wider px-4 py-3"
                />
                
                {isSearching && (
                    <div className="absolute right-3 top-9">
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    </div>
                )}

                {showDropdown && searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-[#0F1729] border border-slate-700 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto custom-scrollbar animate-fade-in">
                        {searchResults.map((result, idx) => (
                            <div 
                                key={idx}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleSelectResult(result);
                                }}
                                className="p-3 hover:bg-slate-800 cursor-pointer border-b border-slate-800/50 last:border-0 flex justify-between items-center transition-colors"
                            >
                                <div>
                                    <p className="text-xs font-bold text-white uppercase flex items-center gap-2">
                                        {result.ticker}
                                        {result.isManual && <Edit3 size={10} className="text-blue-400" />}
                                    </p>
                                    <p className="text-[10px] text-slate-400 truncate max-w-[200px]">{result.name}</p>
                                </div>
                                <div className="text-right">
                                    <span className="text-[9px] font-bold bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">
                                        {result.type === 'STOCK' ? 'AÇÃO' : 
                                         result.type === 'FIXED_INCOME' ? 'RENDA FIXA' : 
                                         result.type}
                                    </span>
                                    {(result.rate !== undefined) && (
                                        <p className="text-[9px] text-emerald-400 font-mono mt-0.5">{result.rate}% do {result.index || 'CDI'}</p>
                                    )}
                                </div>
                            </div>
                        ))}
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
                            className={`px-4 py-3 text-lg font-bold ${transactionType === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}
                            min="0"
                        />
                         <DollarSign className="absolute right-4 top-9 text-slate-500 pointer-events-none" size={20} />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 ml-1">
                        {transactionType === 'BUY' ? '* Adicionado ao saldo da Reserva.' : '* Removido do saldo da Reserva.'}
                    </p>
                </div>
            );
        }

        if (form.type === 'FIXED_INCOME') {
            return (
                <>
                    <div className="relative">
                        <Input 
                            label="Valor Total Investido (R$)"
                            placeholder="0,00"
                            value={form.price}
                            onChange={handlePriceChange}
                            onBlur={handlePriceBlur}
                            containerClassName="mb-0"
                            className="px-4 py-3 text-emerald-400 font-bold"
                        />
                        <DollarSign className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                    </div>
                    
                    <div className="relative">
                        <Input 
                            label="Rentabilidade"
                            placeholder="Ex: 11,50 ou 115"
                            value={form.rate}
                            onChange={(e) => setForm({...form, rate: e.target.value})}
                            containerClassName="mb-0"
                        />
                        <Percent className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                    </div>
                </>
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
                        onChange={handleQuantityChange}
                        containerClassName="mb-0"
                        min="0"
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
                        min="0"
                        className={priceSource === 'historical' ? 'px-4 py-3 border-blue-500/50 text-blue-100 bg-blue-900/10' : ''}
                    />
                    
                    <div className="absolute right-3 top-9 pointer-events-none">
                        {isFetchingPrice ? (
                            <Loader2 className="animate-spin text-blue-500" size={16} />
                        ) : priceSource === 'historical' ? (
                            <div className="group relative">
                                {isCurrentPrice ? (
                                    <TrendingUp className="text-emerald-400 animate-fade-in" size={16} />
                                ) : (
                                    <Clock className="text-blue-400 animate-fade-in" size={16} />
                                )}
                            </div>
                        ) : (
                            <DollarSign className="text-slate-600" size={16} />
                        )}
                    </div>

                    {priceSource === 'historical' && !isFetchingPrice && (
                        <div className={`absolute -bottom-5 left-1 flex items-center gap-1 text-[9px] font-medium animate-fade-in ${isCurrentPrice ? 'text-emerald-400' : 'text-blue-400'}`}>
                            {isCurrentPrice ? (
                                <>
                                    <CheckCircle2 size={10} />
                                    Preço Atual de Mercado
                                </>
                            ) : (
                                <>
                                    <Clock size={10} />
                                    {historicalDateFound 
                                        ? `Preço aprox. de ${new Date(historicalDateFound).toLocaleDateString('pt-BR')}`
                                        : 'Preço histórico sugerido'
                                    }
                                </>
                            )}
                        </div>
                    )}
                </div>
            </>
        );
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="relative z-[100]" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 text-center">
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
                                                onChange={handleTypeSelectChange} 
                                                className="w-full bg-[#0B101A] text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-[#0F1729] transition-all duration-300 shadow-sm"
                                            >
                                                <option value="STOCK">Ações Brasil</option>
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
                                        label="Data do Aporte" type="date" value={form.date}
                                        onChange={handleDateChange}
                                        containerClassName="mb-0 col-span-1"
                                    />
                                </div>

                                {renderTickerField()}

                                {form.type !== 'CASH' && (
                                    <Input 
                                        label="Nome do Ativo" 
                                        placeholder={form.ticker ? form.ticker : "Preenchimento automático..."}
                                        value={form.name} 
                                        onChange={(e) => setForm({...form, name: e.target.value})}
                                        containerClassName="mb-0"
                                        className="bg-[#0B101A] text-slate-300 border-slate-800 focus:border-slate-600 px-4 py-3"
                                    />
                                )}

                                <div className="grid grid-cols-2 gap-4">
                                    {renderQuantityAndPriceFields()}
                                </div>

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
