import type { Asset } from '../contexts/WalletContext';

// ---------------------------------------------------------------------------
// Alocação da carteira POR SETOR, dentro de uma classe.
//
// O balde não é escolhido por estética: é a MESMA chave de concentração que o
// backend usa para medir risco sistêmico (server/config/sectorTaxonomy.js).
//
//  • FII   → segmento fino (shopping, logística, papel…). Cada segmento carrega
//            risco próprio — inquilino, vacância, crédito CRI, ciclo agro — então
//            colapsá-los em "Imobiliário" esconderia justamente o que importa.
//  • AÇÃO  → macro-setor. Aqui é o inverso: bancos e seguros sobem e caem juntos,
//            e separá-los faria uma carteira concentrada parecer diversificada.
//            ETFs nacionais não são um setor — ganham balde próprio.
//
// O `sector` chega do Fundamentus/Yahoo via MarketAsset e é devolvido pelo
// walletController junto de cada posição.
// ---------------------------------------------------------------------------

// Paleta categórica validada (scripts/validate_palette.js do skill dataviz) contra
// as superfícies dos DOIS temas: banda de luminosidade, piso de croma, separação
// para daltonismo (pior par adjacente ΔE 8.1) e contraste ≥ 3:1 passam em ambos.
// A ORDEM é o mecanismo de segurança — as fatias são desenhadas nesta sequência,
// então os pares vizinhos do donut são exatamente os pares validados. Não cicle a
// paleta nem gere um 7º tom: a cauda dobra no balde cinza.
export const SECTOR_COLORS = ['#059669', '#3B82F6', '#D97706', '#8B5CF6', '#0891B2', '#EC4899'];
export const SECTOR_MUTED_COLOR = '#64748B';

/** Máximo de fatias: acima de ~6 setores o donut deixa de ser legível. */
export const MAX_SECTOR_SLICES = 6;

export const UNKNOWN_SECTOR_LABEL = 'Não classificado';
export const ETF_SECTOR_LABEL = 'ETFs / Índices';

const normalize = (s: string): string =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

// --- FIIs: segmento fino (espelha FII_SEGMENT_CANON, mapeado para rótulo) -----

const FII_SEGMENT_LABELS: Record<string, string> = {
    'shoppings': 'Shoppings',
    'shopping': 'Shoppings',
    'logistica': 'Logística',
    'imoveis industriais e logisticos': 'Logística',
    'lajes corporativas': 'Lajes Corporativas',
    'lajes': 'Lajes Corporativas',
    'escritorios': 'Lajes Corporativas',
    'renda urbana': 'Renda Urbana',
    'agencias de bancos': 'Renda Urbana',
    'varejo': 'Renda Urbana',
    'hoteis': 'Hotéis',
    'hotel': 'Hotéis',
    'hibrido': 'Híbrido',
    'papel': 'Papel (CRI)',
    'titulos e val. mob.': 'Papel (CRI)',
    'recebiveis': 'Papel (CRI)',
    'fundo de fundos': 'Fundo de Fundos',
    'multiestrategia': 'Multiestratégia',
    'fiagro': 'Fiagro',
    'infraestrutura': 'Infraestrutura',
    'desenvolvimento': 'Desenvolvimento',
    'residencial': 'Residencial',
    'imobiliario': 'Imóveis (Renda)',
    'exploracao de imoveis': 'Imóveis (Renda)',
    'hospital': 'Saúde',
    'saude': 'Saúde',
};

/** Rótulo do segmento de um FII; vazio/ausente vira "Não classificado". */
export const fiiSectorLabel = (sector?: string | null): string => {
    const n = normalize(sector || '');
    if (!n) return UNKNOWN_SECTOR_LABEL;
    if (FII_SEGMENT_LABELS[n]) return FII_SEGMENT_LABELS[n];
    // Segmento fora do canon: preserva o texto do Fundamentus, igual ao backend —
    // um segmento novo não some dentro de "Outros".
    return (sector || '').trim();
};

// --- Ações: macro-setor (espelha MACRO_SECTORS + US_SECTOR_MAP) ---------------

const MACRO_LABELS: Record<string, string> = {
    FINANCEIRO: 'Financeiro',
    UTILITIES: 'Utilidade Pública',
    COMMODITIES: 'Commodities',
    REAL_ESTATE: 'Imobiliário',
    CONSUMO: 'Consumo',
    INDUSTRIAL: 'Industrial',
    TECNOLOGIA: 'Tecnologia',
    SAUDE: 'Saúde',
};

// O casamento é por substring, então a ORDEM decide os empates — os baldes com
// termos mais específicos vêm antes dos genéricos:
//   • COMMODITIES antes de UTILITIES: "Petróleo, Gás e Biocombustíveis" contém
//     "gás" e cairia em Utilidade Pública (PETR4 rotulada como elétrica);
//   • INDUSTRIAL por último: seu termo "serviços" engoliria "Serviços Médico -
//     Hospitalares" e "Programas e Serviços".
const MACRO_SECTORS: Record<string, string[]> = {
    FINANCEIRO: ['bancos', 'seguros', 'holdings financeiras', 'financeiro', 'servicos financeiros diversos', 'previdencia e seguros'],
    COMMODITIES: ['mineracao', 'petroleo', 'gas e biocombustiveis', 'siderurgia', 'papel e celulose', 'agro', 'agropecuaria', 'quimica', 'quimicos', 'materiais basicos'],
    UTILITIES: ['eletricas', 'energia eletrica', 'saneamento', 'agua e saneamento', 'gas', 'utilidade publica'],
    REAL_ESTATE: ['construcao civil', 'exploracao de imoveis', 'imobiliario'],
    CONSUMO: ['varejo', 'alimentos', 'bebidas', 'consumo ciclico', 'tecidos, vestuario e calcados', 'comercio', 'educacao'],
    SAUDE: ['saude', 'medicamentos e outros produtos', 'servicos medico - hospitalares', 'analises e diagnosticos'],
    TECNOLOGIA: ['tecnologia', 'computadores e equipamentos', 'programas e servicos', 'telecom', 'telecomunicacoes', 'midia'],
    INDUSTRIAL: ['industria', 'bens industriais', 'maquinas e equipamentos', 'transporte', 'material de transporte', 'servicos'],
};

// Setores em inglês (Yahoo/GICS) — ETFs e ativos sincronizados pela fonte americana
// chegam com o rótulo original.
const US_SECTOR_MAP: Record<string, string> = {
    'technology': 'TECNOLOGIA',
    'information technology': 'TECNOLOGIA',
    'communication services': 'TECNOLOGIA',
    'healthcare': 'SAUDE',
    'health care': 'SAUDE',
    'financials': 'FINANCEIRO',
    'financial services': 'FINANCEIRO',
    'consumer discretionary': 'CONSUMO',
    'consumer staples': 'CONSUMO',
    'consumer cyclical': 'CONSUMO',
    'consumer defensive': 'CONSUMO',
    'energy': 'COMMODITIES',
    'materials': 'COMMODITIES',
    'basic materials': 'COMMODITIES',
    'industrials': 'INDUSTRIAL',
    'real estate': 'REAL_ESTATE',
    'utilities': 'UTILITIES',
};

/**
 * Macro-setor de uma ação. Segue a mesma ordem de decisão do getMacroSector do
 * backend (setor em inglês → desambiguação de "Papel" → listas BR), e devolve
 * "Não classificado" quando não há setor reconhecível — em vez de um balde
 * "Outros" que se confundiria com a dobra da cauda.
 */
export const stockSectorLabel = (asset: Pick<Asset, 'type' | 'sector'>): string => {
    // Um ETF de índice amplo não pertence a setor nenhum; forçá-lo em um distorceria
    // a leitura de concentração (BOVA11 não é "Financeiro" por ter bancos dentro).
    if (asset.type === 'ETF') return ETF_SECTOR_LABEL;

    const n = normalize(asset.sector || '');
    if (!n) return UNKNOWN_SECTOR_LABEL;

    if (US_SECTOR_MAP[n]) return MACRO_LABELS[US_SECTOR_MAP[n]];
    for (const [us, macro] of Object.entries(US_SECTOR_MAP)) {
        if (n.includes(us) || us.includes(n)) return MACRO_LABELS[macro];
    }

    // "Papel" (FII de recebíveis) x "Papel e Celulose" (commodity) colidem no match parcial.
    if (n === 'papel') return MACRO_LABELS.FINANCEIRO;
    if (n === 'papel e celulose') return MACRO_LABELS.COMMODITIES;

    for (const [macro, subs] of Object.entries(MACRO_SECTORS)) {
        if (subs.some((s) => n.includes(s) || s === n)) return MACRO_LABELS[macro];
    }
    return UNKNOWN_SECTOR_LABEL;
};

// --- Agregação ---------------------------------------------------------------

export type SectorKind = 'FII' | 'STOCK';

export interface SectorSlice {
    /** Chave estável da fatia (rótulo, ou sentinela da dobra). */
    key: string;
    label: string;
    /** Saldo em BRL. */
    value: number;
    /** % dentro da classe (0–100). */
    pct: number;
    color: string;
    /** Tickers que compõem a fatia, do maior para o menor saldo. */
    tickers: string[];
}

const KIND_CONFIG: Record<SectorKind, { labelOf: (a: Asset) => string; foldLabel: string }> = {
    FII: { labelOf: (a) => fiiSectorLabel(a.sector), foldLabel: 'Outros segmentos' },
    STOCK: { labelOf: stockSectorLabel, foldLabel: 'Outros setores' },
};

/**
 * Reparte o saldo da classe por setor, do maior para o menor.
 *
 * Regras de leitura (por que não é só um groupBy):
 *  • "Não classificado" nunca disputa cor com um setor real — vai sempre por
 *    último, em cinza, para não passar por um setor de verdade;
 *  • acima de MAX_SECTOR_SLICES baldes, a cauda (mais o não classificado) dobra
 *    num balde cinza — gerar mais tons quebraria a validação da paleta.
 */
export const computeSectorAllocation = (items: Asset[], kind: SectorKind): SectorSlice[] => {
    const { labelOf, foldLabel } = KIND_CONFIG[kind];
    const buckets = new Map<string, { label: string; value: number; holdings: { ticker: string; value: number }[] }>();
    let total = 0;

    (items || []).forEach((asset) => {
        const value = Number(asset.totalValue) || 0;
        if (value <= 0) return;
        const label = labelOf(asset);
        const current = buckets.get(label) || { label, value: 0, holdings: [] };
        current.value += value;
        current.holdings.push({ ticker: asset.ticker, value });
        buckets.set(label, current);
        total += value;
    });

    if (total <= 0) return [];

    const tickersOf = (holdings: { ticker: string; value: number }[]) =>
        [...holdings].sort((a, b) => b.value - a.value).map((h) => h.ticker);

    const unknown = buckets.get(UNKNOWN_SECTOR_LABEL);
    const known = [...buckets.values()]
        .filter((b) => b.label !== UNKNOWN_SECTOR_LABEL)
        // Desempate alfabético: sem ele, dois setores com o mesmo saldo trocariam de
        // cor conforme a ordem em que a API devolveu as posições.
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'));

    const pctOf = (value: number) => (value / total) * 100;
    const slices: SectorSlice[] = [];

    const needsFold = known.length + (unknown ? 1 : 0) > MAX_SECTOR_SLICES;
    const head = needsFold ? known.slice(0, MAX_SECTOR_SLICES - 1) : known;

    head.forEach((bucket, i) => {
        slices.push({
            key: bucket.label,
            label: bucket.label,
            value: bucket.value,
            pct: pctOf(bucket.value),
            color: SECTOR_COLORS[i],
            tickers: tickersOf(bucket.holdings),
        });
    });

    if (needsFold) {
        const tail = [...known.slice(MAX_SECTOR_SLICES - 1), ...(unknown ? [unknown] : [])];
        const value = tail.reduce((acc, b) => acc + b.value, 0);
        if (value > 0) {
            slices.push({
                key: '__OTHER__',
                label: foldLabel,
                value,
                pct: pctOf(value),
                color: SECTOR_MUTED_COLOR,
                tickers: tickersOf(tail.flatMap((b) => b.holdings)),
            });
        }
    } else if (unknown) {
        slices.push({
            key: '__UNKNOWN__',
            label: UNKNOWN_SECTOR_LABEL,
            value: unknown.value,
            pct: pctOf(unknown.value),
            color: SECTOR_MUTED_COLOR,
            tickers: tickersOf(unknown.holdings),
        });
    }

    return slices;
};
