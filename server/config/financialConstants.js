
// Fonte Única da Verdade para Taxas Históricas
// Usado para cálculos de CDI/Selic em períodos fechados onde a API do BC não é consultada ou como fallback.

export const HISTORICAL_CDI_RATES = {
    2015: 14.25,
    2016: 14.00,
    2017: 9.95,
    2018: 6.50,
    2019: 5.96,
    2020: 2.77,
    2021: 4.40, // Ajustado para precisão (algumas fontes citam 4.42, mantendo padrão conservador)
    2022: 12.38,
    2023: 13.03,
    2024: 10.80
};

// Data de corte do motor de sinais "v2": apenas sinais gerados a partir
// desta data entram nos cálculos de acurácia/estatísticas do Radar.
// Fonte única da verdade — usado em researchController e generateRadarReport.
export const V2_SIGNAL_START_DATE = new Date('2026-05-09T00:00:00.000Z');

// ─────────────────────────────────────────────────────────────────────────────
// (M9) Parâmetros operacionais centralizados — antes hardcoded em vários services.
// Overridáveis por env onde faz sentido ajustar sem deploy de código.
// ─────────────────────────────────────────────────────────────────────────────

// Regra de Negócio Inviolável #1 (CLAUDE.md): score ≥ 70 → BUY; < 70 → WAIT.
// Vale em todo o sistema (portfolioEngine, aiResearchService).
export const BUY_THRESHOLD = Number(process.env.BUY_THRESHOLD) || 70;

// Máximo de criptos por perfil no draft competitivo (portfolioEngine).
export const MAX_CRYPTO_PER_PROFILE = Number(process.env.MAX_CRYPTO_PER_PROFILE) || 3;

// Janela de cache de cotações de mercado, em minutos (marketDataService).
export const MARKET_CACHE_DURATION_MINUTES = Number(process.env.MARKET_CACHE_MINUTES) || 20;

// Selic/CDI de fallback quando não há valor no SystemConfig nem na API do BC.
export const DEFAULT_SELIC_FALLBACK = Number(process.env.DEFAULT_SELIC_FALLBACK) || 11.25;
