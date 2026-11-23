import React, { type Dispatch, type SetStateAction } from 'react';
import { Search, Loader2, Edit3, PiggyBank, Percent, Tag } from 'lucide-react';
import { Input } from '../../ui/Input';
import type { Asset, AssetType } from '../../../contexts/WalletContext';
import type { AssetFormState } from '../../../utils/assetTransaction';
import AssetLogo from '../../common/AssetLogo';
import { NEW_RESERVE, type AssetSearch, type TransactionType } from './types';
import {
    isUsdQuoted, searchResultBadge, sellableAssets, tickerPlaceholder,
    type EtfMarket, type SearchResultView,
} from './assetSectionView';

type SetForm = Dispatch<SetStateAction<AssetFormState>>;

const SELECT_CLASS = 'w-full bg-card text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-elevated transition-all duration-300 shadow-sm';

interface CashReserveFieldProps {
    form: AssetFormState;
    setForm: SetForm;
    transactionType: TransactionType;
    reserves: Asset[];
    cashSelection: string;
    setCashSelection: Dispatch<SetStateAction<string>>;
}

const CashReserveSelect: React.FC<Omit<CashReserveFieldProps, 'form' | 'setForm'>> = ({
    transactionType, reserves, cashSelection, setCashSelection,
}) => (
    <div className="relative">
        <select
            value={cashSelection}
            onChange={(e) => setCashSelection(e.target.value)}
            className={SELECT_CLASS}
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
);

/** Nome e rentabilidade de um cofrinho novo. */
const NewReserveFields: React.FC<{ form: AssetFormState; setForm: SetForm }> = ({ form, setForm }) => (
    <>
        <Input
            label="Nome do Cofrinho"
            placeholder="Ex: Reserva de Emergência, Viagem, Carro novo..."
            value={form.name}
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
            containerClassName="mb-0"
            className="px-4 py-3"
            maxLength={120}
        />

        {/* I4: rentabilidade da reserva (% do CDI), editável no cadastro.
            Default 100% (liquidez diária). Só aparece ao CRIAR um cofrinho —
            aportes a um cofrinho existente preservam a taxa dele. */}
        <div className="relative">
            <Input
                label="Rentabilidade (% do CDI)"
                placeholder="Ex: 100"
                value={form.rate}
                onChange={(e) => setForm(prev => ({ ...prev, rate: e.target.value }))}
                containerClassName="mb-0"
                className="px-4 py-3"
            />
            <Percent className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
            <p className="text-[10px] text-slate-500 mt-1 ml-1">
                Quanto a reserva rende. <strong className="text-slate-400">100 = 100% do CDI</strong> (padrão). Poupança ≈ 70%; CDB de liquidez diária costuma pagar 100–110%.
            </p>
        </div>
    </>
);

const CashReserveHint: React.FC = () => (
    <p className="text-[10px] text-slate-500 leading-snug ml-1">
        <strong className="text-slate-400">Reserva / Caixa</strong> é dinheiro parado para emergência (rende conforme o % do CDI acima, sem vencimento) e fica <strong className="text-slate-400">fora da Distribuição da Carteira e da Distribuição Ideal</strong>.
        Para um título com taxa própria — Tesouro, CDB, LCI/LCA — escolha a classe <strong className="text-amber-400">Renda Fixa</strong>.
    </p>
);

/** CASH: escolhe (ou cria) o cofrinho do aporte, ou a reserva do saque. */
export const CashReserveField: React.FC<CashReserveFieldProps> = (props) => {
    const { form, setForm, transactionType, reserves, cashSelection } = props;
    const isNew = cashSelection === NEW_RESERVE;
    const noReserves = reserves.length === 0;
    const isBuy = transactionType === 'BUY';

    return (
        <div className="space-y-3 mb-1">
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-1">
                    {isBuy ? 'Cofrinho (Reserva)' : 'Sacar de qual reserva?'}
                </label>

                {transactionType === 'SELL' && noReserves ? (
                    <p className="text-[11px] text-red-500 font-bold ml-1 py-2">
                        Você ainda não possui reservas para sacar.
                    </p>
                ) : (
                    <CashReserveSelect {...props} />
                )}
            </div>

            {isBuy && (isNew || noReserves) && <NewReserveFields form={form} setForm={setForm} />}

            {isBuy && <CashReserveHint />}
        </div>
    );
};

interface SellAssetFieldProps {
    form: AssetFormState;
    assets: Asset[];
    onSellAssetSelect: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

/** Venda: escolhe entre as posições da carteira com saldo. */
export const SellAssetField: React.FC<SellAssetFieldProps> = ({ form, assets, onSellAssetSelect }) => {
    const availableAssets = sellableAssets(assets, form.type);
    return (
        <div className="flex flex-col gap-1.5 mb-4">
            <label htmlFor="asset-sell-select" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-1">Ativo para Venda</label>
            <div className="relative">
                <select
                    id="asset-sell-select"
                    value={form.ticker}
                    onChange={onSellAssetSelect}
                    className={SELECT_CLASS}
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
};

interface SearchResultOptionProps {
    result: SearchResultView;
    idx: number;
    search: AssetSearch;
}

const ResultMeta: React.FC<{ result: SearchResultView }> = ({ result }) => (
    <div className="text-right shrink-0">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${result.isTreasury ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/30' : 'bg-slate-700 text-slate-300'}`}>
            {searchResultBadge(result)}
        </span>
        {result.rate !== undefined && (
            <p className="text-[9px] text-emerald-400 font-mono mt-0.5">{result.rate}% {result.index || 'CDI'}</p>
        )}
        {result.isTreasury && result.maturityDate && (
            <p className="text-[9px] text-slate-500 font-mono mt-0.5">Venc. {result.maturityDate}</p>
        )}
    </div>
);

const SearchResultOption: React.FC<SearchResultOptionProps> = ({ result, idx, search }) => (
    <div
        id={`asset-option-${idx}`}
        role="option"
        tabIndex={-1}
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
        <ResultMeta result={result} />
    </div>
);

const SearchResultsList: React.FC<{ search: AssetSearch }> = ({ search }) => (
    <div
        id="asset-search-listbox"
        role="listbox"
        aria-label="Resultados da busca"
        className="absolute top-full left-0 right-0 mt-1 bg-elevated border border-slate-700 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto custom-scrollbar animate-fade-in"
    >
        {search.searchResults.map((result: SearchResultView, idx: number) => (
            <SearchResultOption key={idx} result={result} idx={idx} search={search} />
        ))}
    </div>
);

interface TickerSearchFieldProps {
    form: AssetFormState;
    search: AssetSearch;
    etfMarket: EtfMarket;
    onTickerChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Compra: busca com autocomplete (ticker, título do Tesouro ou CDB/LCI). */
export const TickerSearchField: React.FC<TickerSearchFieldProps> = ({ form, search, etfMarket, onTickerChange }) => {
    const isUsd = isUsdQuoted(form.type, etfMarket);
    const hasResults = search.searchResults.length > 0;
    const openDropdown = () => { if (hasResults) search.setShowDropdown(true); };

    return (
        <div className="relative mb-4" ref={search.containerRef}>
            <div className="relative">
                <Input
                    label={form.type === 'FIXED_INCOME' ? "Nome do Título / Produto" : "Código / Ticker"}
                    placeholder={tickerPlaceholder(form.type, etfMarket)}
                    value={form.ticker}
                    onChange={onTickerChange}
                    onFocus={openDropdown}
                    onKeyDown={search.handleKeyDown}
                    role="combobox"
                    aria-expanded={search.showDropdown && hasResults}
                    aria-controls="asset-search-listbox"
                    aria-activedescendant={search.activeIndex >= 0 ? `asset-option-${search.activeIndex}` : undefined}
                    aria-autocomplete="list"
                    containerClassName="mb-0"
                    className="uppercase font-mono tracking-wider px-4 py-3 pr-16"
                />
                {isUsd && (
                    <span className="absolute right-3 top-9 text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded">
                        USD
                    </span>
                )}
            </div>
            {isUsd && (
                <p className="text-[10px] text-blue-400/60 mt-1 ml-1">
                    Valores em dólar. Convertido para R$ pela cotação do dia.
                </p>
            )}

            {form.type === 'FIXED_INCOME' && (
                <p className="text-[10px] text-slate-500 mt-1 ml-1 leading-snug">
                    Busque no catálogo do Tesouro ou digite o nome de um CDB/LCI para criá-lo.
                    O tipo de rendimento (% do CDI, prefixado, IPCA+, Selic+) é definido abaixo, em <strong className="text-slate-400">Valores</strong>.
                </p>
            )}

            {search.isSearching && (
                <div className="absolute right-3 top-9">
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                </div>
            )}

            {search.showDropdown && hasResults && <SearchResultsList search={search} />}
        </div>
    );
};

/** ETF: mercado (B3 em R$ ou Exterior em US$). Define moeda e fração. */
export const EtfMarketPicker: React.FC<{ etfMarket: EtfMarket; onSelectEtfMarket: (market: EtfMarket) => void }> = ({
    etfMarket, onSelectEtfMarket,
}) => (
    <div className="flex flex-col gap-1.5">
        <span id="etf-market-label" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-1">
            Mercado do ETF
        </span>
        <div role="group" aria-labelledby="etf-market-label" className="grid grid-cols-2 gap-2">
            {([['BR', 'Brasil (R$)'], ['US', 'Exterior (US$)']] as const).map(([mkt, label]) => (
                <button
                    key={mkt}
                    type="button"
                    onClick={() => onSelectEtfMarket(mkt)}
                    className={`py-2.5 rounded-xl text-xs font-bold border transition-all min-h-[44px] ${
                        etfMarket === mkt
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                            : 'bg-card border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
        <p className="text-[10px] text-slate-500 ml-1">
            Ex.: BOVA11/IVVB11 (B3) ou VOO/QQQ (Exterior). Ouro lastreado (GLD/GOLD11) também entra como ETF.
        </p>
    </div>
);

/** Exterior: sub-tipo (ramificação). Vazio = classificação automática. */
export const UsSubTypeField: React.FC<{ form: AssetFormState; setForm: SetForm }> = ({ form, setForm }) => (
    <div className="flex flex-col gap-1.5">
        <label htmlFor="asset-us-subtype" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-1">
            Tipo (Exterior)
        </label>
        <div className="relative">
            <select
                id="asset-us-subtype"
                value={form.usSubType || ''}
                onChange={(e) => setForm(prev => ({ ...prev, usSubType: e.target.value || undefined }))}
                className={SELECT_CLASS}
            >
                <option value="">Automático (detectar)</option>
                <option value="STOCK">Stock (ação)</option>
                <option value="REIT">REIT (imobiliário)</option>
                <option value="DOLLAR">Dólar (caixa/exposição)</option>
            </select>
            <Tag className="absolute right-3 top-3.5 text-slate-600 pointer-events-none" size={14} />
        </div>
        <p className="text-[10px] text-slate-500 ml-1">
            Usado para ramificar sua Carteira Ideal. Deixe em "Automático" para o sistema detectar.
        </p>
    </div>
);
