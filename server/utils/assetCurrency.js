/**
 * Fonte ÚNICA da regra de moeda de um ativo/lançamento.
 *
 * A expressão `currency === 'USD' || type === 'STOCK_US' || type === 'CRYPTO'`
 * estava replicada em 8 arquivos (schedulerService, walletController ×3,
 * goalsController, financialService ×2, rebalanceService). Qualquer ajuste
 * futuro na regra precisava ser feito em todos — e um esquecimento significa
 * patrimônio calculado com câmbio em um lugar e sem câmbio em outro.
 *
 * Por que os três critérios (e não só `currency`): posições antigas foram
 * criadas antes do campo `currency` existir, então `type` é o fallback
 * histórico. Um ETF é ambíguo por natureza (BOVA11 é BRL, VOO é USD) e se
 * resolve exclusivamente pelo `currency` explícito.
 */

/** Tipos cuja moeda nativa é dólar independentemente do campo `currency`. */
const DOLLARIZED_TYPES = new Set(['STOCK_US', 'CRYPTO']);

/**
 * O ativo (ou metadado equivalente) é cotado em dólar?
 * Aceita UserAsset, MarketAsset ou qualquer objeto com `{ type, currency }`.
 * Tolera `null`/`undefined` — nunca lança.
 */
export const isDollarized = (assetLike) => {
    if (!assetLike) return false;
    return assetLike.currency === 'USD' || DOLLARIZED_TYPES.has(assetLike.type);
};

/** Moeda do ativo: `'USD'` | `'BRL'`. Sem ativo → `'BRL'` (moeda base do app). */
export const resolveAssetCurrency = (assetLike) => (isDollarized(assetLike) ? 'USD' : 'BRL');

/**
 * Moeda de EXIBIÇÃO de um lançamento do extrato.
 *
 * `price`/`totalValue` da AssetTransaction são gravados na moeda nativa do
 * ativo, nunca convertidos. A precedência abaixo é o que dá resiliência ao
 * extrato:
 *
 *  1. `tx.currency` gravado — registro histórico, imutável. Vale mesmo que a
 *     posição atual divirja (correção de cadastro não pode reescrever o
 *     passado: US$ 400 pagos continuam US$ 400).
 *  2. Posição atual — cobre lançamentos anteriores à migração.
 *  3. `'BRL'` — posição já zerada/removida e sem registro. Mesmo resultado do
 *     comportamento legado, então nunca é uma regressão.
 *
 * IMPORTANTE: o campo `currency` do schema NÃO tem `default`. Se tivesse, o
 * Mongoose preencheria 'BRL' ao hidratar documentos legados e o passo 2 nunca
 * rodaria — um lançamento em dólar não migrado voltaria a ser lido como real.
 */
export const resolveTransactionCurrency = (tx, assetLike = null) => {
    if (!needsCurrencyFallback(tx)) return tx.currency;
    if (assetLike) return resolveAssetCurrency(assetLike);
    return 'BRL';
};

/**
 * O lançamento depende do fallback pela posição? (moeda ausente ou inválida)
 *
 * Permite que as rotas de extrato só consultem UserAsset quando a página tem de
 * fato registro legado — com a base migrada, a consulta extra desaparece. É o
 * mesmo predicado usado por `resolveTransactionCurrency`, para não existirem
 * duas definições de "moeda gravada válida" que possam divergir.
 */
export const needsCurrencyFallback = (tx) => {
    const persisted = tx?.currency;
    return persisted !== 'BRL' && persisted !== 'USD';
};
