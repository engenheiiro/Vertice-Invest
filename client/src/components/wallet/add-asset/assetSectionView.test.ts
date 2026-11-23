import { describe, expect, it } from 'vitest';
import type { Asset } from '../../../contexts/WalletContext';
import { isUsdQuoted, searchResultBadge, sellableAssets, tickerPlaceholder } from './assetSectionView';

describe('assetSectionView', () => {
    it('exemplo do campo por classe, com o mercado decidindo o do ETF', () => {
        expect(tickerPlaceholder('STOCK', 'BR')).toBe('Ex: PETR4, VALE3, ITUB4');
        expect(tickerPlaceholder('OURO', 'US')).toBe('Ex: PETR4, VALE3, ITUB4');
        expect(tickerPlaceholder('FII', 'BR')).toBe('Ex: MXRF11, HGLG11, KNRI11');
        expect(tickerPlaceholder('ETF', 'US')).toBe('Ex: VOO, IVV, QQQ, VT');
        expect(tickerPlaceholder('ETF', 'BR')).toBe('Ex: BOVA11, IVVB11, SMAL11');
        expect(tickerPlaceholder('FIXED_INCOME', 'BR')).toBe('Busque: Tesouro Selic, NTN-B, CDB, LCI...');
    });

    it('cotação em dólar só no Exterior e no ETF americano', () => {
        expect(isUsdQuoted('STOCK_US', 'BR')).toBe(true);
        expect(isUsdQuoted('ETF', 'US')).toBe(true);
        expect(isUsdQuoted('ETF', 'BR')).toBe(false);
        expect(isUsdQuoted('CRYPTO', 'US')).toBe(false);
    });

    it('etiqueta do resultado: Tesouro vence a classe', () => {
        expect(searchResultBadge({ ticker: 'X', isTreasury: true, type: 'STOCK' })).toBe('TESOURO');
        expect(searchResultBadge({ ticker: 'X', type: 'STOCK' })).toBe('AÇÃO');
        expect(searchResultBadge({ ticker: 'X', type: 'FIXED_INCOME' })).toBe('RENDA FIXA');
        expect(searchResultBadge({ ticker: 'X', type: 'FII' })).toBe('FII');
    });

    it('venda lista só a classe escolhida com saldo positivo', () => {
        const a = (ticker: string, type: Asset['type'], quantity: number) => ({ ticker, type, quantity }) as Asset;
        const list = [a('PETR4', 'STOCK', 10), a('VALE3', 'STOCK', 0), a('MXRF11', 'FII', 5)];
        expect(sellableAssets(list, 'STOCK').map((x) => x.ticker)).toEqual(['PETR4']);
    });
});
