/**
 * UNIVERSO DE CRIPTO — e, para cada moeda, o SÍMBOLO que o provedor entende.
 *
 * Existe porque as duas coisas moravam em listas separadas, ambas inline: o
 * `syncService` semeava o universo com uma lista de tickers e o
 * `externalMarketService` decidia "isso é cripto?" com outra cópia da mesma
 * lista, montando o símbolo por concatenação (`${ticker}-USD`). Duas listas que
 * precisam concordar e nenhuma delas com dono.
 *
 * O QUE A CONCATENAÇÃO QUEBRA. Ticker de cripto não é único: quando dois tokens
 * disputam a sigla, o Yahoo desempata com o id da CoinMarketCap e serve o
 * IMPOSTOR no símbolo curto. Medido em 05/09/2026, com o preço que estava no
 * nosso banco à esquerda e o token de verdade à direita:
 *
 *   TAO   1,27e-7  "Together As One" (parado em 2022)  ← Bittensor, US$ 229,25
 *   GRT   0,4543   "Golden Ratio Token" (2022)         ← The Graph, US$ 0,0175
 *   IMX   0,0041   "Impermax" (2022)                   ← Immutable, US$ 0,1257
 *   UNI   0,00016  "UNICORN Token" (2025)              ← Uniswap, US$ 6,27
 *   APT   0,00013  "Apricot Finance" (2025)            ← Aptos, US$ 0,607
 *   TON   0,00515  "TON Token" (NEGOCIANDO HOJE)       ← Toncoin, US$ 1,41
 *   MNT   0,0969   "microNFT" (NEGOCIANDO HOJE)        ← Mantle, US$ 0,5736
 *   ARB   0,00063  "ARbit" (NEGOCIANDO HOJE)           ← Arbitrum, US$ 0,1311
 *
 * Os três últimos são a razão de este arquivo existir em vez de uma guarda de
 * frescor: o impostor NEGOCIA. Data de sessão de hoje, preço se movendo, nenhuma
 * régua de staleness acusa — e o ranking recebia Arbitrum valendo 208 vezes
 * menos do que vale. Só o símbolo certo resolve, e símbolo certo se MEDE, não se
 * deduz: o campo `yahoo` abaixo foi conferido um a um contra o nome que o
 * provedor devolve.
 *
 * MANUTENÇÃO. Ao acrescentar uma moeda, confira o nome que volta antes de
 * confiar no símbolo curto:
 *   node server/scripts/auditCryptoSymbols.js
 * O script pergunta ao provedor por cada símbolo deste catálogo e compara nome e
 * data de sessão. Sigla nova quase sempre cabe em `${ticker}-USD`; sigla
 * disputada, nunca — e a diferença não aparece em erro nenhum, só num preço
 * absurdo que ninguém conferiu.
 *
 * `yahoo` ausente = `${ticker}-USD` (o caso comum, e o que vale para a maioria).
 */

/**
 * @typedef {object} CryptoEntry
 * @property {string} ticker símbolo canônico no nosso banco
 * @property {string} name nome de exibição
 * @property {string} [yahoo] símbolo do provedor, quando difere de `TICKER-USD`
 */

/** @type {CryptoEntry[]} */
export const CRYPTO_ASSETS = [
    { ticker: 'BTC', name: 'Bitcoin' },
    { ticker: 'ETH', name: 'Ethereum' },
    { ticker: 'USDT', name: 'Tether USDt' },
    { ticker: 'BNB', name: 'BNB' },
    { ticker: 'SOL', name: 'Solana' },
    { ticker: 'USDC', name: 'USDC' },
    { ticker: 'XRP', name: 'XRP' },
    { ticker: 'DOGE', name: 'Dogecoin' },
    { ticker: 'TON', name: 'Toncoin', yahoo: 'TON11419-USD' },
    { ticker: 'ADA', name: 'Cardano' },
    { ticker: 'SHIB', name: 'Shiba Inu' },
    { ticker: 'AVAX', name: 'Avalanche' },
    { ticker: 'TRX', name: 'TRON' },
    { ticker: 'DOT', name: 'Polkadot' },
    { ticker: 'BCH', name: 'Bitcoin Cash' },
    { ticker: 'LINK', name: 'Chainlink' },
    // MATIC virou POL na migração da Polygon; o símbolo antigo está congelado no
    // Yahoo desde 24/03/2025. O ticker antigo foi aposentado com sucessor.
    { ticker: 'POL', name: 'Polygon', yahoo: 'POL28321-USD' },
    { ticker: 'NEAR', name: 'NEAR Protocol' },
    { ticker: 'LTC', name: 'Litecoin' },
    { ticker: 'ICP', name: 'Internet Computer' },
    { ticker: 'LEO', name: 'UNUS SED LEO' },
    { ticker: 'DAI', name: 'Dai' },
    { ticker: 'UNI', name: 'Uniswap', yahoo: 'UNI7083-USD' },
    { ticker: 'APT', name: 'Aptos', yahoo: 'APT21794-USD' },
    // STX é sigla disputada em DOIS mercados: Stacks na cripto e Seagate na
    // NASDAQ. Ver a nota de `cryptoYahooSymbol` — é por isso que a decisão
    // "isto é cripto?" não pode sair do texto do ticker.
    { ticker: 'STX', name: 'Stacks', yahoo: 'STX4847-USD' },
    { ticker: 'ETC', name: 'Ethereum Classic' },
    { ticker: 'MNT', name: 'Mantle', yahoo: 'MNT27075-USD' },
    { ticker: 'FIL', name: 'Filecoin' },
    // RNDR foi renomeado para RENDER; o símbolo antigo parou em 23/07/2024.
    { ticker: 'RENDER', name: 'Render' },
    { ticker: 'ARB', name: 'Arbitrum', yahoo: 'ARB11841-USD' },
    { ticker: 'XMR', name: 'Monero' },
    { ticker: 'OKB', name: 'OKB' },
    { ticker: 'IMX', name: 'Immutable', yahoo: 'IMX10603-USD' },
    { ticker: 'KAS', name: 'Kaspa' },
    { ticker: 'XLM', name: 'Stellar' },
    { ticker: 'INJ', name: 'Injective' },
    { ticker: 'VET', name: 'VeChain' },
    { ticker: 'FDUSD', name: 'First Digital USD' },
    { ticker: 'OP', name: 'Optimism' },
    { ticker: 'GRT', name: 'The Graph', yahoo: 'GRT6719-USD' },
    { ticker: 'TAO', name: 'Bittensor', yahoo: 'TAO22974-USD' },
    { ticker: 'THETA', name: 'Theta Network' },
    { ticker: 'MKR', name: 'Maker' },
    { ticker: 'CRO', name: 'Cronos' },
    { ticker: 'FET', name: 'Artificial Superintelligence Alliance' },
    { ticker: 'LDO', name: 'Lido DAO' },
    { ticker: 'ALGO', name: 'Algorand' },
    { ticker: 'RUNE', name: 'THORChain' },
    { ticker: 'AAVE', name: 'Aave' },
    { ticker: 'BSV', name: 'Bitcoin SV' },
];

const BY_TICKER = new Map(CRYPTO_ASSETS.map((c) => [c.ticker, c]));

/** Tickers do universo — a lista que o sync semeia. */
export const CRYPTO_TICKERS = CRYPTO_ASSETS.map((c) => c.ticker);

/**
 * Este ticker é uma cripto do nosso catálogo?
 *
 * ATENÇÃO: responde sobre o TEXTO do ticker, e isso não basta sozinho. `STX` é
 * Stacks na cripto e Seagate na NASDAQ, e por meses a Seagate foi cotada como
 * cripto — o ranking exibia a ação a US$ 0,0028 em vez de US$ 849,28, porque a
 * pergunta "isso é cripto?" foi feita ao texto e não ao ativo. Quem conhece o
 * `type` do ativo deve decidir por ele e usar `cryptoYahooSymbol` direto; esta
 * função é o palpite de último recurso, para quando o tipo não veio.
 */
export const isKnownCryptoTicker = (ticker) => BY_TICKER.has(String(ticker || '').trim().toUpperCase());

/**
 * Símbolo do provedor para uma cripto do catálogo. `null` fora do catálogo.
 * Fora dele, quem chama decide (o sufixo `-USD` continua sendo o palpite certo
 * para sigla não disputada).
 */
export const cryptoYahooSymbol = (ticker) => {
    const entry = BY_TICKER.get(String(ticker || '').trim().toUpperCase());
    if (!entry) return null;
    return entry.yahoo || `${entry.ticker}-USD`;
};

/** Nome de exibição do catálogo; `null` fora dele. */
export const cryptoName = (ticker) => BY_TICKER.get(String(ticker || '').trim().toUpperCase())?.name || null;

/**
 * Nome do catálogo × nome que o provedor devolveu — a assinatura do estrago.
 *
 * Enquanto o símbolo apontava para o impostor, o enriquecimento gravava o nome
 * DELE junto do preço: `TAO` ficou salvo como "Together As One USD". O nome é,
 * portanto, como se descobre qual moeda foi contaminada — e é por isso que a
 * comparação mora aqui, ao lado do catálogo, e não copiada em cada script.
 *
 * A normalização absorve só o que o provedor sempre acrescenta: o sufixo da
 * moeda ("Bittensor USD") e o parêntese de renomeação ("Polygon (prev. MATIC)").
 * Depois disso a igualdade é EXATA, e a exatidão é o ponto: com tolerância de
 * substring, "ARbit" passava por "Arbitrum" — o impostor tinha nome contido no
 * do token certo e a moeda mais visivelmente errada da lista (208× de diferença
 * no preço) saía como saudável.
 */
const compactar = (s) => String(s || '')
    .replace(/\([^)]*\)/g, ' ')      // "(prev. MATIC)" — renomeação anotada pelo provedor
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * O sufixo da moeda de cotação sai SÓ do lado do provedor — é ele que o
 * acrescenta ("Bittensor USD"), o catálogo não. Tirar dos dois lados quebra
 * justamente a moeda cujo nome termina em USD: "First Digital USD" virava
 * "First Digital" no catálogo e "First Digital USD" no provedor, e uma moeda
 * saudável aparecia como contaminada.
 */
const semSufixoDeMoeda = (s) => String(s || '').replace(/\([^)]*\)/g, ' ').replace(/\s+USD\s*$/i, '');

export const cryptoNameMatches = (ticker, providerName) => {
    const declarado = compactar(cryptoName(ticker));
    const recebido = compactar(semSufixoDeMoeda(providerName));
    return !!declarado && !!recebido && declarado === recebido;
};
