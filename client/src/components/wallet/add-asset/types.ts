import type { usePriceFetch } from '../../../hooks/usePriceFetch';
import type { useAssetSearch } from '../../../hooks/useAssetSearch';

/** Estado de UI da busca automática de preço (retorno do hook `usePriceFetch`). */
export type PriceFetch = ReturnType<typeof usePriceFetch>;

/** Estado de UI do autocomplete de ticker (retorno do hook `useAssetSearch`). */
export type AssetSearch = ReturnType<typeof useAssetSearch>;

export type TransactionType = 'BUY' | 'SELL';

/** Chave interna para "criar um novo cofrinho" no seletor de Reserva/Caixa. */
export const NEW_RESERVE = '__NEW__';
