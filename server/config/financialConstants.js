
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

// NTN-B longa (taxa real) de fallback quando a cadeia Tesouro→Investidor10 falha.
// Fonte única — antes o scoringEngine usava 6.0 num ponto e 6.30 em outros quatro,
// fazendo o mesmo NTN-B ausente valer dois números diferentes no mesmo run.
export const DEFAULT_NTNB_FALLBACK = Number(process.env.DEFAULT_NTNB_FALLBACK) || 6.3;

// Yield-alvo do preço justo Bazin para ações BR: max(mínimo clássico, NTN-B + prêmio).
// O 6% histórico de Bazin, fixo, inflava o preço justo de dividendeiras com Selic ~14%;
// ancorar na NTN-B mantém o alvo realista em qualquer regime de juros.
export const BAZIN_MIN_YIELD = Number(process.env.BAZIN_MIN_YIELD) || 6;
export const BAZIN_NTNB_PREMIUM = Number(process.env.BAZIN_NTNB_PREMIUM) || 2;

// DY 12m acima deste teto é tratado como provável amortização de capital / evento não
// recorrente (yield-trap), não renda sustentável. Calibragem: NTN-B ~6,3% + tier máximo
// de spread premiado (7pp) ≈ 13,3%; FIIs de papel legítimos em CDI alto rodam 12–16%.
export const FII_YIELD_TRAP_THRESHOLD = Number(process.env.FII_YIELD_TRAP_THRESHOLD) || 20;

// ─────────────────────────────────────────────────────────────────────────────
// Ciclicidade — parâmetros do tratamento de setores cíclicos (INDUSTRIAL/COMMODITIES).
// Ver server/config/sectorTaxonomy.js (CYCLICAL_MACRO_SECTORS / isCyclicalSector) e o
// bloco de penalidade cíclica em scoringEngine.js. Motivação: value-trap cíclico (SHUL4).
// ─────────────────────────────────────────────────────────────────────────────

// P/L abaixo deste piso, COMBINADO com margem/ROE elevados, sinaliza LUCRO DE PICO de
// ciclo (preço ÷ lucro inflado) — não barato genuíno. Gatilho do desconto de pico.
export const CYCLICAL_PEAK_PL_FLOOR = Number(process.env.CYCLICAL_PEAK_PL_FLOOR) || 8;

// Desconto de "pico de ciclo" aplicado a cíclicas com P/L de pico + preço em downtrend
// (rolando o topo do ciclo). Poupa o perfil BOLD (aposta de reversão é legítima lá).
export const CYCLICAL_PEAK_DEF_DISCOUNT = Number(process.env.CYCLICAL_PEAK_DEF_DISCOUNT) || 12;
export const CYCLICAL_PEAK_MOD_DISCOUNT = Number(process.env.CYCLICAL_PEAK_MOD_DISCOUNT) || 8;

// Multiplicador da penalidade de downtrend (SMA200) para cíclicas: downtrend estrutural
// numa cíclica é sinal mais forte de reversão de ciclo que numa não-cíclica.
export const CYCLICAL_TREND_MULTIPLIER = Number(process.env.CYCLICAL_TREND_MULTIPLIER) || 1.3;

// SELIC (% a.a.) a partir da qual o ambiente é hostil ao capex industrial/agro —
// dispara desconto de juros para cíclicas nos perfis DEFENSIVE/MODERATE.
export const RATE_SENSITIVE_SELIC_HIGH = Number(process.env.RATE_SENSITIVE_SELIC_HIGH) || 12;
export const CYCLICAL_RATE_DEF_DISCOUNT = Number(process.env.CYCLICAL_RATE_DEF_DISCOUNT) || 6;
export const CYCLICAL_RATE_MOD_DISCOUNT = Number(process.env.CYCLICAL_RATE_MOD_DISCOUNT) || 4;

// ─────────────────────────────────────────────────────────────────────────────
// Governança / controle estatal. Estatais (Petrobras, BB, Sanepar, Cemig, ...) têm
// dividendo e alocação de capital DISCRICIONÁRIOS — o acionista controlador (União/
// Estado) pode redirecionar payout, preços e capex por decisão política. O DY alto
// delas NÃO é contratual como o de uma pagadora privada regulada, então não deve
// pesar como "renda segura" no perfil Defensivo. Não é BARRAMENTO (uma estatal pode
// ser um bom ativo): é um desconto que faz a estatal ranquear ABAIXO de uma privada
// de fundamentos equivalentes. Poupa o BOLD (aposta não se importa com governança).
export const GOVERNANCE_STATE_DEF_DISCOUNT = Number(process.env.GOVERNANCE_STATE_DEF_DISCOUNT) || 8;
export const GOVERNANCE_STATE_MOD_DISCOUNT = Number(process.env.GOVERNANCE_STATE_MOD_DISCOUNT) || 4;

// ─────────────────────────────────────────────────────────────────────────────
// Alavancagem crítica (DL/EBITDA) fora do Defensivo. O desconto de alavancagem já
// existia, mas só dentro do bloco Defensivo (e só quando o ativo já era ELEGÍVEL a
// ele) e no sub-score estrutural de Risco — que é apenas tiebreaker/exibição, nunca
// input do score de MODERATE/BOLD. Resultado real observado em produção: MTRE3
// (DL/EBITDA 4.1x, "Alavancagem Crítica") virou #1 geral do ranking STOCK em BOLD
// com score 99, sem nenhum desconto por dívida. MODERATE/BOLD toleram volatilidade
// por natureza, mas risco de SOLVÊNCIA é uma dimensão distinta — mesmo uma aposta
// especulativa deve descontar por risco de default. Ver bloco de alavancagem em
// scoreStockProfiles (scoringEngine.js).
// ─────────────────────────────────────────────────────────────────────────────
export const LEVERAGE_CRITICAL_MOD_DISCOUNT = Number(process.env.LEVERAGE_CRITICAL_MOD_DISCOUNT) || 20;
export const LEVERAGE_CRITICAL_BOLD_DISCOUNT = Number(process.env.LEVERAGE_CRITICAL_BOLD_DISCOUNT) || 15;
export const LEVERAGE_ELEVATED_MOD_DISCOUNT = Number(process.env.LEVERAGE_ELEVATED_MOD_DISCOUNT) || 10;
export const LEVERAGE_ELEVATED_BOLD_DISCOUNT = Number(process.env.LEVERAGE_ELEVATED_BOLD_DISCOUNT) || 8;

// Teto de score para empresas com alavancagem CRÍTICA (DL/EBITDA > 3.5x). O desconto
// graduado acima não basta: múltiplos extremos (PEG < 0.5, upside > 80%) podiam manter
// uma micro-cap super-alavancada no topo do ranking mesmo após o -15/-20 (MTRE3: caía
// de 99 para 84 em BOLD e seguia #2 geral). Risco de SOLVÊNCIA deve limitar a convicção
// MÁXIMA — análogo ao teto especulativo de empresa sem lucro. MODERATE mais severo que
// BOLD (aposta de reversão alavancada é mais legítima no Arrojado). Ver scoreStockProfiles.
export const LEVERAGE_CRITICAL_BOLD_CAP = Number(process.env.LEVERAGE_CRITICAL_BOLD_CAP) || 75;
export const LEVERAGE_CRITICAL_MOD_CAP = Number(process.env.LEVERAGE_CRITICAL_MOD_CAP) || 70;

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
