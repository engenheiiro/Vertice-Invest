import type { Asset } from '../contexts/WalletContext';
import { getB3SectorFallback } from '../data/b3Sectors';
import { FIXED_INCOME_SUB_LABELS, allocationBucket, fixedIncomeSubKey } from './allocation';

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
// Fora da Carteira existe um terceiro balde: o SUBSETOR da ação, usado nas listas
// de seleção, onde a leitura é reconhecer o ativo e não medir risco sistêmico
// (ver stockSubsectorLabel).
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

/**
 * Entrada mínima para rotular uma linha: só o setor (e o tipo, que distingue ETF).
 * É um subconjunto de Asset para que a MESMA régua sirva a linhas que ainda
 * não são posições — um item de ranking, por exemplo, não tem saldo.
 */
export type SectorLabelInput = Pick<Asset, 'sector'>
    & Partial<Pick<Asset, 'ticker' | 'type' | 'fixedIncomeIndex' | 'fixedIncomeRate'>>;

const normalize = (s: string): string =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

/**
 * Setores que o backend grava quando NÃO sabe o setor. Deixá-los passar como
 * rótulo criaria uma fatia "Outros" que se confunde com a dobra da cauda.
 */
const GENERIC_SECTORS = new Set(['outros', 'outro', 'n/a', 'geral']);

/**
 * Setor efetivo de uma linha — o texto sobre o qual TODA régua desta casa decide.
 *
 * O fallback por ticker (ações da B3 que o backend ainda não sincronizou) é
 * aplicado AQUI, e não na sublinha da tela, porque rótulo e agregação leem deste
 * mesmo ponto. Enquanto o fallback vivia só na sublinha, a mesma posição aparecia
 * como "Bancos" na linha e caía em "Não classificado" no donut ao lado — um ativo,
 * duas verdades na mesma tela.
 */
const resolveSector = (item: SectorLabelInput): string => {
    const raw = (item.sector || '').trim();
    if (raw && !GENERIC_SECTORS.has(normalize(raw))) return raw;
    // Só ação da B3 tem tabela de fallback; FII e Exterior não entram aqui.
    if (item.type === 'STOCK' || !item.type) return getB3SectorFallback(item.ticker || '') || '';
    return '';
};

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
    FINANCEIRO: ['bancos', 'seguros', 'holdings financeiras', 'holdings diversificadas', 'financeiro', 'servicos financeiros diversos', 'previdencia e seguros'],
    COMMODITIES: ['mineracao', 'petroleo', 'gas e biocombustiveis', 'siderurgia', 'papel e celulose', 'agro', 'agropecuaria', 'quimica', 'quimicos', 'materiais basicos'],
    UTILITIES: ['eletricas', 'energia eletrica', 'saneamento', 'agua e saneamento', 'gas', 'utilidade publica'],
    REAL_ESTATE: ['construcao civil', 'exploracao de imoveis', 'imobiliario', 'shoppings', 'cemiterios'],
    CONSUMO: ['varejo', 'alimentos', 'bebidas', 'consumo ciclico', 'tecidos, vestuario e calcados', 'comercio', 'educacao', 'utilidades domesticas', 'produtos de limpeza', 'hotelaria'],
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
export const stockSectorLabel = (asset: SectorLabelInput): string => {
    // Um ETF de índice amplo não pertence a setor nenhum; forçá-lo em um distorceria
    // a leitura de concentração (BOVA11 não é "Financeiro" por ter bancos dentro).
    if (asset.type === 'ETF') return ETF_SECTOR_LABEL;

    const n = normalize(resolveSector(asset));
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

// --- Ações: subsetor (granularidade do próprio ativo) ------------------------

/**
 * Rótulos de exibição do SUBSETOR de uma ação — a granularidade em que o ativo
 * foi cadastrado (`resolveSector` no servidor), sem colapsar no macro-setor.
 *
 * Existe porque as duas leituras respondem perguntas diferentes. Na Carteira o
 * que importa é risco sistêmico: banco e seguradora sobem e caem juntos, então
 * somá-los em "Financeiro" é a leitura CORRETA de concentração. Numa lista de
 * seleção, não: quem lê quer reconhecer o ativo que está vendo, e uma CPFL
 * rotulada "Utilidade Pública" (junto do saneamento) ou uma operadora de telefonia
 * rotulada "Tecnologia" contradiz o próprio cartão ao lado, que diz "Elétricas".
 *
 * A tabela só CANONIZA: expande abreviação ("Telecom" → "Telecomunicações"),
 * junta sinônimos da mesma coisa ("Agro"/"Agropecuária" → "Agronegócio") e nada
 * mais. Subsetor desconhecido preserva o texto da fonte — um setor novo aparece
 * com o nome dele em vez de sumir dentro de "Outros".
 */
const STOCK_SUBSECTOR_LABELS: Record<string, string> = {
    'eletricas': 'Energia Elétrica',
    'energia eletrica': 'Energia Elétrica',
    'saneamento': 'Saneamento Básico',
    'agua e saneamento': 'Saneamento Básico',
    'telecom': 'Telecomunicações',
    'telecomunicacoes': 'Telecomunicações',
    'petroleo': 'Petróleo e Gás',
    'gas e biocombustiveis': 'Petróleo e Gás',
    'agro': 'Agronegócio',
    'agropecuaria': 'Agronegócio',
    'quimicos': 'Química',
    'comercio': 'Varejo',
    'bens industriais': 'Indústria',
    'material de transporte': 'Transporte',
    'exploracao de imoveis': 'Imobiliário',
    'programas e servicos': 'Tecnologia',
    'computadores e equipamentos': 'Tecnologia',
    'midia': 'Mídia',
    'maquinas e equipamentos': 'Máquinas e Equipamentos',
    'tecidos, vestuario e calcados': 'Vestuário e Calçados',
    'consumo ciclico': 'Consumo Cíclico',
    'medicamentos e outros produtos': 'Saúde',
    'servicos medico - hospitalares': 'Saúde',
    'analises e diagnosticos': 'Saúde',
    'previdencia e seguros': 'Seguros',
    'financeiro': 'Serviços Financeiros',
    'servicos financeiros diversos': 'Serviços Financeiros',
};

/** Subsetor de exibição de uma ação. Nunca colapsa no macro-setor. */
export const stockSubsectorLabel = (asset: SectorLabelInput): string => {
    if (asset.type === 'ETF') return ETF_SECTOR_LABEL;

    const sector = resolveSector(asset);
    const n = normalize(sector);
    if (!n) return UNKNOWN_SECTOR_LABEL;
    if (STOCK_SUBSECTOR_LABELS[n]) return STOCK_SUBSECTOR_LABELS[n];

    // Setor em inglês (Yahoo) não tem subsetor equivalente: cai no macro
    // traduzido, que é a informação mais fina que existe para esse ativo.
    if (US_SECTOR_MAP[n]) return MACRO_LABELS[US_SECTOR_MAP[n]];

    return sector;
};

// --- Renda Fixa: indexador ---------------------------------------------------

/**
 * Rótulo do INDEXADOR de um título de Renda Fixa.
 *
 * RF não tem setor, mas tem o mesmo tipo de eixo: o que concentra risco aqui é
 * estar tudo em pós (ou tudo em pré) — IPCA, pós e pré reagem a juro e inflação
 * de formas opostas. É a leitura análoga à do macro-setor numa ação.
 *
 * O balde vem de `fixedIncomeSubKey` (utils/allocation), a MESMA régua das
 * sub-metas da Distribuição — inclusive o fallback do legado sem índice, que
 * espelha a convenção do accrual (taxa > 50 = % do CDI → pós). Reimplementar a
 * régua aqui faria o donut chamar de prefixado um "100% do CDI" que a meta logo
 * ao lado conta como pós-fixado.
 *
 * Não existe "Não classificado" nesta classe: a régua sempre resolve um balde.
 */
export const fixedIncomeSectorLabel = (asset: SectorLabelInput): string =>
    FIXED_INCOME_SUB_LABELS[fixedIncomeSubKey(asset)];

// --- Agregação ---------------------------------------------------------------

/**
 * Eixo de repartição de uma classe na Carteira: macro-setor em ação, segmento em
 * FII, indexador em Renda Fixa. "Setor" aqui é sempre o eixo de RISCO da classe,
 * e não o rótulo mais bonito — em RF o risco não se reparte por setor nenhum.
 */
export type SectorKind = 'FII' | 'STOCK' | 'FIXED_INCOME';

/**
 * Granularidades aceitas pela agregação. Superconjunto de `SectorKind`: a lista
 * âncora reparte ação por SUBSETOR (ver `stockSubsectorLabel`), enquanto a
 * Carteira segue no macro-setor. FII já é fino nas duas — não há um segundo nível.
 */
export type SectorGranularity = SectorKind | 'STOCK_SUBSECTOR';

/**
 * Classes que ganham donut, com o EIXO DE RISCO de cada uma. Renda Fixa não tem
 * setor, mas tem o equivalente: o INDEXADOR — uma RF toda em pós e uma toda em pré
 * correm riscos opostos, e essa é a concentração que conta ali.
 *
 * Indexado pelo BALDE DE ALOCAÇÃO da linha (`allocationBucket`), não pelo `type`:
 * um Tesouro marcado como Reserva vive no balde Caixa, que é reserva e não
 * alocação. Exterior e Cripto ficam de fora por enquanto — o setor do ativo US
 * chega em inglês, e cripto não tem setor nenhum.
 */
export const SECTOR_PIE_KIND: Partial<Record<string, SectorKind>> = {
    STOCK: 'STOCK',
    FII: 'FII',
    FIXED_INCOME: 'FIXED_INCOME',
};

export type SectorKindInput = Partial<Pick<Asset, 'type' | 'isReserve' | 'allocationClass'>>;

/**
 * Eixo do donut em que a linha entra, ou null se a classe dela não tem donut.
 *
 * Fonte ÚNICA da pergunta "esta linha aparece em qual gráfico?": a lista usa para
 * decidir se desenha o donut da classe, e a sublinha do ativo usa para escolher em
 * que vocabulário se rotular. Duas cópias desse mapa é como uma classe passa a ter
 * donut de um eixo e rótulo de outro.
 */
export const sectorKindOf = (asset: SectorKindInput): SectorKind | null =>
    SECTOR_PIE_KIND[allocationBucket(asset as Pick<Asset, 'isReserve' | 'type' | 'allocationClass'>)] ?? null;

/**
 * Granularidade da LINHA em cada eixo. Na ação é uma casa abaixo do donut — a
 * linha serve para reconhecer o ativo ("Energia Elétrica"), o donut para medir
 * risco ("Utilidade Pública"), e colapsar a linha no macro empobreceria a lista.
 * Em FII e Renda Fixa é a MESMA: lá o donut já é fino, e dar dois nomes à mesma
 * coisa ("Títulos e Val. Mob." na linha, "Papel (CRI)" na fatia) é só ruído.
 */
export const ROW_GRANULARITY: Record<SectorKind, SectorGranularity> = {
    STOCK: 'STOCK_SUBSECTOR',
    FII: 'FII',
    FIXED_INCOME: 'FIXED_INCOME',
};

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

/**
 * Entrada mínima da agregação. É um subconjunto de `Asset` (que continua sendo
 * aceito) para que a MESMA repartição possa ser calculada sobre linhas que ainda
 * não são posições — a sugestão do Aporte Inteligente é uma lista de
 * (ticker, setor, valor) que só existiria na carteira depois da compra.
 */
export type SectorAllocationInput = SectorLabelInput & Pick<Asset, 'ticker'> & { totalValue: number };

const KIND_CONFIG: Record<SectorGranularity, { labelOf: (a: SectorLabelInput) => string; foldLabel: string }> = {
    FII: { labelOf: (a) => fiiSectorLabel(a.sector), foldLabel: 'Outros segmentos' },
    STOCK: { labelOf: stockSectorLabel, foldLabel: 'Outros setores' },
    STOCK_SUBSECTOR: { labelOf: stockSubsectorLabel, foldLabel: 'Outros setores' },
    // A cauda nunca dobra em RF (são no máximo 3 baldes), mas o campo é do contrato.
    FIXED_INCOME: { labelOf: fixedIncomeSectorLabel, foldLabel: 'Outros indexadores' },
};

/** Rótulo de setor de uma linha, na granularidade pedida. Só precisa do setor. */
export const sectorLabelFor = (item: SectorLabelInput, kind: SectorGranularity): string =>
    KIND_CONFIG[kind].labelOf(item);

/**
 * Reparte o saldo da classe por setor, do maior para o menor.
 *
 * Regras de leitura (por que não é só um groupBy):
 *  • "Não classificado" nunca disputa cor com um setor real — vai sempre por
 *    último, em cinza, para não passar por um setor de verdade;
 *  • acima de MAX_SECTOR_SLICES baldes, a cauda (mais o não classificado) dobra
 *    num balde cinza — gerar mais tons quebraria a validação da paleta.
 */
export const computeSectorAllocation = (items: SectorAllocationInput[], kind: SectorGranularity): SectorSlice[] => {
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
