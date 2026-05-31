/**
 * Política de cache do React Query — fonte única da verdade para `staleTime`.
 * Antes esses valores estavam espalhados (2/5/10/15/60min) sem critério em
 * useDashboardData e WalletContext. Os nomes refletem a volatilidade do dado.
 */
const MIN = 1000 * 60;

export const STALE_TIME = {
  /** Dados que mudam ao longo do pregão (carteira/posições). */
  REALTIME: 2 * MIN,
  /** Atualizações frequentes (sinais, dividendos). */
  SHORT: 5 * MIN,
  /** Séries que mudam algumas vezes ao dia (histórico patrimonial). */
  MEDIUM: 10 * MIN,
  /** Indicadores macro (SELIC/IPCA/câmbio) — baixa volatilidade intradiária. */
  LONG: 15 * MIN,
  /** Relatórios de research — gerados ~1x/dia. */
  HOURLY: 60 * MIN,
} as const;
