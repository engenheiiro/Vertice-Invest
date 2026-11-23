import type { Asset, WalletKPIs } from '../contexts/WalletContext';

/**
 * Saldo econômico que fecha com o Lucro Total.
 *
 * Esta é a identidade canônica exibida no card e no gráfico. Evita misturar a
 * soma dos ativos (que conserva casas subcentavo) com KPIs monetários já
 * arredondados pelo servidor — diferença que podia aparecer como R$ 0,01.
 */
export const totalResultBalance = (
  kpis: Pick<WalletKPIs, 'totalInvested' | 'totalResult'>
): number => kpis.totalInvested + kpis.totalResult;

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
type ServerKpis = Partial<WalletKPIs> | undefined;

/** Valor do servidor quando veio (nem `null` nem `undefined`); senão o fallback local. */
function serverOr<K extends keyof WalletKPIs>(
  serverKpis: ServerKpis,
  key: K,
  fallback: WalletKPIs[K]
): WalletKPIs[K] {
  return serverKpis?.[key] ?? fallback;
}

/** Carteira vazia: zeros, preservando o que o servidor sabe de proventos e âncora. */
function emptyWalletKpis(serverKpis: ServerKpis): WalletKPIs {
  return {
    totalEquity: 0,
    totalInvested: 0,
    totalResult: 0,
    totalResultPercent: 0,
    dayVariation: 0,
    dayVariationPercent: 0,
    dayAnchorDate: serverOr(serverKpis, 'dayAnchorDate', null),
    dayDividends: 0,
    totalDividends: serverOr(serverKpis, 'totalDividends', 0),
    projectedDividends: serverOr(serverKpis, 'projectedDividends', 0),
    weightedRentability: 0,
    dataQuality: 'AUDITED',
    // Sem posições não há risco medível — null, não zero.
    sharpeRatio: null,
    sharpeConfidence: null,
    sharpeStandardError: null,
    sharpeSample: 0,
    beta: null,
  };
}

export function computeWalletKpis(
  assets: Asset[],
  serverKpis?: Partial<WalletKPIs>
): WalletKPIs {
  if (assets.length === 0) return emptyWalletKpis(serverKpis);

  let equity = 0;
  let invested = 0;
  for (const asset of assets) {
    equity += asset.totalValue;
    invested += asset.totalCost;
  }

  // totalResult e dayVariation vêm do servidor pois ele computa corretamente:
  // totalResult = (equity-invested) + realizedProfit + dividends; e dayVariation
  // considera variação cambial intraday em ativos USD.
  const result = serverOr(serverKpis, 'totalResult', equity - invested);
  const resultPercent = serverOr(
    serverKpis,
    'totalResultPercent',
    invested > 0 ? (result / invested) * 100 : 0
  );

  return {
    totalEquity: equity,
    totalInvested: invested,
    totalResult: result,
    totalResultPercent: resultPercent,
    dayVariation: serverOr(serverKpis, 'dayVariation', 0),
    dayVariationPercent: serverOr(serverKpis, 'dayVariationPercent', 0),
    // Acompanham a variação: a janela que ela cobre e os proventos do dia-ex.
    // Sem repassá-los aqui, o detalhamento do dia perderia os dois no caminho.
    dayAnchorDate: serverOr(serverKpis, 'dayAnchorDate', null),
    dayDividends: serverOr(serverKpis, 'dayDividends', 0),
    totalDividends: serverOr(serverKpis, 'totalDividends', 0),
    projectedDividends: serverOr(serverKpis, 'projectedDividends', 0),
    weightedRentability: serverOr(serverKpis, 'weightedRentability', resultPercent),
    dataQuality: serverOr(serverKpis, 'dataQuality', 'ESTIMATED'),
    // fallback `null` e não `0`: ausência de métrica é "não medido", não "risco zero".
    sharpeRatio: serverOr(serverKpis, 'sharpeRatio', null),
    sharpeConfidence: serverOr(serverKpis, 'sharpeConfidence', null),
    sharpeStandardError: serverOr(serverKpis, 'sharpeStandardError', null),
    sharpeSample: serverOr(serverKpis, 'sharpeSample', 0),
    beta: serverOr(serverKpis, 'beta', null),
  };
}
