/**
 * O TICKER CANÔNICO É UM NAMESPACE GLOBAL — e ele tem um dono só: este arquivo.
 *
 * `MarketAsset.ticker` é `unique: true`. Não existe `{ ticker, type }`: o banco
 * guarda UMA linha por sigla, e a classe do ativo é um campo dela, não parte da
 * chave. Isso é deliberado — carteira, série de candles, provento e cotação
 * todos endereçam o ativo pela sigla —, mas tem um preço que ninguém estava
 * pagando conscientemente: **duas classes não podem disputar a mesma sigla.**
 *
 * E três catálogos estáticos semeiam nesse namespace sem se falar:
 *
 *   config/cryptoList.js   → CRYPTO      (50 moedas)
 *   config/sp500List.js    → STOCK_US    (S&P 500)
 *   config/usEtfList.js    → STOCK_US    (ETFs/REITs/ouro)
 *   config/brEtfList.js    → ETF         (ETFs da B3)
 *
 * Todos os três seeds usam `filter: { ticker }` + `$setOnInsert`. Quem chega
 * primeiro fica com a sigla; quem chega depois casa com a linha do outro, não
 * insere nada e **não recebe aviso nenhum** — `upsertedCount` só não sobe.
 *
 * O QUE ISSO CUSTOU (medido em produção em 16/09/2026). `STX` é Stacks no
 * catálogo de cripto e Seagate Technology no S&P 500. No banco havia UMA linha:
 * `{ ticker: 'STX', type: 'STOCK_US', name: 'Seagate Technology Holdings plc' }`.
 * A Stacks nunca teve linha própria — o seed a encontrava "já existente" e
 * desistia. Pior: como o seed de cripto empurra a moeda para a fila de cotação
 * independentemente disso, a linha da AÇÃO passava a ser cotada como MOEDA e
 * recebia o preço da Stacks:
 *
 *   02:17:2x  seed de cripto  → grava lastPrice = 0,24   (Stacks)
 *   02:17:40  refreshQuotesBatch → grava lastPrice = 771,81 (Seagate)
 *
 * Os dois caminhos escrevem na MESMA linha, cada um convicto de estar falando de
 * outro ativo, e quem escreve por último vence. O único sintoma era o juiz de
 * magnitude gritando 319888% todo run — um alarme que parece erro de fonte e é,
 * na verdade, duas identidades brigando por uma linha.
 *
 * NÃO CONFUNDIR COM O SÍMBOLO DO PROVEDOR. `config/cryptoList.js` resolve a
 * disputa do lado de FORA (qual símbolo o Yahoo entende por `ARB`), e
 * `_providerSymbol` já sabe que `STX` com `type: 'STOCK_US'` nunca vira `-USD`.
 * Isso protege a PERGUNTA. Este arquivo protege a LINHA: de nada adianta
 * perguntar pelo ativo certo se a resposta é gravada em cima do ativo errado.
 *
 * COMO USAR. `findTickerCollisions()` é puro e não toca no banco — é o que o
 * teste `tests/ticker_namespace.spec.js` trava, para que catálogo com colisão
 * não passe do commit. Em tempo de execução, o seed de cripto consulta o banco
 * (ver `syncService`) porque lá a colisão pode vir de uma linha que ninguém
 * semeou: ticker herdado, renomeado ou criado por holding de usuário.
 */
import { CRYPTO_ASSETS } from './cryptoList.js';
import { SP500_STOCKS } from './sp500List.js';
import { US_ETF_LIST } from './usEtfList.js';
import { BR_ETF_LIST } from './brEtfList.js';

/**
 * Os catálogos que SEMEIAM MarketAsset, com a classe que cada um grava.
 *
 * `source` é o nome do arquivo porque é isso que a mensagem de falha precisa
 * dizer: "quem mais acha que é dono desta sigla?" só é acionável com o caminho
 * do arquivo na mão.
 */
export const SEEDED_CATALOGS = [
    { source: 'config/cryptoList.js', type: 'CRYPTO', assets: CRYPTO_ASSETS },
    { source: 'config/sp500List.js', type: 'STOCK_US', assets: SP500_STOCKS },
    { source: 'config/usEtfList.js', type: 'STOCK_US', assets: US_ETF_LIST },
    { source: 'config/brEtfList.js', type: 'ETF', assets: BR_ETF_LIST },
];

const normalize = (ticker) => String(ticker || '').trim().toUpperCase();

/**
 * Onde cada sigla aparece: `Map<ticker, [{ source, type, name }]>`.
 */
export const buildTickerOwnership = (catalogs = SEEDED_CATALOGS) => {
    const owners = new Map();
    for (const { source, type, assets } of catalogs) {
        for (const asset of assets) {
            const ticker = normalize(asset.ticker);
            if (!ticker) continue;
            if (!owners.has(ticker)) owners.set(ticker, []);
            owners.get(ticker).push({ source, type, name: asset.name || null });
        }
    }
    return owners;
};

/**
 * As duas formas de uma sigla ter mais de um dono — e elas NÃO são o mesmo
 * problema, por isso saem separadas:
 *
 *  - `crossClass`: catálogos de CLASSES diferentes. É o defeito. O banco só
 *    comporta uma das duas, a outra some sem aviso, e a cotação de uma vaza para
 *    a linha da outra. Proibido: o teste falha.
 *  - `sameClass`: a mesma sigla repetida dentro da mesma classe (hoje os cinco
 *    REITs que moram no S&P 500 e na lista de ETFs). Não corrompe nada — os dois
 *    seeds produziriam a mesma linha —, mas é trabalho duplicado em toda
 *    varredura estática do universo, e lista que se repete é lista que vai
 *    divergir. Reportado, não proibido.
 */
export const findTickerCollisions = (catalogs = SEEDED_CATALOGS) => {
    const owners = buildTickerOwnership(catalogs);
    const crossClass = [];
    const sameClass = [];

    for (const [ticker, entries] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
        if (entries.length < 2) continue;
        const classes = new Set(entries.map((e) => e.type));
        (classes.size > 1 ? crossClass : sameClass).push({ ticker, classes: [...classes], owners: entries });
    }

    return { crossClass, sameClass, total: owners.size };
};

/**
 * Uma linha por colisão, pronta para entrar em mensagem de erro ou log.
 */
export const describeCollision = ({ ticker, owners }) =>
    `${ticker}: ${owners.map((o) => `${o.type} (${o.source}) = ${o.name || '—'}`).join(' × ')}`;
