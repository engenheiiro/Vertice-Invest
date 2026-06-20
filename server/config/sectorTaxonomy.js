
// Mapeamento de Macro-Setores para Gestão de Risco Sistêmico
// Agrupa setores correlacionados para evitar concentração real.

export const MACRO_SECTORS = {
    'FINANCEIRO': [
        'Bancos', 
        'Seguros', 
        'Holdings Financeiras', 
        'Financeiro', 
        'Serviços Financeiros Diversos',
        'Previdência e Seguros',
        'Fundo de Fundos', // FIIs
        'Papel', // FIIs de Papel (Recebíveis Imobiliários - CRI/CRA)
        'Multiestratégia' // FIIs
    ],
    'UTILITIES': [
        'Elétricas', 
        'Energia Elétrica',
        'Saneamento', 
        'Água e Saneamento', 
        'Gás', 
        'Utilidade Pública'
    ],
    'COMMODITIES': [
        'Mineração', 
        'Petróleo', 
        'Gás e Biocombustíveis',
        'Siderurgia', 
        'Papel e Celulose', 
        'Agro',
        'Agropecuária',
        'Química',
        'Químicos',
        'Materiais Básicos',
        'Fiagro' // Fiagro é essencialmente exposição ao Agro/Crédito Agro
    ],
    'REAL_ESTATE': [
        'Construção Civil', 
        'Exploração de Imóveis', 
        'Shoppings', 
        'Lajes Corporativas', 
        'Logística', 
        'Renda Urbana',
        'Hotéis',
        'Imobiliário',
        'Híbrido', // FIIs Híbridos (Geralmente Tijolo + Papel)
        'Desenvolvimento', // FIIs
        'Infraestrutura' // FIIs de Infra (Geralmente Dívida/Equity de Infra) -> Pode ser Utilities, mas mercado trata como FII/Infra
    ],
    'CONSUMO': [
        'Varejo', 
        'Alimentos', 
        'Bebidas', 
        'Consumo Cíclico', 
        'Tecidos, Vestuário e Calçados',
        'Comércio',
        'Educação' // Educação é cíclico/consumo
    ],
    'INDUSTRIAL': [
        'Indústria',
        'Bens Industriais', 
        'Máquinas e Equipamentos', 
        'Transporte', 
        'Material de Transporte',
        'Serviços' // Serviços diversos
    ],
    'TECNOLOGIA': [
        'Tecnologia',
        'Computadores e Equipamentos', 
        'Programas e Serviços', 
        'Telecom',
        'Telecomunicações', 
        'Mídia'
    ],
    'SAUDE': [
        'Saúde',
        'Medicamentos e Outros Produtos',
        'Serviços Médico - Hospitalares',
        'Análises e Diagnósticos',
        // US GICS
        'Healthcare',
        'Health Care',
        'Pharmaceuticals',
        'Biotechnology',
        'Health Care Equipment',
        'Health Care Services',
        'Health Care Facilities',
        'Health Care Distributors',
        'Managed Care',
        'Life Sciences'
    ]
};

// US GICS sector → macro-sector mapping (English sector names from Yahoo Finance)
export const US_SECTOR_MAP = {
    'Technology': 'TECNOLOGIA',
    'Information Technology': 'TECNOLOGIA',
    'Communication Services': 'TECNOLOGIA',
    'Healthcare': 'SAUDE',
    'Health Care': 'SAUDE',
    'Financials': 'FINANCEIRO',
    'Financial Services': 'FINANCEIRO',
    'Consumer Discretionary': 'CONSUMO',
    'Consumer Staples': 'CONSUMO',
    // Nomes REAIS de setor do Yahoo Finance (≠ GICS). Sem isto, ~79 ações de consumo
    // do S&P 500 caíam em OUTROS, inchando esse balde e distorcendo a diversificação.
    'Consumer Cyclical': 'CONSUMO',
    'Consumer Defensive': 'CONSUMO',
    'Energy': 'COMMODITIES',
    'Materials': 'COMMODITIES',
    'Basic Materials': 'COMMODITIES',
    'Industrials': 'INDUSTRIAL',
    'Real Estate': 'REAL_ESTATE',
    'Utilities': 'UTILITIES',
};

// ---------------------------------------------------------------------------
// SEGMENTOS DE FII (granularidade fina para diversificação)
//
// Para AÇÕES/ETFs, agrupar setores correlacionados em macro-setores (acima) é o
// correto: bancos+seguros sobem/caem juntos. Para FIIs, porém, o macro-setor é
// GROSSEIRO DEMAIS — colapsa shoppings, logística, lajes, papel, fiagro etc. em
// ~3 baldes (REAL_ESTATE/FINANCEIRO/COMMODITIES). Como o draft limita N ativos por
// balde, uma carteira 100% FII fica artificialmente travada em ~8 nomes, deixando
// de fora dezenas de bons FIIs de segmentos distintos (o caso VISC11/HGLG11/…).
//
// Cada segmento de FII é um sub-ativo com risco PRÓPRIO (inquilino, vacância,
// crédito CRI, ciclo agro), então a concentração de FII é medida POR SEGMENTO.
// A concentração por GESTORA continua tratada à parte (penalidade de gestora).
const FII_SEGMENT_CANON = {
    'shoppings': 'FII_SHOPPING',
    'shopping': 'FII_SHOPPING',
    'logistica': 'FII_LOGISTICA',
    'imoveis industriais e logisticos': 'FII_LOGISTICA',
    'lajes corporativas': 'FII_LAJES',
    'lajes': 'FII_LAJES',
    'escritorios': 'FII_LAJES',
    'renda urbana': 'FII_RENDA_URBANA',
    'agencias de bancos': 'FII_RENDA_URBANA',
    'varejo': 'FII_RENDA_URBANA',
    'hoteis': 'FII_HOTEIS',
    'hotel': 'FII_HOTEIS',
    'hibrido': 'FII_HIBRIDO',
    'papel': 'FII_PAPEL',
    'titulos e val. mob.': 'FII_PAPEL',
    'recebiveis': 'FII_PAPEL',
    'fundo de fundos': 'FII_FOF',
    'multiestrategia': 'FII_MULTI',
    'fiagro': 'FII_FIAGRO',
    'infraestrutura': 'FII_INFRA',
    'desenvolvimento': 'FII_DESENVOLVIMENTO',
    'residencial': 'FII_RESIDENCIAL',
    'imobiliario': 'FII_IMOBILIARIO',
    'exploracao de imoveis': 'FII_IMOBILIARIO',
    'hospital': 'FII_SAUDE',
    'saude': 'FII_SAUDE',
};

// Normaliza um rótulo (sem acento, minúsculo, espaços colapsados) para casar segmento.
const normalizeSegment = (s) =>
    (s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

// Segmento de concentração de um FII. Segmentos conhecidos viram chaves canônicas;
// qualquer segmento desconhecido recebe seu PRÓPRIO balde (`FII::<segmento>`), nunca
// colapsando em macro — assim um segmento novo do Fundamentus não some na diversificação.
export const getFiiSegment = (sector) => {
    const n = normalizeSegment(sector);
    if (!n) return 'FII_OUTROS';
    return FII_SEGMENT_CANON[n] || `FII::${n}`;
};

// Chave de concentração usada pelo draft e pela penalidade de concentração.
//  - FII   → segmento fino (diversifica por tipo de imóvel/crédito);
//  - CRYPTO→ balde único 'CRYPTO' (o cap de cripto é tratado à parte no draft);
//  - demais (ação/ETF BR e US) → macro-setor (risco sistêmico correlacionado).
export const getConcentrationKey = (asset) => {
    if (!asset) return 'OUTROS';
    if (asset.type === 'FII') return getFiiSegment(asset.sector);
    if (asset.type === 'CRYPTO') return 'CRYPTO';
    return getMacroSector(asset.sector);
};

// Função Helper para descobrir o Macro Setor
export const getMacroSector = (subSector) => {
    if (!subSector) return 'OUTROS';

    const normalizedSub = subSector.trim();

    // US GICS sectors (English) — check first for exact match
    if (US_SECTOR_MAP[normalizedSub]) return US_SECTOR_MAP[normalizedSub];
    // Partial match for US sectors
    for (const [usSector, macro] of Object.entries(US_SECTOR_MAP)) {
        if (normalizedSub.includes(usSector) || usSector.includes(normalizedSub)) return macro;
    }

    // Caso específico para diferenciar 'Papel' (FII) de 'Papel e Celulose' (Commodity)
    if (normalizedSub === 'Papel') return 'FINANCEIRO';
    if (normalizedSub === 'Papel e Celulose') return 'COMMODITIES';

    for (const [macro, subs] of Object.entries(MACRO_SECTORS)) {
        if (subs.some(s => normalizedSub.includes(s) || s === normalizedSub)) {
            return macro;
        }
    }
    return 'OUTROS';
};
