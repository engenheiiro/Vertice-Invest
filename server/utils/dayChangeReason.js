/**
 * Motivo da Variação Hoje de UMA posição — a régua que produziu o número.
 *
 * `processWalletAsset` mede o início do dia por caminhos diferentes conforme o
 * que existe: candle gravado do dia-âncora, preço médio (posição comprada hoje),
 * fechamento anterior do provedor, PU oficial do Tesouro, curva de accrual. Todos
 * respondem "quanto mudou desde o fechamento anterior", mas com precisão e
 * significado diferentes — e alguns devolvem ZERO de propósito.
 *
 * Sem essa etiqueta, o zero de "o ativo não negociou hoje" é indistinguível do
 * zero de "o ativo fechou no zero a zero", e a tela some com a diferença. O
 * primeiro é uma afirmação sobre os NOSSOS dados; o segundo, sobre o mercado.
 *
 * ── ORDEM DE PRECEDÊNCIA ────────────────────────────────────────────────────
 *
 * O motivo tem de seguir EXATAMENTE a ordem em que `processWalletAsset`
 * sobrescreve `dayChangePct` — senão a linha mostra um número e explica outro,
 * que é a mesma classe de divergência entre duas pontas que a âncora do dia
 * fechou (ver utils/dayCloses.js).
 *
 * Renda fixa / caixa:
 *   1. fonte do preço  → MTM (PU de hoje) | MTM_PENDING (PU defasado) | CURVE
 *   2. comprado hoje   → sobrescreve APENAS no ramo da curva; no MTM o código
 *                        não zera por compra do dia
 *   3. vencido         → sobrescreve tudo (accrual congelado no vencimento)
 *
 * Mercado (ação, FII, ETF, cripto):
 *   1. candle do dia-âncora        → ANCHOR_CLOSE
 *   2. sem candle, cripto          → PREVIOUS_CLOSE | PROVIDER_WINDOW
 *   3. sem candle, demais classes  → PROVIDER_SESSION | STALE_QUOTE
 *   4. comprado hoje               → sobrescreve TODOS os anteriores
 *   (sem cotação em cache          → NO_QUOTE, e nada acima roda)
 */

export const DAY_CHANGE_REASON = {
    /** Fechamento GRAVADO do dia-âncora — o mesmo número que virou patrimônio no snapshot. */
    ANCHOR_CLOSE: 'ANCHOR_CLOSE',
    /** Cripto sem candle do dia-âncora: fechamento anterior do provedor (âncora fixa). */
    PREVIOUS_CLOSE: 'PREVIOUS_CLOSE',
    /** Todos os lotes são de hoje: o início do dia é o preço médio, não um candle. */
    BOUGHT_TODAY: 'BOUGHT_TODAY',
    /** Título público marcado pelo PU oficial do Tesouro publicado HOJE. */
    FIXED_INCOME_MTM: 'FIXED_INCOME_MTM',
    /** É marcado a mercado, mas o PU mais recente ainda é o de outro dia. */
    FIXED_INCOME_MTM_PENDING: 'FIXED_INCOME_MTM_PENDING',
    /** Renda fixa na curva: privada, com cupom semestral, ou sem série de PU. */
    FIXED_INCOME_CURVE: 'FIXED_INCOME_CURVE',
    /** Título vencido: o valor está congelado, não rende mais. */
    MATURED: 'MATURED',
    /** A cotação em cache é de uma sessão anterior — variação zerada de propósito. */
    STALE_QUOTE: 'STALE_QUOTE',
    /** Nada no cache de mercado para o ticker. */
    NO_QUOTE: 'NO_QUOTE',
    /** Cripto sem candle e sem fechamento anterior: janela DESLIZANTE de 24h do provedor. */
    PROVIDER_WINDOW: 'PROVIDER_WINDOW',
    /** Sem candle do dia-âncora: variação da sessão, como o provedor reporta. */
    PROVIDER_SESSION: 'PROVIDER_SESSION',
};

/**
 * Motivos que NÃO merecem etiqueta na tela.
 *
 * Os dois respondem exatamente o que a linha promete ("quanto mudou desde o
 * fechamento anterior"), então rotulá-los transformaria informação em ruído e
 * apagaria o valor dos outros nove — que são justamente as exceções.
 */
export const DEFAULT_DAY_CHANGE_REASONS = new Set([
    DAY_CHANGE_REASON.ANCHOR_CLOSE,
    DAY_CHANGE_REASON.PREVIOUS_CLOSE,
]);

export const isDefaultDayChangeReason = (reason) => DEFAULT_DAY_CHANGE_REASONS.has(reason);

/**
 * Motivos em que o ZERO é nosso, não do mercado: a posição existe e se moveu (ou
 * pode ter se movido), mas não temos como medir. A UI mantém essas linhas
 * VISÍVEIS em vez de agrupá-las num contador — esconder o que não sabemos é a
 * opção desonesta.
 */
export const ZEROED_BY_DATA_REASONS = new Set([
    DAY_CHANGE_REASON.STALE_QUOTE,
    DAY_CHANGE_REASON.NO_QUOTE,
    DAY_CHANGE_REASON.MATURED,
    DAY_CHANGE_REASON.FIXED_INCOME_MTM_PENDING,
]);
