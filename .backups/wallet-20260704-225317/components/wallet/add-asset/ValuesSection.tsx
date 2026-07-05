import React, { type Dispatch, type SetStateAction } from 'react';
import { DollarSign, BarChart2, Loader2, Clock, CheckCircle2, TrendingUp, Percent } from 'lucide-react';
import { Input } from '../../ui/Input';
import { CurrencyInput } from '../../ui/CurrencyInput';
import { Alert } from '../../ui/Alert';
import { parseCurrencyToFloat, type AssetFormState } from '../../../utils/assetTransaction';
import { formatCurrency as fmtCurrency } from '../../../utils/format';
import type { PriceFetch, TransactionType } from './types';

interface ValuesSectionProps {
    form: AssetFormState;
    setForm: Dispatch<SetStateAction<AssetFormState>>;
    transactionType: TransactionType;
    isDollarAsset: boolean;
    totalValueInput: string;
    usdRate: number;
    priceFetch: PriceFetch;
    priceWarning: string | null;
    validationError: string;
    onQuantityChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onTotalValueChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onCurrencyChange: (formattedValue: string) => void;
}

/**
 * Seção "Valores": QUANTO. Quantidade e preço (ou valor para CASH /
 * renda fixa), total da transação ao vivo e avisos de preço/validação.
 */
export const ValuesSection: React.FC<ValuesSectionProps> = ({
    form,
    setForm,
    transactionType,
    isDollarAsset,
    totalValueInput,
    usdRate,
    priceFetch,
    priceWarning,
    validationError,
    onQuantityChange,
    onTotalValueChange,
    onCurrencyChange,
}) => {
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

        const totalNative = qtyNum * priceNum;

        return (
            <div className="col-span-2 mt-2 flex items-baseline justify-between rounded-lg bg-card border border-slate-800 px-3 py-2 animate-fade-in">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {transactionType === 'BUY' ? 'Total da Compra' : 'Total da Venda'}
                </span>
                <span className="text-sm font-bold text-emerald-400 font-mono">
                    {fmtCurrency(totalNative, isDollarAsset ? 'USD' : 'BRL')}
                    {isDollarAsset && usdRate > 0 && (
                        <span className="ml-2 text-[11px] font-medium text-slate-400">
                            ≈ {fmtCurrency(totalNative * usdRate, 'BRL')}
                        </span>
                    )}
                </span>
            </div>
        );
    };

    const renderFields = () => {
        if (form.type === 'CASH') {
            const label = transactionType === 'BUY' ? "Valor do Aporte (R$)" : "Valor do Saque (R$)";
            return (
                <div className="col-span-2">
                    <div className="relative">
                        <CurrencyInput
                            label={label}
                            value={form.price}
                            onChange={onCurrencyChange}
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
                            onChange={onCurrencyChange}
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

        // CRYPTO, STOCK_US and international ETFs support fractional shares and USD pricing.
        const isFractional = isDollarAsset;

        return (
            <>
                <div className="relative">
                    <Input
                        label={isFractional ? "Quantidade" : "Quantidade (Cotas)"}
                        type="number"
                        step={isFractional ? "0.00000001" : "1"}
                        placeholder={isFractional ? "0.005" : "100"}
                        value={form.quantity}
                        onChange={onQuantityChange}
                        containerClassName="mb-0"
                        min="0"
                    />
                    <BarChart2 className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                </div>

                <div className="relative">
                    <CurrencyInput
                        label="Preço Unitário"
                        value={form.price}
                        onChange={onCurrencyChange}
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
                            onChange={onTotalValueChange}
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

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
                {renderFields()}
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
        </div>
    );
};
