/**
 * Universo curado de ETFs NACIONAIS (B3, negociados em BRL) para a classe `ETF`.
 *
 * Espelha o papel do `usEtfList.js` (ETFs internacionais, USD): semeia os ETFs
 * brasileiros mais líquidos como `MarketAsset` `{ type: 'ETF', currency: 'BRL' }`
 * para que (a) holdings da carteira tenham nome/setor/preço mantidos como Ações/FIIs
 * e (b) o ranking de ETFs do Research tenha um universo nacional.
 *
 * Cotações vêm do Yahoo via `getQuotes` (o ticker B3 recebe `.SA` por regex). O
 * `sector` aqui é o TEMA/índice do ETF (usado no agrupamento por setor da UI).
 * Lista enxuta dos veículos mais comuns; ampliar conforme uso.
 *
 * SEM YIELD SEMEADO À MÃO (29/08/2026). Até esta data três entradas carregavam um
 * `seedYield` curado (BOVA11 4,5% · DIVO11 6,0% · SMAL11 2,0%), usado como fallback
 * final quando nenhuma fonte viva devolvia `dy` — e o Yahoo nunca devolve provento de
 * fundo em ticker `.SA`, então o fallback era, na prática, a ÚNICA fonte. A premissa
 * era falsa: os três são ETFs de ACUMULAÇÃO. Reinvestem no próprio patrimônio os
 * proventos das empresas da carteira, e o retorno aparece na valorização da cota — o
 * cotista não recebe nada. (DIVO11 segue o IDIV em versão total return; quem distribui
 * é o DIVD11, que não está nesta lista.)
 *
 * O estrago era visível: a carteira projetava R$ 4,53/mês de renda em 7 cotas de
 * BOVA11 — 39% da "Média Mensal Est." de uma carteira real — de um ativo que o razão
 * de proventos é estruturalmente incapaz de creditar, porque não existe evento nenhum
 * para creditar. O ranking ainda somava +12 DEFENSIVE por "ETF de Renda (DY 4,5%)".
 *
 * Todo ETF desta lista é de acumulação, então `dy` vem só de fonte viva e fica 0 — que
 * é o valor CORRETO, não um dado faltando. Se um distribuidor real entrar na lista
 * (DIVD11 e afins), o caminho honesto é alimentar `DividendEvent` com os pagamentos e
 * deixar o TTM medir o yield (fallback vivo em `usStocksFundamentalsService`); um
 * número mantido à mão que nenhum razão corrobora reintroduz exatamente este defeito.
 */
export const BR_ETF_LIST = [
  // --- Índice amplo (Ibovespa / Brasil) ---
  { ticker: 'BOVA11', name: 'iShares Ibovespa (BOVA11)', sector: 'Índice Amplo' },
  { ticker: 'BOVV11', name: 'It Now Ibovespa (BOVV11)', sector: 'Índice Amplo' },
  { ticker: 'BOVB11', name: 'Bradesco Ibovespa (BOVB11)', sector: 'Índice Amplo' },
  { ticker: 'BRAX11', name: 'iShares Brasil (IBrX-100)', sector: 'Índice Amplo' },
  { ticker: 'SMAL11', name: 'iShares Small Cap (SMAL11)', sector: 'Small Caps' },
  { ticker: 'DIVO11', name: 'It Now IDIV Dividendos (DIVO11)', sector: 'Dividendos' },
  { ticker: 'GOVE11', name: 'It Now Governança (GOVE11)', sector: 'Governança' },
  { ticker: 'ECOO11', name: 'It Now Carbono Eficiente (ECOO11)', sector: 'ESG' },
  { ticker: 'ISUS11', name: 'It Now ISE Sustentabilidade (ISUS11)', sector: 'ESG' },

  // --- Setoriais ---
  { ticker: 'FIND11', name: 'It Now Financeiro (FIND11)', sector: 'Financeiro' },
  { ticker: 'MATB11', name: 'It Now Materiais Básicos (MATB11)', sector: 'Materiais Básicos' },

  // --- Exterior (índices globais via B3, em BRL) ---
  // `allocationClass` descreve a EXPOSIÇÃO econômica, sem mudar o veículo (ETF)
  // nem a moeda de negociação (BRL). Assim estes ativos contam em Exterior na
  // carteira, mas continuam cotados, transacionados e tributados como ETFs da B3.
  { ticker: 'IVVB11', name: 'iShares S&P 500 (IVVB11)', sector: 'Exterior (S&P 500)', allocationClass: 'STOCK_US' },
  { ticker: 'SPXI11', name: 'It Now S&P 500 (SPXI11)', sector: 'Exterior (S&P 500)', allocationClass: 'STOCK_US' },
  { ticker: 'NASD11', name: 'Nasdaq-100 (NASD11)', sector: 'Exterior (Tecnologia)', allocationClass: 'STOCK_US' },
  { ticker: 'WRLD11', name: 'MSCI World (WRLD11)', sector: 'Exterior (Global)', allocationClass: 'STOCK_US' },
  { ticker: 'ACWI11', name: 'MSCI ACWI (ACWI11)', sector: 'Exterior (Global)', allocationClass: 'STOCK_US' },
  { ticker: 'XINA11', name: 'MSCI China (XINA11)', sector: 'Exterior (China)', allocationClass: 'STOCK_US' },
  { ticker: 'EURP11', name: 'MSCI Europa (EURP11)', sector: 'Exterior (Europa)', allocationClass: 'STOCK_US' },
  { ticker: 'BDRX11', name: 'Índice de BDRs Globais (BDRX11)', sector: 'Exterior (BDRs)', allocationClass: 'STOCK_US' },

  // --- Cripto ---
  { ticker: 'HASH11', name: 'Hashdex Nasdaq Crypto (HASH11)', sector: 'Cripto' },
  { ticker: 'BITH11', name: 'Hashdex Bitcoin (BITH11)', sector: 'Cripto' },
  { ticker: 'ETHE11', name: 'Hashdex Ethereum (ETHE11)', sector: 'Cripto' },
  { ticker: 'QBTC11', name: 'QR Bitcoin (QBTC11)', sector: 'Cripto' },

  // --- Ouro ---
  { ticker: 'GOLD11', name: 'Trend Ouro (GOLD11)', sector: 'Ouro' },

  // --- Renda fixa (ETFs de títulos públicos) ---
  // Obs.: só tickers no formato B3 padrão (XXXX##) — o resolvedor de cotação adiciona
  // o sufixo .SA por esse regex; tickers com dígitos no radical (ex. IB5M11/B5P211)
  // não resolvem e ficariam sem preço, por isso ficam de fora.
  { ticker: 'FIXA11', name: 'Renda Fixa Prefixado (FIXA11)', sector: 'Renda Fixa' },
];

/**
 * Estes ETFs reinvestem os rendimentos dos ativos da carteira na própria cota;
 * não há pagamento em dinheiro ao cotista. Centralizar a política aqui impede
 * que um ajuste de preço do provedor seja confundido com provento no dia-ex.
 * Um ETF distribuidor real deve ficar fora desta lista de acumulação.
 */
export const BR_ACCUMULATING_ETF_TICKERS = new Set(BR_ETF_LIST.map(({ ticker }) => ticker));

export const isAccumulatingBrEtf = (ticker) =>
  BR_ACCUMULATING_ETF_TICKERS.has(String(ticker || '').trim().toUpperCase().replace(/\.SA$/, ''));

export default BR_ETF_LIST;
