/**
 * A FORMA DE UM TICKER DA B3 — em um lugar só.
 *
 * Existiam três cópias desta regra, e elas divergiram, como toda cópia diverge:
 *
 *   - `externalMarketService`: `^[A-Z][A-Z0-9]{3}\d{1,2}$` (já corrigida para
 *     aceitar B3SA3, que tem dígito na raiz);
 *   - `b3HistoryFallback` e `scripts/backfillB3Closes`: `^[A-Z]{4}\d{1,2}$`, a
 *     versão antiga — que rejeita B3SA3 e, por tabela, tirava a própria bolsa do
 *     reforço de candle da B3 sem que nada avisasse.
 *
 * A regra decide coisas que não parecem ligadas mas são a mesma pergunta: se o
 * símbolo leva `.SA` no Yahoo, se a URL do Google aponta para `:BVMF`, se a Brapi
 * é tentada, e se o fechamento oficial da B3 pode cobrir a série. Errar aqui não
 * dá erro em lugar nenhum — dá silêncio: o ativo é perguntado no formato errado,
 * nenhuma fonte responde, e o painel mostra "sem preço em fonte nenhuma".
 *
 * A LETRA FINAL foi o caso que revelou o problema. Em 04/09/2026 o EQMA3B
 * aparecia como sem preço em toda a cadeia. Não era papel morto — negociou em 6
 * dos 10 pregões, e `EQMA3B.SA` responde 29,24 no Yahoo. A regex parava no
 * dígito, então o ticker não era reconhecido como B3, ia ao Yahoo cru (sem `.SA`),
 * ao Google como se fosse NASDAQ, e nunca chegava à Brapi. São raros — no pregão
 * de 04/09 só MRSA3B e EQMA3B —, e é justamente por serem raros que ninguém olha.
 */

/**
 * PETR4, HGLG11, B3SA3 (dígito na raiz), EQMA3B (letra de classe no fim).
 * Não casa AAPL, BRK.B, BTC-USD nem VOO.
 */
export const B3_TICKER_RE = /^[A-Z][A-Z0-9]{3}\d{1,2}[A-Z]?$/;

/** Classes cujo papel negocia na B3 e tem fechamento no arquivo do à vista. */
export const B3_TYPES = new Set(['STOCK', 'FII', 'ETF']);

/** O símbolo tem forma de papel da B3? (não diz se existe — só a forma) */
export const isB3Ticker = (ticker) => B3_TICKER_RE.test(String(ticker || '').trim().toUpperCase());
