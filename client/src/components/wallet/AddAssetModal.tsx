import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, PlusCircle, DollarSign, BarChart2, Tag, ArrowUpCircle, ArrowDownCircle, Search, Loader2, Clock, CheckCircle2, TrendingUp, Percent, Edit3, ShieldCheck, PiggyBank } from 'lucide-react';
import { Input } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { useWallet, AssetType } from '../../contexts/WalletContext';
import { useToast } from '../../contexts/ToastContext';
import { usePriceFetch } from '../../hooks/usePriceFetch';
import { useAssetSearch } from '../../hooks/useAssetSearch';
import {
    getLocalDateString,
    parseCurrencyToFloat,
    validateTransaction,
    makeReserveTicker,
    type AssetFormState,
} from '../../utils/assetTransaction';
import { formatCurrency as fmtCurrency } from '../../utils/format';
import AssetLogo from '../common/AssetLogo';

interface AddAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const INITIAL_FORM: AssetFormState = {
    ticker: '',
    name: '',
    type: 'STOCK',
    quantity: '',
    price: '',
    rate: '',
    date: getLocalDateString(),
};

export const AddAssetModal: React.FC<AddAssetModalProps> = ({ isOpen, onClose }) => {
    const { addAsset, assets, usdRate } = useWallet();
    const { addToast } = useToast();

    const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
    const [validationError, setValidationError] = useState('');
    const [transactionType, setTransactionType] = useState<'BUY' | 'SELL'>('BUY');
    const [priceWarning, setPriceWarning] = useState<string | null>(null);

    const [form, setForm] = useState<AssetFormState>(INITIAL_FORM);
    // Tracks the "total value" input for fractional dollar-denominated assets
    // (CRYPTO and STOCK_US). String so we can display a clean empty state.
    const [totalValueInput, setTotalValueInput] = useState('');

    // CASH (Reserva/Caixa): qual "cofrinho" a transação afeta.
    // '' = nenhum selecionado · NEW_RESERVE = criar um novo · senão = ticker do existente.
    const NEW_RESERVE = '__NEW__';
    const [cashSelection, setCashSelection] = useState<string>(NEW_RESERVE);
    const reserves = assets.filter(a => a.type === 'CASH');

    // Concerns extraídas (M3): busca de preço e autocomplete de ticker.
    const priceFetch = usePriceFetch({ isOpen, form, setForm });
    const search = useAssetSearch({ form, transactionType, setForm });

    // Reset ao abrir o modal.
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            setStatus('idle');
            setValidationError('');
            setPriceWarning(null);
            setTransactionType('BUY');
            setCashSelection(NEW_RESERVE);
            setForm({ ...INITIAL_FORM, date: getLocalDateString() });
            setTotalValueInput('');
            priceFetch.reset();
            search.reset();
        } else {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Validação de preço (warning) — desvio da cotação de referência ou data antiga.
    useEffect(() => {
        if (!form.price) {
            setPriceWarning(null);
            return;
        }

        const userPrice = parseCurrencyToFloat(form.price);
        if (isNaN(userPrice)) return;

        const suggestedPrice = priceFetch.suggestedPrice;

        // Caso 1: existe preço de referência e o usuário desviou > 10%.
        if (suggestedPrice && suggestedPrice > 0) {
            const percentDiff = (Math.abs(userPrice - suggestedPrice) / suggestedPrice) * 100;
            if (percentDiff > 10) {
                setPriceWarning(`Atenção: O preço inserido difere ${percentDiff.toFixed(0)}% da cotação de referência (R$ ${suggestedPrice.toFixed(2)}).`);
                return;
            }
        }

        // Caso 2: preço manual com data antiga (> 7 dias).
        if (!suggestedPrice && form.date) {
            const diffDays = (new Date().getTime() - new Date(form.date).getTime()) / (1000 * 3600 * 24);
            if (diffDays > 7 && form.type !== 'FIXED_INCOME' && form.type !== 'CASH') {
                setPriceWarning('Data antiga. Verifique se o preço corresponde à cotação histórica exata para não distorcer a rentabilidade.');
                return;
            }
        }

        setPriceWarning(null);
    }, [form.price, form.date, form.type, priceFetch.suggestedPrice]);

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm(prev => ({ ...prev, date: e.target.value }));
    };

    const handleTypeSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newType = e.target.value as AssetType;

        let defaultRate = '';
        let defaultQty = '';
        const defaultTicker = '';

        if (newType === 'FIXED_INCOME') {
            defaultRate = '10,00';
            defaultQty = '1';
        } else if (newType === 'CASH') {
            // Sem ticker fixo: o cofrinho é resolvido no submit (novo ou existente).
            defaultQty = '';
            // Aporte: se já houver cofrinhos, deixa escolher; senão, cria um novo.
            // Saque: sempre escolhe um existente.
            setCashSelection(
                transactionType === 'SELL'
                    ? (reserves[0]?.ticker || '')
                    : (reserves.length > 0 ? '' : NEW_RESERVE)
            );
        }

        setTotalValueInput('');
        setForm(prev => ({
            ...prev,
            type: newType,
            ticker: defaultTicker,
            name: '',
            rate: defaultRate,
            quantity: defaultQty,
            price: '',
            fixedIncomeIndex: undefined,
        }));
    };

    // Ao alternar Comprar/Sacar dentro de CASH, mantém a seleção coerente:
    // saque exige um cofrinho existente (NEW_RESERVE não faz sentido).
    useEffect(() => {
        if (form.type !== 'CASH') return;
        if (transactionType === 'SELL') {
            setCashSelection(prev => (prev === NEW_RESERVE || !prev) ? (reserves[0]?.ticker || '') : prev);
        } else {
            setCashSelection(prev => prev || (reserves.length > 0 ? '' : NEW_RESERVE));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transactionType, form.type]);

    const handleTickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toUpperCase();
        setForm(prev => ({ ...prev, ticker: val }));
        search.searchTicker(val);
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
                price: asset.currentPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
            }));
        } else {
            setForm(prev => ({ ...prev, ticker: selectedTicker }));
        }
    };

    const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val.includes('-')) return;
        setForm(prev => ({ ...prev, quantity: val }));
        // User is typing quantity directly — clear the value input so both
        // don't fight each other (only one direction is active at a time).
        setTotalValueInput('');
    };

    /**
     * Handler for the "Valor (US$)" input on fractional dollar-denominated assets.
     * Computes quantity = typedValue / unitPrice and updates `form.quantity`.
     * Only fires on explicit user interaction — no effect watching both fields.
     */
    const handleTotalValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (raw.includes('-')) return;
        setTotalValueInput(raw);
        const valueNum = parseFloat(raw.replace(',', '.'));
        const priceNum = parseCurrencyToFloat(form.price);
        if (isFinite(valueNum) && valueNum > 0 && isFinite(priceNum) && priceNum > 0) {
            const derivedQty = valueNum / priceNum;
            // Up to 8 decimal places, trailing zeros stripped.
            setForm(prev => ({ ...prev, quantity: parseFloat(derivedQty.toFixed(8)).toString() }));
        } else {
            setForm(prev => ({ ...prev, quantity: '' }));
        }
    };

    const handleCurrencyChange = (formattedValue: string) => {
        setForm(prev => ({ ...prev, price: formattedValue }));
        priceFetch.setManual();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setValidationError('');

        // Resolve o cofrinho (CASH) antes de validar: define ticker/nome conforme
        // a escolha (novo cofrinho → gera ticker; existente → usa o ticker dele).
        let workingForm = form;
        if (form.type === 'CASH') {
            if (transactionType === 'SELL') {
                const target = reserves.find(r => r.ticker === cashSelection);
                if (!target) {
                    setValidationError('Selecione de qual reserva deseja sacar.');
                    return;
                }
                workingForm = { ...form, ticker: target.ticker, name: target.name || '' };
            } else if (cashSelection === NEW_RESERVE || reserves.length === 0) {
                const nm = form.name.trim();
                if (!nm) {
                    setValidationError('Dê um nome ao seu cofrinho (ex: Reserva de Emergência).');
                    return;
                }
                const newTicker = makeReserveTicker(nm, reserves.map(r => r.ticker));
                workingForm = { ...form, ticker: newTicker, name: nm };
            } else if (cashSelection) {
                const target = reserves.find(r => r.ticker === cashSelection);
                workingForm = { ...form, ticker: cashSelection, name: target?.name || '' };
            } else {
                setValidationError('Selecione um cofrinho ou crie um novo.');
                return;
            }
        }

        const { error, payload } = validateTransaction(workingForm, transactionType, assets);
        if (error || !payload) {
            setValidationError(error || 'Erro de validação.');
            return;
        }

        const today = getLocalDateString();
        setStatus('loading');

        try {
            await addAsset(payload);
            setStatus('success');
            addToast('Transação registrada com sucesso!', 'success');

            // Data antiga → backend recalcula a evolução patrimonial.
            if (form.date < today) {
                setTimeout(() => addToast('Evolução patrimonial recalculada.', 'info'), 500);
            }

            setTimeout(() => {
                setStatus('idle');
                onClose();
            }, 1000);
        } catch (error: any) {
            console.error(error);
            setStatus('idle');
            setValidationError(error.message || 'Erro ao processar transação.');
            addToast('Falha ao registrar transação.', 'error');
        }
    };

    const renderTickerField = () => {
        if (form.type === 'CASH') {
            const isNew = cashSelection === NEW_RESERVE;
            const noReserves = reserves.length === 0;

            return (
                <div className="space-y-3 mb-1">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-1">
                            {transactionType === 'BUY' ? 'Cofrinho (Reserva)' : 'Sacar de qual reserva?'}
                        </label>

                        {transactionType === 'SELL' && noReserves ? (
                            <p className="text-[11px] text-red-500 font-bold ml-1 py-2">
                                Você ainda não possui reservas para sacar.
                            </p>
                        ) : (
                            <div className="relative">
                                <select
                                    value={cashSelection}
                                    onChange={(e) => setCashSelection(e.target.value)}
                                    className="w-full bg-card text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-elevated transition-all duration-300 shadow-sm"
                                >
                                    {transactionType === 'BUY' && reserves.length > 0 && (
                                        <option value="">Selecione um cofrinho...</option>
                                    )}
                                    {reserves.map(r => (
                                        <option key={r.ticker} value={r.ticker}>
                                            {r.name || 'Reserva'}
                                        </option>
                                    ))}
                                    {transactionType === 'BUY' && (
                                        <option value={NEW_RESERVE}>➕ Criar novo cofrinho</option>
                                    )}
                                </select>
                                <PiggyBank className="absolute right-3 top-3.5 text-slate-600 pointer-events-none" size={16} />
                            </div>
                        )}
                    </div>

                    {transactionType === 'BUY' && (isNew || noReserves) && (
                        <Input
                            label="Nome do Cofrinho"
                            placeholder="Ex: Reserva de Emergência, Viagem, Carro novo..."
                            value={form.name}
                            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                            containerClassName="mb-0"
                            className="px-4 py-3"
                            maxLength={120}
                        />
                    )}

                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-900/20 border border-emerald-900/50 rounded-lg">
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
                            className="w-full bg-card text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-elevated transition-all duration-300 shadow-sm"
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

        let placeholder = "Ex: PETR4, VALE3, ITUB4";
        if (form.type === 'FII') placeholder = "Ex: MXRF11, HGLG11, KNRI11";
        if (form.type === 'CRYPTO') placeholder = "Ex: BTC, ETH";
        if (form.type === 'STOCK_US') placeholder = "Ex: AAPL, NVDA, MSFT, GOOGL";
        if (form.type === 'FIXED_INCOME') placeholder = "Busque: Tesouro Selic, NTN-B, CDB, LCI...";

        return (
            <div className="relative mb-4" ref={search.containerRef}>
                <div className="relative">
                    <Input
                        label={form.type === 'FIXED_INCOME' ? "Nome do Título / Produto" : "Código / Ticker"}
                        placeholder={placeholder}
                        value={form.ticker}
                        onChange={handleTickerChange}
                        onFocus={() => { if (search.searchResults.length > 0) search.setShowDropdown(true); }}
                        onKeyDown={search.handleKeyDown}
                        role="combobox"
                        aria-expanded={search.showDropdown && search.searchResults.length > 0}
                        aria-controls="asset-search-listbox"
                        aria-activedescendant={search.activeIndex >= 0 ? `asset-option-${search.activeIndex}` : undefined}
                        aria-autocomplete="list"
                        containerClassName="mb-0"
                        className="uppercase font-mono tracking-wider px-4 py-3 pr-16"
                    />
                    {form.type === 'STOCK_US' && (
                        <span className="absolute right-3 top-9 text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded">
                            USD
                        </span>
                    )}
                </div>
                {form.type === 'STOCK_US' && (
                    <p className="text-[10px] text-blue-400/60 mt-1 ml-1">
                        Valores em dólar. Convertido para R$ pela cotação do dia.
                    </p>
                )}

                {search.isSearching && (
                    <div className="absolute right-3 top-9">
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    </div>
                )}

                {search.showDropdown && search.searchResults.length > 0 && (
                    <div
                        id="asset-search-listbox"
                        role="listbox"
                        aria-label="Resultados da busca"
                        className="absolute top-full left-0 right-0 mt-1 bg-elevated border border-slate-700 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto custom-scrollbar animate-fade-in"
                    >
                        {search.searchResults.map((result, idx) => (
                            <div
                                key={idx}
                                id={`asset-option-${idx}`}
                                role="option"
                                aria-selected={idx === search.activeIndex}
                                onMouseEnter={() => search.setActiveIndex(idx)}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    search.selectResult(result);
                                }}
                                className={`p-3 cursor-pointer border-b border-slate-800/50 last:border-0 flex justify-between items-center transition-colors ${idx === search.activeIndex ? 'bg-slate-800' : 'hover:bg-slate-800'}`}
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    {!result.isTreasury && result.type !== 'FIXED_INCOME' && (
                                        <AssetLogo ticker={result.ticker} type={result.type as AssetType} name={result.name} size={28} />
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-white uppercase flex items-center gap-2">
                                            {result.ticker}
                                            {result.isManual && <Edit3 size={10} className="text-blue-400" />}
                                        </p>
                                        <p className="text-[10px] text-slate-400 truncate max-w-[200px]">{result.name}</p>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${result.isTreasury ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/30' : 'bg-slate-700 text-slate-300'}`}>
                                        {result.isTreasury ? 'TESOURO' :
                                         result.type === 'STOCK' ? 'AÇÃO' :
                                         result.type === 'FIXED_INCOME' ? 'RENDA FIXA' :
                                         result.type}
                                    </span>
                                    {result.rate !== undefined && (
                                        <p className="text-[9px] text-emerald-400 font-mono mt-0.5">{result.rate}% {result.index || 'CDI'}</p>
                                    )}
                                    {result.isTreasury && result.maturityDate && (
                                        <p className="text-[9px] text-slate-500 font-mono mt-0.5">Venc. {result.maturityDate}</p>
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
                        <CurrencyInput
                            label={label}
                            value={form.price}
                            onChange={handleCurrencyChange}
                            containerClassName="mb-0"
                            className={`px-4 py-3 text-lg font-bold ${transactionType === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}
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
            const isIndexedFixedIncome = ['SELIC', 'CDI', 'IPCA'].includes(form.fixedIncomeIndex || '');
            return (
                <>
                    <div className="relative">
                        <CurrencyInput
                            label="Valor Total Investido (R$)"
                            value={form.price}
                            onChange={handleCurrencyChange}
                            containerClassName="mb-0"
                            className="px-4 py-3 text-emerald-400 font-bold"
                        />
                        <DollarSign className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                    </div>

                    <div className="relative">
                        <Input
                            label={isIndexedFixedIncome ? `Spread sobre ${form.fixedIncomeIndex} (% a.a.)` : "Rentabilidade"}
                            placeholder="Ex: 11,50 ou 115"
                            value={form.rate}
                            onChange={(e) => setForm(prev => ({ ...prev, rate: e.target.value }))}
                            containerClassName="mb-0"
                        />
                        <Percent className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                    </div>
                    {isIndexedFixedIncome && (
                        <p className="text-[10px] text-emerald-400/90 -mt-1 whitespace-nowrap">
                            Rende <strong>{form.fixedIncomeIndex} + {form.rate || '0'}% a.a.</strong> — índice vivo + spread, não só o spread.
                        </p>
                    )}
                </>
            );
        }

        // CRYPTO and STOCK_US support fractional shares/coins and USD pricing.
        const isFractional = form.type === 'CRYPTO' || form.type === 'STOCK_US';

        return (
            <>
                <div className="relative">
                    <Input
                        label={isFractional ? "Quantidade" : "Quantidade (Cotas)"}
                        type="number"
                        step={isFractional ? "0.00000001" : "1"}
                        placeholder={isFractional ? "0.005" : "100"}
                        value={form.quantity}
                        onChange={handleQuantityChange}
                        containerClassName="mb-0"
                        min="0"
                    />
                    <BarChart2 className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                </div>

                <div className="relative">
                    <CurrencyInput
                        label="Preço Unitário"
                        value={form.price}
                        onChange={handleCurrencyChange}
                        containerClassName="mb-0"
                        className={priceFetch.priceSource === 'historical' ? 'px-4 py-3 border-blue-500/50 text-blue-100 bg-blue-900/10' : ''}
                    />

                    <div className="absolute right-3 top-9 pointer-events-none">
                        {priceFetch.isFetchingPrice ? (
                            <Loader2 className="animate-spin text-blue-500" size={16} />
                        ) : priceFetch.priceSource === 'historical' ? (
                            <div className="group relative">
                                {priceFetch.isCurrentPrice ? (
                                    <TrendingUp className="text-emerald-400 animate-fade-in" size={16} />
                                ) : (
                                    <Clock className="text-blue-400 animate-fade-in" size={16} />
                                )}
                            </div>
                        ) : (
                            <DollarSign className="text-slate-600" size={16} />
                        )}
                    </div>

                    {priceFetch.priceSource === 'historical' && !priceFetch.isFetchingPrice && (
                        <div className={`absolute -bottom-5 left-1 flex items-center gap-1 text-[9px] font-medium animate-fade-in ${priceFetch.isCurrentPrice ? 'text-emerald-400' : 'text-blue-400'}`}>
                            {priceFetch.isCurrentPrice ? (
                                <>
                                    <CheckCircle2 size={10} />
                                    Preço Atual de Mercado
                                </>
                            ) : (
                                <>
                                    <Clock size={10} />
                                    {priceFetch.historicalDateFound
                                        ? `Preço aprox. de ${new Date(priceFetch.historicalDateFound).toLocaleDateString('pt-BR')}`
                                        : 'Preço histórico sugerido'
                                    }
                                </>
                            )}
                        </div>
                    )}
                </div>

                {isFractional && (
                    <div className="col-span-2 relative">
                        <Input
                            label="Valor Total (US$)"
                            type="number"
                            step="0.01"
                            placeholder="Ex: 150.00"
                            value={totalValueInput}
                            onChange={handleTotalValueChange}
                            containerClassName="mb-0"
                            min="0"
                            className="px-4 py-3 pr-10 text-emerald-400 font-bold"
                        />
                        <DollarSign className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                        <p className="text-[10px] text-slate-500 mt-1 ml-1">
                            Preencha o valor total em US$ para calcular a quantidade automaticamente — ou edite a quantidade diretamente acima.
                        </p>
                    </div>
                )}

                {renderTransactionTotal()}
            </>
        );
    };

    /**
     * Mostra o VALOR total da transação (quantidade × preço) ao vivo. Essencial
     * para cripto, onde a quantidade tem muitas casas (0,00028 BTC) e só o preço
     * unitário não diz quanto se está investindo. Ativos dolarizados (cripto /
     * STOCK_US) têm preço em USD: exibe o total em US$ e o equivalente em R$.
     */
    const renderTransactionTotal = () => {
        const qtyNum = parseFloat((form.quantity || '').replace(',', '.'));
        const priceNum = parseCurrencyToFloat(form.price);
        if (!isFinite(qtyNum) || qtyNum <= 0 || !isFinite(priceNum) || priceNum <= 0) return null;

        const isDollarized = form.type === 'CRYPTO' || form.type === 'STOCK_US';
        const totalNative = qtyNum * priceNum;

        return (
            <div className="col-span-2 mt-2 flex items-baseline justify-between rounded-lg bg-card border border-slate-800 px-3 py-2 animate-fade-in">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {transactionType === 'BUY' ? 'Total da Compra' : 'Total da Venda'}
                </span>
                <span className="text-sm font-bold text-emerald-400 font-mono">
                    {fmtCurrency(totalNative, isDollarized ? 'USD' : 'BRL')}
                    {isDollarized && usdRate > 0 && (
                        <span className="ml-2 text-[11px] font-medium text-slate-400">
                            ≈ {fmtCurrency(totalNative * usdRate, 'BRL')}
                        </span>
                    )}
                </span>
            </div>
        );
    };

    if (!isOpen) return null;

    const maxDate = getLocalDateString();

    return createPortal(
        <div className="relative z-[100]" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 text-center">
                    <div className="relative transform overflow-hidden rounded-2xl bg-base border border-slate-800 text-left shadow-2xl transition-all w-full max-w-lg animate-fade-in my-auto max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-card shrink-0">
                            <h2 id="modal-title" className="text-lg font-bold text-white flex items-center gap-2">
                                <PlusCircle size={18} className="text-blue-500" />
                                Nova Transação
                            </h2>
                            <button onClick={onClose} aria-label="Fechar" className="text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="grid grid-cols-2 p-1 bg-panel border-b border-slate-800">
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
                                                className="w-full bg-card text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-elevated transition-all duration-300 shadow-sm"
                                            >
                                                <option value="STOCK">Ações Brasil (B3)</option>
                                                <option value="FII">Fundos Imobiliários (FIIs)</option>
                                                <option value="STOCK_US">Ações Exterior (USD)</option>
                                                <option value="CRYPTO">Criptomoedas</option>
                                                <option value="FIXED_INCOME">Renda Fixa / Tesouro Direto</option>
                                                <option value="CASH">Reserva / Caixa</option>
                                            </select>
                                            <Tag className="absolute right-3 top-3.5 text-slate-600 pointer-events-none" size={14} />
                                        </div>
                                    </div>
                                    <Input
                                        label="Data do Aporte" type="date" value={form.date}
                                        max={maxDate}
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
                                        onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                        containerClassName="mb-0"
                                        className="bg-card text-slate-300 border-slate-800 focus:border-slate-600 px-4 py-3"
                                    />
                                )}

                                <div className="grid grid-cols-2 gap-4">
                                    {renderQuantityAndPriceFields()}
                                </div>

                                {priceWarning && (
                                    <Alert variant="warning" className="animate-fade-in">
                                        {priceWarning}
                                    </Alert>
                                )}

                                {validationError && (
                                    <Alert variant="error" className="animate-shake">
                                        {validationError}
                                    </Alert>
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
