
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
        'Análises e Diagnósticos'
    ]
};

// Função Helper para descobrir o Macro Setor
export const getMacroSector = (subSector) => {
    if (!subSector) return 'OUTROS';
    
    // Normalização para evitar erros de case
    const normalizedSub = subSector.trim();

    // Caso específico para diferenciar 'Papel' (FII) de 'Papel e Celulose' (Commodity)
    if (normalizedSub === 'Papel') return 'FINANCEIRO';
    if (normalizedSub === 'Papel e Celulose') return 'COMMODITIES';

    for (const [macro, subs] of Object.entries(MACRO_SECTORS)) {
        // Verifica se algum dos sub-setores da lista está contido no setor do ativo
        // Ex: 'Energia Elétrica' (Taxonomia) está contido em 'Energia Elétrica' (Ativo)
        // Ou 'Elétricas' (Taxonomia) está contido em 'Elétricas' (Ativo)
        if (subs.some(s => normalizedSub.includes(s) || s === normalizedSub)) {
            return macro;
        }
    }
    return 'OUTROS'; // Default se não encontrar
};
