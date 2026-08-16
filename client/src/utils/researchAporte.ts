import type { AssetType } from '../contexts/WalletContext';

// ---------------------------------------------------------------------------
// Ponte "Aporte Inteligente (Carteira) → Research".
//
// Cada linha do aporte (classe ou sub-classe) aponta para a aba do Research que
// tem o ranking daquele universo. O valor viaja junto, já convertido para a
// MOEDA DA ABA: o aporte da carteira é sempre em BRL, mas Exterior/Cripto/ETF-US
// operam em USD — mandar BRL cru para lá inflaria o aporte em ~5x.
//
// `assetClass` usa os mesmos ids de `ASSETS` em pages/Research.tsx.
// ---------------------------------------------------------------------------

/** Estado de navegação lido pelo Research (via `location.state.aporte`). */
export interface ResearchAporteRequest {
    assetClass: string;
    exteriorView?: 'STOCK' | 'REIT';
    etfOrigin?: 'BR' | 'US';
    /** Já na moeda da aba (ver `currency`). */
    amount?: number;
    currency?: 'BRL' | 'USD';
}

export interface ResearchTarget {
    assetClass: string;
    exteriorView?: 'STOCK' | 'REIT';
    etfOrigin?: 'BR' | 'US';
    currency: 'BRL' | 'USD';
    /** Rótulo da aba de destino, usado no tooltip do link. */
    label: string;
    /** Renda Fixa é vitrine (Tesouro) — abre a aba, mas não há modal de aporte. */
    hasRanking: boolean;
}

/**
 * Aba do Research correspondente a uma linha do aporte. `sub` é a chave da
 * sub-meta (linha-filha) quando houver. Devolve null para linhas sem ranking
 * próprio (Reserva/Caixa, Dólar puro, Ouro).
 */
export function researchTargetFor(type: AssetType | string, sub?: string): ResearchTarget | null {
    switch (type) {
        case 'STOCK':
            return sub === 'ETF'
                ? { assetClass: 'ETF', etfOrigin: 'BR', currency: 'BRL', label: 'ETFs (Nacional)', hasRanking: true }
                : { assetClass: 'STOCK', currency: 'BRL', label: 'Ações BR', hasRanking: true };
        case 'FII':
            return { assetClass: 'FII', currency: 'BRL', label: 'FIIs', hasRanking: true };
        case 'STOCK_US':
            if (sub === 'ETF') return { assetClass: 'ETF', etfOrigin: 'US', currency: 'USD', label: 'ETFs (Internacional)', hasRanking: true };
            if (sub === 'REIT') return { assetClass: 'STOCK_US', exteriorView: 'REIT', currency: 'USD', label: 'Exterior · REITs', hasRanking: true };
            // Dólar puro não tem ranking — é posição em moeda, não em ativo.
            if (sub === 'DOLLAR') return null;
            return { assetClass: 'STOCK_US', exteriorView: 'STOCK', currency: 'USD', label: 'Exterior · Stocks', hasRanking: true };
        case 'CRYPTO':
            return { assetClass: 'CRYPTO', currency: 'USD', label: 'Cripto', hasRanking: true };
        case 'FIXED_INCOME':
            return { assetClass: 'FIXED_INCOME', currency: 'BRL', label: 'Renda Fixa (Tesouro)', hasRanking: false };
        // Legado: ETF deixou de ser classe de topo, mas metas antigas ainda podem trazê-lo.
        case 'ETF':
            return { assetClass: 'ETF', etfOrigin: 'BR', currency: 'BRL', label: 'ETFs (Nacional)', hasRanking: true };
        default:
            return null;
    }
}

/**
 * Converte o valor da linha (sempre BRL, vindo da carteira) para a moeda da aba
 * de destino. Sem câmbio válido, mantém o valor — melhor um número aproximado
 * que o usuário revisa do que nenhum valor.
 */
export const amountForTarget = (amountBrl: number, target: ResearchTarget, usdRate: number): number =>
    target.currency === 'USD' && usdRate > 0 ? amountBrl / usdRate : amountBrl;
