import type { Asset, AssetType } from '../../../contexts/WalletContext';

/**
 * Regras de exibição da seção "Ativo" do Adicionar ativo (`AssetSection`):
 * exemplo do campo de ticker, moeda da cotação, rótulo do resultado da busca e
 * quais posições aparecem no seletor de venda.
 */

export type EtfMarket = 'BR' | 'US';

/** Resultado do autocomplete, como o servidor (ou o "Criar: ...") devolve. */
export interface SearchResultView {
    ticker: string;
    name?: string;
    type?: string;
    isTreasury?: boolean;
    isManual?: boolean;
    rate?: number;
    index?: string;
    maturityDate?: string;
}

const PLACEHOLDER_BY_TYPE: Partial<Record<AssetType, string>> = {
    FII: 'Ex: MXRF11, HGLG11, KNRI11',
    CRYPTO: 'Ex: BTC, ETH',
    STOCK_US: 'Ex: AAPL, NVDA, MSFT, GOOGL',
    FIXED_INCOME: 'Busque: Tesouro Selic, NTN-B, CDB, LCI...',
};

/** Exemplo do campo de busca conforme a classe (e o mercado, no ETF). */
export function tickerPlaceholder(type: AssetType, etfMarket: EtfMarket): string {
    if (type === 'ETF') return etfMarket === 'US' ? 'Ex: VOO, IVV, QQQ, VT' : 'Ex: BOVA11, IVVB11, SMAL11';
    return PLACEHOLDER_BY_TYPE[type] ?? 'Ex: PETR4, VALE3, ITUB4';
}

/** O ativo é cotado em dólar: Exterior ou ETF do mercado americano. */
export const isUsdQuoted = (type: AssetType, etfMarket: EtfMarket): boolean =>
    type === 'STOCK_US' || (type === 'ETF' && etfMarket === 'US');

/** Etiqueta da classe no resultado da busca. */
export function searchResultBadge(result: SearchResultView): string | undefined {
    if (result.isTreasury) return 'TESOURO';
    if (result.type === 'STOCK') return 'AÇÃO';
    if (result.type === 'FIXED_INCOME') return 'RENDA FIXA';
    return result.type;
}

/** Posições da classe escolhida que ainda têm quantidade para vender. */
export const sellableAssets = (assets: Asset[], type: AssetType): Asset[] =>
    assets.filter(a => a.type === type && a.quantity > 0);
