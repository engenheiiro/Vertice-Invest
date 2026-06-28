import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, PlusCircle } from 'lucide-react';
import { Button } from '../ui/Button';
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
import { OperationSection } from './add-asset/OperationSection';
import { AssetSection } from './add-asset/AssetSection';
import { ValuesSection } from './add-asset/ValuesSection';
import { NEW_RESERVE, type TransactionType } from './add-asset/types';
import { getErrorMessage } from '../../utils/errorMessages';

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

/** Cabeçalho de seção do formulário (agrupa os campos sem forçar etapas). */
const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">{children}</h3>
);

export const AddAssetModal: React.FC<AddAssetModalProps> = ({ isOpen, onClose }) => {
    const { addAsset, assets, usdRate } = useWallet();
    const { addToast } = useToast();

    const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
    const [validationError, setValidationError] = useState('');
    const [transactionType, setTransactionType] = useState<TransactionType>('BUY');
    const [priceWarning, setPriceWarning] = useState<string | null>(null);

    const panelRef = useRef<HTMLDivElement>(null);

    const [form, setForm] = useState<AssetFormState>(INITIAL_FORM);
    // Tracks the "total value" input for fractional dollar-denominated assets
    // (CRYPTO, STOCK_US, ETF internacional). String so we can display a clean empty state.
    const [totalValueInput, setTotalValueInput] = useState('');
    // ETF é classe unificada: nacionais (B3, R$) e internacionais (Exterior, US$).
    // O mercado define a moeda e se o ativo aceita fração (US$).
    const [etfMarket, setEtfMarket] = useState<'BR' | 'US'>('BR');

    // Ativo dolarizado: Exterior, cripto ou ETF internacional.
    const isDollarAsset = form.type === 'STOCK_US' || form.type === 'CRYPTO' || (form.type === 'ETF' && etfMarket === 'US');

    // CASH (Reserva/Caixa): qual "cofrinho" a transação afeta.
    // '' = nenhum selecionado · NEW_RESERVE = criar um novo · senão = ticker do existente.
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
            setEtfMarket('BR');
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

    // Focus trap + Esc (A3/A9): foca o primeiro campo ao abrir, cicla Tab dentro
    // do painel e restaura o foco anterior ao fechar.
    useEffect(() => {
        if (!isOpen) return;

        const previouslyFocused = document.activeElement as HTMLElement | null;

        const focusables = () =>
            panelRef.current
                ? Array.from(
                    panelRef.current.querySelectorAll<HTMLElement>(
                        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
                    )
                ).filter((el) => el.offsetParent !== null)
                : [];

        const first = focusables()[0];
        (first ?? panelRef.current)?.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
                return;
            }
            if (e.key !== 'Tab') return;
            const items = focusables();
            if (items.length === 0) return;
            const firstEl = items[0];
            const lastEl = items[items.length - 1];
            if (e.shiftKey && document.activeElement === firstEl) {
                e.preventDefault();
                lastEl.focus();
            } else if (!e.shiftKey && document.activeElement === lastEl) {
                e.preventDefault();
                firstEl.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [isOpen, onClose]);

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
        setEtfMarket('BR');
        setForm(prev => ({
            ...prev,
            type: newType,
            ticker: defaultTicker,
            name: '',
            rate: defaultRate,
            quantity: defaultQty,
            price: '',
            fixedIncomeIndex: undefined,
            usSubType: undefined,
            currency: undefined,
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
            // ETF: alinha o mercado (moeda) ao ativo vendido para não distorcer a baixa.
            if (asset.type === 'ETF') setEtfMarket(asset.currency === 'USD' ? 'US' : 'BR');
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

    // ETF: troca de mercado (B3 R$ ↔ Exterior US$) zera preço/quantidade derivados.
    const handleEtfMarketSelect = (market: 'BR' | 'US') => {
        if (etfMarket === market) return;
        setEtfMarket(market);
        setTotalValueInput('');
        setForm(prev => ({ ...prev, price: '', quantity: '' }));
        priceFetch.reset();
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

        // Moeda explícita: Exterior/cripto/ETF-internacional em US$; demais em R$.
        const submitForm = { ...workingForm, currency: (isDollarAsset ? 'USD' : 'BRL') as 'BRL' | 'USD' };
        const { error, payload } = validateTransaction(submitForm, transactionType, assets);
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
        } catch (error: unknown) {
            console.error(error);
            setStatus('idle');
            setValidationError(getErrorMessage(error, 'Erro ao processar transação.'));
            addToast('Falha ao registrar transação.', 'error');
        }
    };

    if (!isOpen) return null;

    const maxDate = getLocalDateString();
    const confirmDisabled = form.type !== 'CASH' && (!form.ticker || !form.quantity || !form.price);

    return createPortal(
        <div className="relative z-[100]" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 text-center">
                    <div ref={panelRef} tabIndex={-1} className="relative transform overflow-hidden rounded-2xl bg-base border border-slate-800 text-left shadow-2xl transition-all w-full max-w-lg animate-fade-in my-auto max-h-[90vh] flex flex-col outline-none">
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-card shrink-0">
                            <h2 id="modal-title" className="text-lg font-bold text-white flex items-center gap-2">
                                <PlusCircle size={18} className="text-blue-500" />
                                Nova Transação
                            </h2>
                            <button onClick={onClose} aria-label="Fechar" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <form onSubmit={handleSubmit} className="space-y-6">
                                <section>
                                    <SectionHeading>Operação</SectionHeading>
                                    <OperationSection
                                        transactionType={transactionType}
                                        onSelectTransactionType={setTransactionType}
                                        assetType={form.type}
                                        onTypeChange={handleTypeSelectChange}
                                        date={form.date}
                                        maxDate={maxDate}
                                        onDateChange={handleDateChange}
                                    />
                                </section>

                                <section className="pt-1 border-t border-slate-800/70">
                                    <SectionHeading>Ativo</SectionHeading>
                                    <AssetSection
                                        form={form}
                                        setForm={setForm}
                                        transactionType={transactionType}
                                        assets={assets}
                                        reserves={reserves}
                                        cashSelection={cashSelection}
                                        setCashSelection={setCashSelection}
                                        search={search}
                                        etfMarket={etfMarket}
                                        onSelectEtfMarket={handleEtfMarketSelect}
                                        onTickerChange={handleTickerChange}
                                        onSellAssetSelect={handleSellAssetSelect}
                                    />
                                </section>

                                <section className="pt-1 border-t border-slate-800/70">
                                    <SectionHeading>Valores</SectionHeading>
                                    <ValuesSection
                                        form={form}
                                        setForm={setForm}
                                        transactionType={transactionType}
                                        isDollarAsset={isDollarAsset}
                                        totalValueInput={totalValueInput}
                                        usdRate={usdRate}
                                        priceFetch={priceFetch}
                                        priceWarning={priceWarning}
                                        validationError={validationError}
                                        onQuantityChange={handleQuantityChange}
                                        onTotalValueChange={handleTotalValueChange}
                                        onCurrencyChange={handleCurrencyChange}
                                    />
                                </section>

                                <div className="pt-2 flex gap-3">
                                    <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancelar</Button>
                                    <Button type="submit" status={status} disabled={confirmDisabled} className="flex-[2]">Confirmar</Button>
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
