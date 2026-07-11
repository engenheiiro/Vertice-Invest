import React, { type Dispatch, type SetStateAction } from 'react';
import { DollarSign, BarChart2, Loader2, Clock, CheckCircle2, TrendingUp, Percent, Tag } from 'lucide-react';
import { Input } from '../../ui/Input';
import { CurrencyInput } from '../../ui/CurrencyInput';
import { Alert } from '../../ui/Alert';
import { parseCurrencyToFloat, type AssetFormState, type FixedIncomeMode } from '../../../utils/assetTransaction';
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
            const mode = form.fixedIncomeMode || 'CDI_PCT';
            // Rótulo, placeholder e ajuda do campo de taxa conforme o modo — remove a
            // ambiguidade "10% é do CDI ou prefixado?" tornando explícita a referência.
            const RATE_UI: Record<FixedIncomeMode, { label: string; placeholder: string; help: string }> = {
                CDI_PCT: { label: 'Rentabilidade (% do CDI)', placeholder: 'Ex: 110', help: 'Ex.: 110 = 110% do CDI. Rende a variação do CDI multiplicada por esse percentual.' },
                PRE: { label: 'Taxa prefixada (% ao ano)', placeholder: 'Ex: 12,50', help: 'Taxa fixa contratada, independente do CDI. Ex.: 12,50 = 12,50% ao ano.' },
                IPCA: { label: 'Spread sobre o IPCA (% a.a.)', placeholder: 'Ex: 6,00', help: '' },
                SELIC: { label: 'Spread sobre a Selic (% a.a.)', placeholder: 'Ex: 0,10', help: '' },
            };
            const ui = RATE_UI[mode];
            const isIndexedFixedIncome = mode === 'IPCA' || mode === 'SELIC';
            const indexLabel = mode === 'IPCA' ? 'IPCA' : 'Selic';
            // Troca de modo reseta a taxa (100% do CDI no modo CDI, senão em branco):
            // evita carregar um "110" de %CDI para um campo de prefixado, onde seria absurdo.
            const onModeChange = (newMode: FixedIncomeMode) =>
                setForm(prev => ({ ...prev, fixedIncomeMode: newMode, rate: newMode === 'CDI_PCT' ? '100,00' : '' }));
            return (
                <>
                    <div className="col-span-2 flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-1">
                            Tipo de rendimento
                        </label>
                        <div className="relative">
                            <select
                                value={mode}
                                onChange={(e) => onModeChange(e.target.value as FixedIncomeMode)}
                                className="w-full bg-card text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-elevated transition-all duration-300 shadow-sm"
                            >
                                <option value="CDI_PCT">Pós-fixado — % do CDI (CDB, LCI, LCA...)</option>
                                <option value="SELIC">Pós-fixado — Selic + spread (Tesouro Selic)</option>
                                <option value="IPCA">Híbrido — IPCA + spread (Tesouro IPCA+, NTN-B)</option>
                                <option value="PRE">Prefixado — taxa fixa a.a.</option>
                            </select>
                            <Tag className="absolute right-3 top-3.5 text-slate-600 pointer-events-none" size={14} />
                        </div>
                    </div>

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
                            label={ui.label}
                            placeholder={ui.placeholder}
                            value={form.rate}
                            onChange={(e) => setForm(prev => ({ ...prev, rate: e.target.value }))}
                            containerClassName="mb-0"
                        />
                        <Percent className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                    </div>
                    {isIndexedFixedIncome ? (
                        <p className="col-span-2 text-[10px] text-emerald-400/90 -mt-1">
                            Rende <strong>{indexLabel} + {form.rate || '0'}% a.a.</strong> — índice vivo + spread, não só o spread.
                        </p>
                    ) : (
                        <p className="col-span-2 text-[10px] text-slate-500 -mt-1">{ui.help}</p>
                    )}

                    {/* C2: vencimento (opcional). No vencimento o título para de render
                        e é marcado VENCIDO na carteira (sugere resgate, sem liquidar). */}
                    <div className="col-span-2 relative">
                        <Input
                            label="Vencimento (opcional)"
                            type="date"
                            value={form.maturityDate || ''}
                            onChange={(e) => setForm(prev => ({ ...prev, maturityDate: e.target.value }))}
                            containerClassName="mb-0"
                        />
                        <p className="text-[10px] text-slate-500 mt-1 ml-1">
                            No vencimento o título para de render e é marcado <strong className="text-amber-400">VENCIDO</strong> — nada é vendido automaticamente.
                        </p>
                    </div>

                    {/* C1: marca este título como Reserva separada. Por padrão a Renda
                        Fixa é INVESTIMENTO (entra na distribuição e no grupo "Renda
                        Fixa"); marcar tira da base de alocação e joga em "Caixa/Reserva". */}
                    <label className="col-span-2 flex items-start gap-2.5 mt-1 p-3 rounded-lg bg-card border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                        <input
                            type="checkbox"
                            checked={!!form.isReserve}
                            onChange={(e) => setForm(prev => ({ ...prev, isReserve: e.target.checked }))}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500 cursor-pointer"
                        />
                        <span className="text-[11px] leading-snug text-slate-400">
                            <strong className="text-slate-200">Guardar como Reserva separada</strong> — fora da
                            distribuição de investimentos (conta em "Caixa / Reserva", como reserva de emergência).
                        </span>
                    </label>
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
