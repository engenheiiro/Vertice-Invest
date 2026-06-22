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
 * `seedYield` (opcional): dividend yield aproximado (% a.a.) usado SÓ como fallback
 * final para os poucos ETFs que DISTRIBUEM proventos, quando nenhuma fonte viva
 * fornece o dado. Motivo: o Yahoo não devolve yield de fundo p/ tickers `.SA` e a
 * Brapi cobra os dados de dividendos (403 no plano atual). A maioria dos ETFs BR
 * é de ACUMULAÇÃO (IVVB11/NASD11/…) → sem `seedYield` → dy=0 (correto). Valor
 * estático e documentado (revisar ~semestralmente vs. relatório da gestora/B3);
 * a fonte viva (quando existir) SEMPRE tem precedência sobre este seed.
 *   Refs (jun/2026, aprox.): DIVO11 (IDIV) ~6% · BOVA11 (Ibov) ~4,5% · SMAL11 ~2%.
 */
export const BR_ETF_LIST = [
  // --- Índice amplo (Ibovespa / Brasil) ---
  { ticker: 'BOVA11', name: 'iShares Ibovespa (BOVA11)', sector: 'Índice Amplo', seedYield: 4.5 },
  { ticker: 'BOVV11', name: 'It Now Ibovespa (BOVV11)', sector: 'Índice Amplo' },
  { ticker: 'BOVB11', name: 'Bradesco Ibovespa (BOVB11)', sector: 'Índice Amplo' },
  { ticker: 'BRAX11', name: 'iShares Brasil (IBrX-100)', sector: 'Índice Amplo' },
  { ticker: 'SMAL11', name: 'iShares Small Cap (SMAL11)', sector: 'Small Caps', seedYield: 2.0 },
  { ticker: 'DIVO11', name: 'It Now IDIV Dividendos (DIVO11)', sector: 'Dividendos', seedYield: 6.0 },
  { ticker: 'GOVE11', name: 'It Now Governança (GOVE11)', sector: 'Governança' },
  { ticker: 'ECOO11', name: 'It Now Carbono Eficiente (ECOO11)', sector: 'ESG' },
  { ticker: 'ISUS11', name: 'It Now ISE Sustentabilidade (ISUS11)', sector: 'ESG' },

  // --- Setoriais ---
  { ticker: 'FIND11', name: 'It Now Financeiro (FIND11)', sector: 'Financeiro' },
  { ticker: 'MATB11', name: 'It Now Materiais Básicos (MATB11)', sector: 'Materiais Básicos' },

  // --- Exterior (índices globais via B3, em BRL) ---
  { ticker: 'IVVB11', name: 'iShares S&P 500 (IVVB11)', sector: 'Exterior (S&P 500)' },
  { ticker: 'SPXI11', name: 'It Now S&P 500 (SPXI11)', sector: 'Exterior (S&P 500)' },
  { ticker: 'NASD11', name: 'Nasdaq-100 (NASD11)', sector: 'Exterior (Tecnologia)' },
  { ticker: 'WRLD11', name: 'MSCI World (WRLD11)', sector: 'Exterior (Global)' },
  { ticker: 'ACWI11', name: 'MSCI ACWI (ACWI11)', sector: 'Exterior (Global)' },
  { ticker: 'XINA11', name: 'MSCI China (XINA11)', sector: 'Exterior (China)' },
  { ticker: 'EURP11', name: 'MSCI Europa (EURP11)', sector: 'Exterior (Europa)' },
  { ticker: 'BDRX11', name: 'Índice de BDRs Globais (BDRX11)', sector: 'Exterior (BDRs)' },

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

export default BR_ETF_LIST;
