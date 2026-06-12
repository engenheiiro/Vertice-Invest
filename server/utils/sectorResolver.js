
import { SECTOR_OVERRIDES } from '../config/sectorOverrides.js';
import { STOCK_SECTOR_BY_BASE } from '../config/stockSectorsByBase.js';

// Setores que não agregam informação (precisam de fallback).
const GENERIC_SECTORS = new Set(['', '-', 'OUTROS', 'OUTRO', 'N/A', 'NA', 'GERAL', 'INDEFINIDO']);

/** true quando o setor é vazio/genérico e deve ser substituído por um fallback. */
export const isGenericSector = (sector) =>
    !sector || GENERIC_SECTORS.has(String(sector).trim().toUpperCase());

/** Base do ticker (letras, sem o dígito final). Ex.: "KLBN11" → "KLBN". */
export const tickerBase = (ticker) =>
    String(ticker || '').trim().toUpperCase().replace(/\d+$/, '');

/**
 * Deriva o subtipo de um FII a partir do setor.
 * (Mesma lógica usada no sync; centralizada aqui para reuso no backfill.)
 */
export const deriveFiiSubType = (sector) => {
    if (!sector) return null;
    const s = sector.toLowerCase();
    if (s.includes('papel') || s.includes('crédito') || s.includes('recebíveis') || s.includes('cri')) return 'PAPEL';
    if (s.includes('fundo de fundo') || s.includes('fof')) return 'FOF';
    if (s.includes('híbrido') || s.includes('hibrido')) return 'HIBRIDO';
    if (s.includes('desenvolvimento') || s.includes('residencial')) return 'DESENVOLVIMENTO';
    if (s.includes('fiagro')) return 'FIAGRO';
    return 'TIJOLO';
};

/**
 * Resolve o setor definitivo de um ativo, em ordem de prioridade:
 *  1. Override exato (source of truth — corrige setores errados conhecidos)
 *  2. Override por base do ticker (só AÇÕES; cobre outras classes da mesma
 *     empresa, ex.: KLBN4 herda de KLBN/KLBN11)
 *  3. Setor vindo da fonte (scraping), se for válido — relevante p/ FIIs
 *  4. Default por tipo (Renda Fixa / Caixa / Criptomoeda) ou 'Outros'
 *
 * @param {{ ticker: string, type?: string, scrapedSector?: string }} params
 * @returns {string}
 */
export function resolveSector({ ticker, type, scrapedSector }) {
    const tk = String(ticker || '').trim().toUpperCase();

    // 1. Override exato
    if (SECTOR_OVERRIDES[tk]) return SECTOR_OVERRIDES[tk];

    // 2. Override por base (apenas ações; FIIs são únicos por ticker)
    if (type === 'STOCK') {
        const byBase = STOCK_SECTOR_BY_BASE[tickerBase(tk)];
        if (byBase) return byBase;
    }

    // 3. Setor da fonte, se válido
    if (!isGenericSector(scrapedSector)) return String(scrapedSector).trim();

    // 4. Defaults por tipo
    switch (type) {
        case 'FIXED_INCOME': return 'Renda Fixa';
        case 'CASH': return 'Caixa';
        case 'CRYPTO': return 'Criptomoeda';
        default: return 'Outros';
    }
}
