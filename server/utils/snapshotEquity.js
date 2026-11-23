/**
 * Patrimônio de um conjunto de posições numa data — a marcação do snapshot
 * diário. Pura (sem banco): o contexto (preços, fechamentos, macro, câmbio, PU)
 * vem de loadSnapshotContext. Extraída de services/schedulerService.js, que a
 * re-exporta para preservar o ponto de importação histórico.
 */
import { isDollarized } from './assetCurrency.js';
import { historyStorageKey } from './assetHistory.js';
import { valueFixedIncomeAsset } from './fixedIncome.js';
import { positionCostBRL } from './fxRate.js';
import { safeAdd, safeCurrency, safeMult, safeValue } from './mathUtils.js';
import { EMPTY_TREASURY_PRICING } from '../services/treasuryPriceService.js';
// Patrimônio (equity/invested) de um conjunto de ativos numa data de cálculo.
// Renda fixa/caixa: accrual exato via fonte única (utils/fixedIncome). Renda
// variável: FECHAMENTO do dia (mesma marcação do rebuild), caindo na cotação
// corrente só quando o candle ainda não chegou. Esse fallback é o último recurso:
// `ensureWalletDayCandles` busca o candle do dia dos ativos em carteira antes do
// snapshot, então ele só entra quando a fonte externa falhou ou o ativo não
// negociou no dia.
export const computeEquityAt = (assets, { priceMap, closeMap, macroRates, usdRate, calcDate, treasuryPricing = EMPTY_TREASURY_PRICING }) => {
    let totalEquity = 0;
    let totalInvested = 0;
    for (const asset of assets) {
        const multiplier = isDollarized(asset) ? usdRate : 1;
        if (asset.type === 'CASH' || asset.type === 'FIXED_INCOME') {
            // O accrual mantém precisão integral até a persistência do snapshot;
            // arredondar aqui antecipa centavos em títulos com PU fracionário.
            totalEquity += valueFixedIncomeAsset(asset, {
                ...macroRates, calcDate, history: treasuryPricing.historyFor(asset),
            }).value;
            totalInvested += asset.totalCost;
        } else {
            const close = closeMap?.get(historyStorageKey(asset.ticker, asset.type)) || 0;
            const price = close > 0 ? close : (priceMap.get(asset.ticker)?.price || 0);
            if (price > 0) {
                const nativeValue = safeValue(asset.quantity, price);
                totalEquity = safeAdd(totalEquity, safeCurrency(safeMult(nativeValue, multiplier)));
            } else if (asset.quantity > 0) {
                // Sem fechamento e sem cotação: marca no CUSTO, como o rebuild faz
                // (último preço conhecido → custo médio). Antes a posição sumia do
                // patrimônio E do custo, enquanto o card seguia contando o custo —
                // o snapshot gravava uma carteira menor que a da tela e o rebuild
                // seguinte reescrevia o dia com a posição de volta.
                totalEquity = safeAdd(totalEquity, safeCurrency(safeMult(Number(asset.totalCost) || 0, multiplier)));
            }
            // Custo SEMPRE conta (posição existe com ou sem cotação), com o câmbio
            // das compras (mesma base do fluxo de aportes em sumTransactionFlowBRL).
            if (asset.quantity > 0) {
                totalInvested = safeAdd(totalInvested, positionCostBRL(asset, usdRate));
            }
        }
    }
    return { totalEquity, totalInvested };
};
