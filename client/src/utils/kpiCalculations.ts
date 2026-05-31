import type { Asset, WalletKPIs } from '../contexts/WalletContext';

/**
 * Cálculo puro dos KPIs da carteira a partir das posições e dos KPIs vindos do
 * servidor. Extraído do `WalletContext` (M5) para ser testável isoladamente.
 *
 * Regras preservadas do contexto original:
 * - `totalEquity`/`totalInvested` são somados client-side a partir das posições.
 * - `totalResult`, `dayVariation*` e demais campos sensíveis (câmbio intraday,
 *   lucro realizado, dividendos) vêm do servidor quando disponíveis; o cálculo
 *   local é apenas fallback.
 * - Carteira vazia retorna zeros, preservando dividendos provisionados do server.
 */
export function computeWalletKpis(
  assets: Asset[],
  serverKpis?: Partial<WalletKPIs>
): WalletKPIs {
  if (assets.length === 0) {
    return {
      totalEquity: 0,
      totalInvested: 0,
      totalResult: 0,
      totalResultPercent: 0,
      dayVariation: 0,
      dayVariationPercent: 0,
      totalDividends: serverKpis?.totalDividends || 0,
      projectedDividends: serverKpis?.projectedDividends || 0,
      weightedRentability: 0,
      dataQuality: 'AUDITED',
      sharpeRatio: 0,
      beta: 0,
    };
  }

  let equity = 0;
  let invested = 0;
  for (const asset of assets) {
    equity += asset.totalValue;
    invested += asset.totalCost;
  }

  // totalResult e dayVariation vêm do servidor pois ele computa corretamente:
  // totalResult = (equity-invested) + realizedProfit + dividends; e dayVariation
  // considera variação cambial intraday em ativos USD.
  const result = serverKpis?.totalResult ?? equity - invested;
  const resultPercent =
    serverKpis?.totalResultPercent ?? (invested > 0 ? (result / invested) * 100 : 0);

  return {
    totalEquity: equity,
    totalInvested: invested,
    totalResult: result,
    totalResultPercent: resultPercent,
    dayVariation: serverKpis?.dayVariation ?? 0,
    dayVariationPercent: serverKpis?.dayVariationPercent ?? 0,
    totalDividends: serverKpis?.totalDividends || 0,
    projectedDividends: serverKpis?.projectedDividends || 0,
    weightedRentability: serverKpis?.weightedRentability || resultPercent,
    dataQuality: serverKpis?.dataQuality || 'ESTIMATED',
    sharpeRatio: serverKpis?.sharpeRatio || 0,
    beta: serverKpis?.beta || 0,
  };
}
