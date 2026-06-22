/**
 * Universo de ETFs / REITs / Ouro do Exterior para o Research.
 *
 * O `sp500List.js` cobre só ações individuais. Para o ranking de Exterior cobrir
 * também ETFs amplos/setoriais, REITs e ouro (com caminhos de score dedicados no
 * scoringEngine), semeamos esta lista curada como MarketAssets `STOCK_US`. O
 * `usSubType` aqui é só uma DICA inicial — a heurística `classifyUsAsset` no
 * syncService reclassifica/confirma (ouro vence ETF, etc.).
 *
 * Lista enxuta dos veículos mais comuns para investidor BR; ampliar conforme uso.
 */
export const US_ETF_LIST = [
  // --- ETFs amplos / mercado total ---
  { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'IVV', name: 'iShares Core S&P 500 ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'VT', name: 'Vanguard Total World Stock ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'VXUS', name: 'Vanguard Total International Stock ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF', sector: 'ETF', usSubType: 'ETF' },

  // --- ETFs de dividendos / fatores ---
  { ticker: 'SCHD', name: 'Schwab US Dividend Equity ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'VYM', name: 'Vanguard High Dividend Yield ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'DGRO', name: 'iShares Core Dividend Growth ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'JEPI', name: 'JPMorgan Equity Premium Income ETF', sector: 'ETF', usSubType: 'ETF' },

  // --- ETFs de renda fixa ---
  { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'AGG', name: 'iShares Core US Aggregate Bond ETF', sector: 'ETF', usSubType: 'ETF' },
  { ticker: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', sector: 'ETF', usSubType: 'ETF' },

  // --- ETFs setoriais / temáticos ---
  { ticker: 'VGT', name: 'Vanguard Information Technology ETF', sector: 'Technology', usSubType: 'ETF' },
  { ticker: 'XLK', name: 'Technology Select Sector SPDR Fund', sector: 'Technology', usSubType: 'ETF' },
  { ticker: 'XLF', name: 'Financial Select Sector SPDR Fund', sector: 'Financials', usSubType: 'ETF' },
  { ticker: 'XLE', name: 'Energy Select Sector SPDR Fund', sector: 'Energy', usSubType: 'ETF' },
  { ticker: 'XLV', name: 'Health Care Select Sector SPDR Fund', sector: 'Healthcare', usSubType: 'ETF' },
  { ticker: 'SMH', name: 'VanEck Semiconductor ETF', sector: 'Technology', usSubType: 'ETF' },

  // --- REIT ETFs (cestas imobiliárias) ---
  { ticker: 'VNQ', name: 'Vanguard Real Estate ETF', sector: 'Real Estate', usSubType: 'ETF' },
  { ticker: 'SCHH', name: 'Schwab US REIT ETF', sector: 'Real Estate', usSubType: 'ETF' },
  { ticker: 'XLRE', name: 'Real Estate Select Sector SPDR Fund', sector: 'Real Estate', usSubType: 'ETF' },

  // --- REITs individuais (imobiliário US) ---
  { ticker: 'O', name: 'Realty Income Corporation', sector: 'Real Estate', usSubType: 'REIT' },
  { ticker: 'PLD', name: 'Prologis Inc.', sector: 'Real Estate', usSubType: 'REIT' },
  { ticker: 'AMT', name: 'American Tower Corporation', sector: 'Real Estate', usSubType: 'REIT' },
  { ticker: 'SPG', name: 'Simon Property Group Inc.', sector: 'Real Estate', usSubType: 'REIT' },
  { ticker: 'EQIX', name: 'Equinix Inc.', sector: 'Real Estate', usSubType: 'REIT' },

  // --- Ouro (ETFs lastreados em ouro) ---
  { ticker: 'GLD', name: 'SPDR Gold Shares', sector: 'Commodities', usSubType: 'GOLD' },
  { ticker: 'IAU', name: 'iShares Gold Trust', sector: 'Commodities', usSubType: 'GOLD' },
  { ticker: 'GLDM', name: 'SPDR Gold MiniShares Trust', sector: 'Commodities', usSubType: 'GOLD' },
];

export default US_ETF_LIST;
