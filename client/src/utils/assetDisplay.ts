import type { AssetType } from '../contexts/WalletContext';
import { getB3SectorFallback } from '../data/b3Sectors';

/**
 * Setores genéricos que não agregam informação na 2ª linha. 'ETF' entra aqui
 * porque o veículo já é comunicado pelo SELO ao lado do ticker (ver getAssetTags):
 * repetir "ETF" na sublinha só duplicaria a informação — os ETFs internacionais
 * do universo curado chegam com sector = 'ETF' (server/config/usEtfList.js).
 */
const GENERIC_SECTORS = new Set(['OUTROS', 'OUTRO', 'N/A', 'GERAL', 'ETF', '']);

/** Rótulo amigável por tipo, usado quando não há nome real nem setor útil. */
const TYPE_FALLBACK: Record<string, string> = {
  STOCK: 'Ação',
  FII: 'FII',
  STOCK_US: 'Ação (EUA)',
  ETF: 'Fundo de Índice',
  CRYPTO: 'Criptoativo',
  FIXED_INCOME: 'Renda Fixa',
  CASH: 'Caixa / Reserva',
};

/** Sublinha do Exterior quando o setor é genérico — deriva do sub-tipo (usSubType). */
const US_SUB_FALLBACK: Record<string, string> = {
  ETF: 'Fundo de Índice',
  REIT: 'Imobiliário (REIT)',
  GOLD: 'Ouro',
  DOLLAR: 'Dólar',
  STOCK: 'Ação (EUA)',
};

/** Tradução de setores em inglês (Yahoo, ações US) para PT-BR. */
const SECTOR_TRANSLATIONS: Record<string, string> = {
  TECHNOLOGY: 'Tecnologia',
  'INFORMATION TECHNOLOGY': 'Tecnologia',
  'COMMUNICATION SERVICES': 'Tecnologia',
  HEALTHCARE: 'Saúde',
  'HEALTH CARE': 'Saúde',
  'FINANCIAL SERVICES': 'Financeiro',
  FINANCIALS: 'Financeiro',
  'CONSUMER CYCLICAL': 'Consumo',
  'CONSUMER DISCRETIONARY': 'Consumo',
  'CONSUMER DEFENSIVE': 'Consumo',
  'CONSUMER STAPLES': 'Consumo',
  ENERGY: 'Energia',
  INDUSTRIALS: 'Indústria',
  'BASIC MATERIALS': 'Materiais Básicos',
  MATERIALS: 'Materiais Básicos',
  'REAL ESTATE': 'Imobiliário',
  UTILITIES: 'Utilidade Pública',
  CRIPTOMOEDA: 'Criptoativo',
};

/** Normaliza o nome do setor para exibição (traduz US quando aplicável). */
function translateSector(sector: string): string {
  return SECTOR_TRANSLATIONS[sector.trim().toUpperCase()] || sector.trim();
}

interface AssetLike {
  ticker: string;
  name?: string;
  sector?: string;
  type?: AssetType | string;
  allocationClass?: string | null;
  /** Sub-tipo do Exterior (STOCK_US) — define o selo e a sublinha do ativo. */
  usSubType?: 'STOCK' | 'REIT' | 'DOLLAR' | 'ETF' | 'GOLD' | null;
  /** Renda Fixa vencida (accrual congelado). */
  matured?: boolean;
  /** Renda Fixa: 'MTM' = marcada pelo PU oficial; 'ACCRUAL' = valor na curva. */
  pricingSource?: 'MTM' | 'ACCRUAL' | null;
}

/**
 * Texto da 2ª linha (sublinha) de um ativo. Decisão de produto: mostra SEMPRE o
 * setor/segmento (uniforme em todas as telas), nunca o nome — assim a lista fica
 * consistente e reforça a visão de diversificação.
 * Ordem: setor do backend → fallback de setor por ticker (ações) → rótulo do tipo.
 */
export function getAssetSubtitle(asset: AssetLike): string {
  // 1. Setor/segmento vindo do backend, quando não for genérico
  const sector = (asset.sector || '').trim();
  if (sector && !GENERIC_SECTORS.has(sector.toUpperCase())) return translateSector(sector);

  // 2. Fallback de setor por ticker (ações B3 não sincronizadas)
  if (asset.type === 'STOCK' || !asset.type) {
    const mapped = getB3SectorFallback(asset.ticker);
    if (mapped) return mapped;
  }

  // 3. Exterior sem setor útil: descreve o veículo pelo sub-tipo
  if (asset.type === 'STOCK_US' && asset.usSubType) {
    const mapped = US_SUB_FALLBACK[asset.usSubType];
    if (mapped) return mapped;
  }

  // 4. Rótulo por tipo
  return TYPE_FALLBACK[String(asset.type)] || 'Ativo';
}

// ---------------------------------------------------------------------------
// Selos (tags) do ativo — 1ª linha, ao lado do ticker.
//
// Regra única em todo o app: o VEÍCULO do ativo é sempre um selo ao lado do
// ticker (nunca texto na sublinha) e a sublinha fica reservada ao setor/segmento.
// Antes, ETF nacional ganhava selo e ETF internacional aparecia como "ETF" na
// sublinha — duas leituras diferentes para a mesma informação.
// ---------------------------------------------------------------------------

export type AssetTagTone = 'etf' | 'reit' | 'gold' | 'dollar' | 'warning' | 'neutral';

export interface AssetTag {
  label: string;
  tone: AssetTagTone;
  /** Texto do title= — explica como o ativo entra na distribuição. */
  title: string;
}

const ETF_BR_TAG: AssetTag = {
  label: 'ETF',
  tone: 'etf',
  title: 'ETF nacional — conta dentro de Ações BR na distribuição.',
};

const ETF_B3_EXTERIOR_TAG: AssetTag = {
  label: 'ETF',
  tone: 'etf',
  title: 'ETF negociado na B3 com exposição internacional — conta dentro de Exterior na distribuição.',
};

/** Selo por sub-tipo do Exterior. STOCK (ação individual) não recebe selo. */
const US_SUB_TAG: Record<string, AssetTag> = {
  ETF: { label: 'ETF', tone: 'etf', title: 'ETF internacional — conta dentro de Exterior (sub-tipo ETF) na distribuição.' },
  REIT: { label: 'REIT', tone: 'reit', title: 'REIT — imobiliário dos EUA; conta dentro de Exterior (sub-tipo REIT).' },
  GOLD: { label: 'Ouro', tone: 'gold', title: 'Ouro lastreado (ETF) — conta dentro de Exterior, sub-tipo ETF.' },
  DOLLAR: { label: 'Dólar', tone: 'dollar', title: 'Exposição em dólar — conta dentro de Exterior, sub-tipo Dólar.' },
};

const MATURED_TAG: AssetTag = {
  label: 'Vencido',
  tone: 'warning',
  title: 'Título vencido — parou de render. Considere resgatar (nada é vendido automaticamente).',
};

/**
 * Como a renda fixa foi precificada. Só aparece em FIXED_INCOME: reserva/caixa é
 * evidentemente na curva, e um selo ali seria só ruído.
 *
 * O selo existe porque os dois valores respondem a perguntas diferentes:
 * "Mercado" é quanto a posição vale se for vendida hoje; "Na curva" é quanto ela
 * vale se for levada até o vencimento. Num Tesouro IPCA+ longo os dois números
 * chegam a divergir dois dígitos, e mostrar um sem dizer qual é seria enganoso.
 */
const MARKED_TAG: AssetTag = {
  label: 'Mercado',
  tone: 'etf',
  title: 'Marcado a mercado pelo PU oficial do Tesouro Direto — é o valor de resgate hoje. O valor na curva (até o vencimento) aparece abaixo do total.',
};

const ON_CURVE_TAG: AssetTag = {
  label: 'Na curva',
  tone: 'neutral',
  title: 'Valor na curva: rende a taxa contratada dia a dia. Não é marcado a mercado — ou o título não tem preço público (CDB/LCI/LCA), ou paga cupom semestral, ou a série oficial não cobre a posição.',
};

/** Selos de um ativo, na ordem de exibição (veículo primeiro, estado depois). */
export function getAssetTags(asset: AssetLike): AssetTag[] {
  const tags: AssetTag[] = [];

  if (asset.type === 'ETF') {
    tags.push(asset.allocationClass === 'STOCK_US' ? ETF_B3_EXTERIOR_TAG : ETF_BR_TAG);
  }
  else if (asset.type === 'STOCK_US' && asset.usSubType && US_SUB_TAG[asset.usSubType]) {
    tags.push(US_SUB_TAG[asset.usSubType]);
  }

  if (asset.type === 'FIXED_INCOME' && asset.pricingSource) {
    tags.push(asset.pricingSource === 'MTM' ? MARKED_TAG : ON_CURVE_TAG);
  }

  if (asset.matured) tags.push(MATURED_TAG);

  return tags;
}
