import React, { type Dispatch, type SetStateAction } from 'react';
import { Input } from '../../ui/Input';
import type { Asset } from '../../../contexts/WalletContext';
import type { AssetFormState } from '../../../utils/assetTransaction';
import type { AssetSearch, TransactionType } from './types';
import {
    CashReserveField, EtfMarketPicker, SellAssetField, TickerSearchField, UsSubTypeField,
} from './AssetSectionParts';

interface AssetSectionProps {
    form: AssetFormState;
    setForm: Dispatch<SetStateAction<AssetFormState>>;
    transactionType: TransactionType;
    assets: Asset[];
    reserves: Asset[];
    cashSelection: string;
    setCashSelection: Dispatch<SetStateAction<string>>;
    search: AssetSearch;
    etfMarket: 'BR' | 'US';
    onSelectEtfMarket: (market: 'BR' | 'US') => void;
    onTickerChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSellAssetSelect: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

/**
 * Seção "Ativo": QUAL ativo. Resolve a identificação conforme o tipo:
 * busca/autocomplete (compra), seletor da carteira (venda), cofrinho (CASH),
 * além de nome, mercado do ETF e sub-tipo de Exterior.
 */
export const AssetSection: React.FC<AssetSectionProps> = (props) => {
    const { form, setForm, transactionType, etfMarket, onSelectEtfMarket } = props;
    const isBuy = transactionType === 'BUY';

    return (
        <div className="space-y-4">
            <TickerField {...props} />

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

            {form.type === 'ETF' && isBuy && (
                <EtfMarketPicker etfMarket={etfMarket} onSelectEtfMarket={onSelectEtfMarket} />
            )}

            {form.type === 'STOCK_US' && isBuy && <UsSubTypeField form={form} setForm={setForm} />}
        </div>
    );
};

/** Identificação do ativo: cofrinho (CASH), posição da carteira (venda) ou busca (compra). */
const TickerField: React.FC<AssetSectionProps> = (props) => {
    const { form, transactionType } = props;
    if (form.type === 'CASH') return <CashReserveField {...props} />;
    if (transactionType === 'SELL') return <SellAssetField {...props} />;
    return <TickerSearchField {...props} />;
};
