import type { AssetType } from '../contexts/WalletContext';
import { API_URL } from '../config';

/**
 * Deriva a URL da logo de um ativo a partir do ticker + tipo.
 *
 * As imagens são servidas pelo NOSSO backend (`/api/market/logo/{ticker}?type=...`),
 * que baixa da CDN apropriada (brapi/jsDelivr/Parqet) server-to-server e cacheia no
 * MongoDB. Isso evita o bloqueio das CDNs (hotlink/referer/CORS) que ocorria ao buscar
 * direto pelo navegador em produção. `API_URL` é "" → caminho relativo (proxy do Vite
 * em dev, same-origin em prod).
 *
 * Cobertura por tipo:
 * - STOCK (B3)  → backend → icons.brapi.dev
 * - CRYPTO      → backend → cryptocurrency-icons (jsDelivr)
 * - STOCK_US    → backend → assets.parqet.com
 * - FII / FIXED_INCOME / CASH → sem logo (null) → iniciais/rótulo/cofrinho
 *
 * Nenhuma destas chamadas é bloqueante: o <AssetLogo> sempre tem fallback para
 * o avatar de iniciais caso a imagem não carregue (404 do backend) ou a URL seja null.
 */

/** Normaliza um ticker para uso em URL: maiúsculo, sem espaços/sufixos de cotação. */
export function normalizeTicker(ticker: string): string {
  return (ticker || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-USD$/i, ''); // cripto às vezes vem como BTC-USD
}

/**
 * Retorna a URL da logo ou null quando não há fonte adequada para o tipo.
 */
export function getAssetLogoUrl(ticker: string, type?: AssetType): string | null {
  const symbol = normalizeTicker(ticker);
  if (!symbol) return null;

  // URL do proxy de logos no nosso backend (cacheado no MongoDB).
  const proxy = (t: string) =>
    `${API_URL}/api/market/logo/${encodeURIComponent(symbol)}?type=${t}`;

  switch (type) {
    case 'STOCK':
      return proxy('STOCK');

    case 'FII':
      // FIIs brasileiros não têm logo em nenhum CDN público → usa iniciais.
      return null;

    case 'CRYPTO':
      return proxy('CRYPTO');

    case 'STOCK_US':
      return proxy('STOCK_US');

    case 'FIXED_INCOME':
    case 'CASH':
      return null;

    default:
      // Tipo desconhecido: tenta tratar como ação B3 (fonte mais provável neste app).
      return proxy('STOCK');
  }
}

/** Classe de cor (Tailwind) das iniciais de fallback, por tipo de ativo. */
export function getFallbackTextColor(type?: AssetType): string {
  switch (type) {
    case 'CRYPTO':
      return 'text-purple-400';
    case 'STOCK_US':
      return 'text-blue-400';
    default:
      return 'text-slate-300';
  }
}

/** Iniciais exibidas no avatar de fallback (até 2 caracteres). */
export function getAssetInitials(ticker: string): string {
  return normalizeTicker(ticker).substring(0, 2) || '?';
}

/**
 * Rótulo curto para renda fixa, derivado do nome/ticker do título.
 * Ex.: "Tesouro Renda+ 2065" → "R+"; "Tesouro Selic 2029" → "SELIC".
 * Cobre Tesouro Direto e produtos bancários (CDB, LCI, LCA, debêntures).
 */
export function getFixedIncomeLabel(name?: string, ticker?: string): string {
  const s = `${name || ''} ${ticker || ''}`.toUpperCase();

  if (/RENDA\s*\+/.test(s)) return 'R+';
  if (/EDUCA\s*\+/.test(s)) return 'E+';
  if (/IPCA/.test(s) || /NTN-?B/.test(s)) return 'IPCA+';
  if (/SELIC/.test(s) || /\bLFT\b/.test(s)) return 'SELIC';
  if (/PREFIX/.test(s) || /\bLTN\b/.test(s) || /NTN-?F/.test(s)) return 'PRÉ';
  if (/\bCDB\b/.test(s)) return 'CDB';
  if (/\bLCI\b/.test(s)) return 'LCI';
  if (/\bLCA\b/.test(s)) return 'LCA';
  if (/DEBENTURE/.test(s)) return 'DEB';
  if (/TESOURO/.test(s)) return 'TD';
  return 'RF';
}
