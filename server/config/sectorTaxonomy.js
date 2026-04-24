
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
    'Energy': 'COMMODITIES',
    'Materials': 'COMMODITIES',
    'Industrials': 'INDUSTRIAL',
    'Real Estate': 'REAL_ESTATE',
    'Utilities': 'UTILITIES',
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
