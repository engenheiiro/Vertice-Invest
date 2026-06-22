
import { getMacroSector } from '../config/sectorTaxonomy.js';
import { isGoldTicker } from './goldClassification.js';

// ---------------------------------------------------------------------------
// Classificação de SUB-TIPO de ativos do Exterior (STOCK_US).
//
// O Exterior é ramificado em STOCK | ETF | REIT | DOLLAR para que tanto a
// Carteira Ideal (sub-metas) quanto o Research (sub-filtros) consigam separar
// renda variável de papéis imobiliários, fundos de índice e exposição cambial.
//
// A heurística é deliberadamente conservadora: na dúvida, classifica como STOCK
// (o balde padrão). O usuário pode sempre sobrescrever manualmente (usSubType +
// usSubTypeManual), e nesse caso a heurística NÃO deve ser reaplicada.
// ---------------------------------------------------------------------------

// ETFs internacionais conhecidos (base do ticker, sem sufixo). Lista enxuta dos
// mais comuns nas carteiras BR; ampliar conforme necessário. Não pretende ser
// exaustiva — o objetivo é cobrir o grosso e deixar o resto para ajuste manual.
export const KNOWN_US_ETFS = new Set([
  // Amplos / mercado total
  'VOO', 'IVV', 'SPY', 'VTI', 'VT', 'QQQ', 'QQQM', 'DIA', 'IWM', 'VXUS', 'VEA', 'VWO', 'EFA', 'EEM',
  // Dividendos / fatores
  'SCHD', 'VYM', 'DGRO', 'NOBL', 'VIG', 'HDV', 'SPHD', 'JEPI', 'JEPQ', 'DVY',
  // Renda fixa / bonds
  'BND', 'AGG', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'TIP', 'BNDX',
  // Setoriais / temáticos
  'VGT', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLC', 'SMH', 'SOXX', 'ARKK',
  // Prata / outras commodities (ouro tem sub-tipo próprio GOLD, ver isGoldTicker)
  'SLV',
  // REIT ETFs (tratados como ETF, não REIT individual)
  'VNQ', 'SCHH', 'IYR', 'VNQI', 'XLRE',
]);

// Tickers/símbolos que representam exposição direta ao dólar (caixa em USD).
const DOLLAR_SYMBOLS = new Set(['USD', 'USDBRL', 'USD=X', 'DXY', 'DOLLAR', 'DOLAR']);

const base = (ticker) => String(ticker || '').trim().toUpperCase().replace(/[.\-=].*$/, '').replace(/\d+$/, '');
const raw = (ticker) => String(ticker || '').trim().toUpperCase();

/**
 * Decide o sub-tipo de um ativo do Exterior.
 *
 * @param {{ ticker?: string, sector?: string, type?: string, currency?: string, name?: string }} asset
 * @returns {'STOCK'|'ETF'|'REIT'|'DOLLAR'|'GOLD'}
 */
export function classifyUsAsset(asset = {}) {
  const { ticker = '', sector = '', type = '', currency = '', name = '' } = asset;

  // 1. DÓLAR — caixa/saldo em USD ou símbolo cambial explícito.
  if (type === 'CASH' && String(currency).toUpperCase() === 'USD') return 'DOLLAR';
  if (DOLLAR_SYMBOLS.has(raw(ticker)) || DOLLAR_SYMBOLS.has(base(ticker))) return 'DOLLAR';

  // 2. OURO — instrumentos de ouro (GLD, IAU, …) têm sub-tipo próprio (antes de ETF).
  // Apenas por ticker: evita rotular mineradoras de ouro (ações) como "ouro".
  if (isGoldTicker(ticker)) return 'GOLD';

  // 3. ETF — allowlist de fundos de índice conhecidos ou nome com "ETF".
  if (KNOWN_US_ETFS.has(base(ticker)) || KNOWN_US_ETFS.has(raw(ticker))) return 'ETF';
  if (/\betf\b/i.test(name)) return 'ETF';

  // 3. REIT — setor mapeia para imobiliário ou nome/setor contém "REIT".
  const nm = `${name} ${sector}`;
  if (/\breit\b/i.test(nm)) return 'REIT';
  if (getMacroSector(sector) === 'REAL_ESTATE') return 'REIT';

  // 4. Default — ação individual.
  return 'STOCK';
}
