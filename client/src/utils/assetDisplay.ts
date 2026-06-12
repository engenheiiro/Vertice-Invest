import type { AssetType } from '../contexts/WalletContext';
import { getB3SectorFallback } from '../data/b3Sectors';

/** Setores genéricos que não agregam informação na 2ª linha. */
const GENERIC_SECTORS = new Set(['OUTROS', 'OUTRO', 'N/A', 'GERAL', '']);

/** Rótulo amigável por tipo, usado quando não há nome real nem setor útil. */
const TYPE_FALLBACK: Record<string, string> = {
  STOCK: 'Ação',
  FII: 'FII',
  STOCK_US: 'Stock US',
  CRYPTO: 'Criptoativo',
  FIXED_INCOME: 'Renda Fixa',
  CASH: 'Caixa / Reserva',
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

  // 3. Rótulo por tipo
  return TYPE_FALLBACK[String(asset.type)] || 'Ativo';
}
