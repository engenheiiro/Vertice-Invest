import type { LucideIcon } from 'lucide-react';
import {
    BedDouble,
    Building,
    Building2,
    Cross,
    FileText,
    HardHat,
    Home,
    Layers,
    PieChart,
    ShoppingBag,
    Shuffle,
    Sprout,
    Store,
    Truck,
    Zap,
} from 'lucide-react';
import { fiiSectorLabel } from './sectorAllocation';

// ---------------------------------------------------------------------------
// Pictograma do SEGMENTO de um FII — o que aparece no chip da linha (AssetLogo).
//
// O chip do FII sempre caiu nas iniciais do ticker, porque FII brasileiro não
// tem logo em CDN nenhum (getAssetLogoUrl devolve null). E a inicial é a pior
// informação possível ali: ela nomeia a GESTORA, não a exposição. Numa carteira
// real isso colide — KNCR11 e KNSC11 viram os dois "KN"; HGCR11 (papel) e
// HGBS11 (shoppings) viram os dois "HG", dois riscos opostos com o mesmo chip.
//
// A chave do mapa é o RÓTULO devolvido por `fiiSectorLabel`, não o texto cru da
// fonte. Assim existe uma vocabulário só: `FII_SEGMENT_LABELS` continua sendo a
// única tabela que conhece os sinônimos do Fundamentus ("recebiveis", "titulos e
// val. mob." → "Papel (CRI)"), e aqui só se decide o desenho de cada rótulo.
//
// Segmento ausente, ou fora do canon (rótulo = texto cru da fonte), devolve null
// de propósito: o chip volta para as iniciais em vez de exibir um ícone genérico
// que afirmaria uma classificação que não temos.
// ---------------------------------------------------------------------------
const SEGMENT_ICONS: Record<string, LucideIcon> = {
    'Renda Urbana': Store,          // loja de rua — cobre varejo e agências bancárias
    'Papel (CRI)': FileText,        // o CRI é literalmente um documento
    'Logística': Truck,             // galpão lê mal em 17px; o fluxo lê na hora
    'Shoppings': ShoppingBag,       // sacola, não carrinho (carrinho = "comprar" no app)
    'Lajes Corporativas': Building2,
    'Fiagro': Sprout,
    'Hotéis': BedDouble,
    'Híbrido': Layers,              // tijolo E papel no mesmo fundo
    'Fundo de Fundos': PieChart,    // uma alocação dentro da sua alocação
    'Multiestratégia': Shuffle,
    'Infraestrutura': Zap,          // FI-Infra no Brasil é quase sempre energia
    'Desenvolvimento': HardHat,     // ativo que ainda não existe: risco de execução
    'Residencial': Home,
    'Saúde': Cross,
    'Imóveis (Renda)': Building,
};

/** Ícone do segmento de um FII, ou `null` quando o segmento não é reconhecido. */
export function getFiiSegmentIcon(sector?: string | null): LucideIcon | null {
    return SEGMENT_ICONS[fiiSectorLabel(sector)] || null;
}
