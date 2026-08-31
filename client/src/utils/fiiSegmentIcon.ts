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
// Pictograma e COR do SEGMENTO de um FII — o que aparece no chip da linha (AssetLogo).
//
// O chip do FII sempre caiu nas iniciais do ticker, porque FII brasileiro não
// tem logo em CDN nenhum (getAssetLogoUrl devolve null). E a inicial é a pior
// informação possível ali: ela nomeia a GESTORA, não a exposição. Numa carteira
// real isso colide — KNCR11 e KNSC11 viram os dois "KN"; HGCR11 (papel) e
// HGBS11 (shoppings) viram os dois "HG", dois riscos opostos com o mesmo chip.
//
// A chave do mapa é o RÓTULO devolvido por `fiiSectorLabel`, não o texto cru da
// fonte. Assim existe um vocabulário só: `FII_SEGMENT_LABELS` continua sendo a
// única tabela que conhece os sinônimos do Fundamentus ("recebiveis", "titulos e
// val. mob." → "Papel (CRI)"), e aqui só se decide o desenho e o tom de cada rótulo.
//
// Segmento ausente, ou fora do canon (rótulo = texto cru da fonte), devolve null
// de propósito: o chip volta para as iniciais em vez de exibir um ícone genérico
// que afirmaria uma classificação que não temos.
//
// --- A cor -----------------------------------------------------------------
// COR = FAMÍLIA, FORMA = SEGMENTO. Quinze tons ninguém memoriza; sete famílias,
// sim. A cor responde "quem paga o aluguel deste fundo?" — laje corporativa e
// imóvel de renda dividem o mesmo azul porque quem paga é uma empresa; shopping
// e loja de rua dividem o mesmo laranja porque quem paga é o consumo. Quem lê a
// lista acha "meus FIIs de crédito" sem ler um rótulo; a distinção fina fica com
// o desenho, que já era inequívoco a 17px.
//
//   ciano   → operação física (galpão, energia): Logística, Infraestrutura
//   azul    → tijolo corporativo: Lajes, Imóveis (Renda)
//   violeta → crédito e papel: Papel (CRI), Híbrido
//   magenta → cotas de cotas: Fundo de Fundos, Multiestratégia
//   rosa    → pessoas (morar, hospedar, cuidar): Residencial, Hotéis, Saúde
//   laranja → consumo: Shoppings, Renda Urbana
//   âmbar   → terra: Fiagro    ·    pedra → obra: Desenvolvimento
//
// VERDE E VERMELHO NÃO ENTRAM. Eles são propriedade do resultado da linha
// (variação e rentabilidade), e um chip colorido ao lado de um número colorido
// só funciona enquanto as duas linguagens não se cruzam. A paleta foi medida por
// ΔE (CIE76) contra emerald-500 e red-500 nos dois temas: a pior distância é 34,6
// — bem acima do limiar de 30 que adotamos como seguro. Ao trocar um tom aqui,
// refaça essa conta antes: um "azulzinho mais vivo" pode cair no verde.
//
// A distribuição também evita amontoar famílias no mesmo arco: a primeira versão
// tinha quatro famílias entre 234° e 292° (índigo/violeta/roxo/fúcsia) e a lista
// virava um borrão lilás. Consumo foi para o quente e Desenvolvimento virou
// cimento, o que dobrou a menor distância entre famílias distintas (ΔE 10,9 → 23,0).
//
// As classes vêm escritas por extenso porque o Tailwind varre o CÓDIGO-FONTE em
// busca de nomes de classe completos: montar `bg-${tone}/10` faria o CSS sumir do
// build sem erro nenhum. Mesma razão pela qual `CLASS_ACCENT` (AssetList) também
// guarda strings literais.
// ---------------------------------------------------------------------------
export interface FiiSegmentStyle {
    icon: LucideIcon;
    /** Classes do chip: fundo tingido + borda + traço do ícone. */
    chip: string;
}

const SEGMENT_STYLES: Record<string, FiiSegmentStyle> = {
    // Operação física — ciano
    'Logística':          { icon: Truck,       chip: 'bg-cyan-400/10 border-cyan-400/30 text-cyan-400' },        // galpão lê mal em 17px; o fluxo lê na hora
    'Infraestrutura':     { icon: Zap,         chip: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-500' },        // FI-Infra no Brasil é quase sempre energia
    // Tijolo corporativo — azul
    'Lajes Corporativas': { icon: Building2,   chip: 'bg-blue-400/10 border-blue-400/30 text-blue-400' },
    'Imóveis (Renda)':    { icon: Building,    chip: 'bg-blue-500/10 border-blue-500/30 text-blue-500' },
    // Crédito e papel — violeta
    'Papel (CRI)':        { icon: FileText,    chip: 'bg-violet-400/10 border-violet-400/30 text-violet-400' },  // o CRI é literalmente um documento
    'Híbrido':            { icon: Layers,      chip: 'bg-violet-500/10 border-violet-500/30 text-violet-500' },  // tijolo E papel no mesmo fundo
    // Cotas de cotas — magenta
    'Fundo de Fundos':    { icon: PieChart,    chip: 'bg-fuchsia-400/10 border-fuchsia-400/30 text-fuchsia-400' }, // uma alocação dentro da sua alocação
    'Multiestratégia':    { icon: Shuffle,     chip: 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-500' },
    // Pessoas — rosa
    'Residencial':        { icon: Home,        chip: 'bg-pink-400/10 border-pink-400/30 text-pink-400' },
    'Hotéis':             { icon: BedDouble,   chip: 'bg-pink-500/10 border-pink-500/30 text-pink-500' },
    'Saúde':              { icon: Cross,       chip: 'bg-pink-300/10 border-pink-300/30 text-pink-300' },        // cruz clara: vermelha, mentiria sobre resultado
    // Consumo — laranja
    'Shoppings':          { icon: ShoppingBag, chip: 'bg-orange-400/10 border-orange-400/30 text-orange-400' },  // sacola, não carrinho (carrinho = "comprar" no app)
    'Renda Urbana':       { icon: Store,       chip: 'bg-orange-500/10 border-orange-500/30 text-orange-500' },  // loja de rua — cobre varejo e agências bancárias
    // Terra e obra — âmbar e pedra
    'Fiagro':             { icon: Sprout,      chip: 'bg-amber-400/10 border-amber-400/30 text-amber-400' },
    'Desenvolvimento':    { icon: HardHat,     chip: 'bg-stone-400/10 border-stone-400/30 text-stone-400' },     // o imóvel ainda não existe: cimento, sem cor própria
};

/** Ícone + tom do segmento de um FII, ou `null` quando o segmento não é reconhecido. */
export function getFiiSegmentStyle(sector?: string | null): FiiSegmentStyle | null {
    return SEGMENT_STYLES[fiiSectorLabel(sector)] || null;
}

/** Ícone do segmento de um FII, ou `null` quando o segmento não é reconhecido. */
export function getFiiSegmentIcon(sector?: string | null): LucideIcon | null {
    return getFiiSegmentStyle(sector)?.icon || null;
}
