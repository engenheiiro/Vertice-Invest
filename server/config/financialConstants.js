
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

// Teto de pontos (candles diários) guardados por ticker em AssetHistory.
// A análise só precisa de ≤252 pontos (SMA200 + volatilidade de 252 dias úteis) e os
// sinais leem os últimos 60 — guardar ~1.400 candles (2020→hoje) só inchava o banco.
// 400 (~1,6 ano) cobre SMA200/volatilidade/sinais com folga. Aplicado na escrita do
// timeSeriesWorker (universo de pesquisa). Ver HISTORY_CAP_EXEMPT_TICKERS.
export const ASSET_HISTORY_MAX_POINTS = Number(process.env.ASSET_HISTORY_MAX_POINTS) || 400;

// Tickers ISENTOS do cap acima: câmbio (conversão por data na carteira) e benchmarks
// (comparação de TWRR/beta) precisam de histórico profundo e são poucos documentos.
// Os caminhos da carteira (financialService) e de benchmark (marketDataService) NÃO
// aplicam o cap; esta lista garante que o worker e o script de trim também os preservem.
export const HISTORY_CAP_EXEMPT_TICKERS = new Set(['USD-BRL', '^BVSP', '^GSPC', '^IXIC', '^IFIX']);

// Selic/CDI de fallback quando não há valor no SystemConfig nem na API do BC.
// Atualizado jun/2026: Selic real subiu para 14,25 (via BrasilAPI; BCB estava em 502).
export const DEFAULT_SELIC_FALLBACK = Number(process.env.DEFAULT_SELIC_FALLBACK) || 14.25;

// Alíquotas de IR sobre ganho de capital, por classe de ativo. Usadas APENAS pelo
// Rebalanceamento IA para ESTIMAR o impacto fiscal de uma venda sugerida — não
// substituem apuração fiscal real (não modelam isenção mensal de Ações até R$20k
// nem de Cripto até R$35k, nem a tabela regressiva da Renda Fixa).
export const CAPITAL_GAINS_TAX = {
    STOCK: 0.15,      // Ações BR: 15% sobre o ganho
    FII: 0.20,        // FIIs: 20% sobre o ganho (sem isenção)
    STOCK_US: 0.15,   // Exterior: 15% (faixa base de ganho de capital)
    CRYPTO: 0.15,     // Cripto: 15% (isento até R$35k/mês de vendas — não modelado)
    FIXED_INCOME: 0,  // Renda Fixa: IR retido na fonte — não estimado aqui
    CASH: 0,
};
