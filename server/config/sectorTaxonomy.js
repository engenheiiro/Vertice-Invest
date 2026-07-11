
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
    // ETF nacional (classe própria): concentra pelo TEMA/índice do ETF (ex. "Índice
    // Amplo", "Cripto", "Ouro") em vez de cair em OUTROS, evitando comprimir o ranking.
    if (asset.type === 'ETF') return asset.sector || 'ETF';
    return getMacroSector(asset.sector);
};

// ---------------------------------------------------------------------------
// CICLICIDADE — macro-setores estruturalmente cíclicos.
//
// Ciclicidade ≠ "não estar na lista de setores seguros". O gate defensivo já
// exige DY≥6 & P/L≤10 para setor não-seguro, mas uma ação cíclica em queda cumpre
// isso TRIVIALMENTE: preço caindo ÷ lucro de PICO do ciclo gera P/L baixo e DY alto,
// exatamente o perfil que o scoring premiava como "defensivo barato" (caso SHUL4 —
// Schulz, bens industriais/autopeças de caminhão/fundidos p/ agro). É a armadilha
// clássica de value-trap cíclico: comprar P/L baixo (topo do ciclo) em vez de P/L
// alto (fundo). Cíclicas nunca devem ser elegíveis ao perfil DEFENSIVE.
//
// INDUSTRIAL e COMMODITIES são os dois macro-setores estruturalmente cíclicos.
// REAL_ESTATE e o varejo de Consumo Cíclico são sensíveis a juros, mas têm perfil
// de renda/consumo distinto — ficam de fora do BARRAMENTO (tratados só pela
// sensibilidade a juros no scoringEngine). 'Consumo Cíclico' (sub-setor fino que
// cai em CONSUMO) é coberto por substring dedicada abaixo.
export const CYCLICAL_MACRO_SECTORS = new Set(['INDUSTRIAL', 'COMMODITIES']);

// Rótulos finos explicitamente cíclicos cujo macro-setor (CONSUMO) não é cíclico
// como um todo — casam por substring normalizada.
const CYCLICAL_SUBSECTOR_HINTS = ['consumo ciclico', 'consumer cyclical'];

// True se o setor do ativo é estruturalmente cíclico (macro cíclico OU sub-setor
// explicitamente cíclico). Reaproveita getMacroSector.
export const isCyclicalSector = (sector) => {
    if (!sector) return false;
    if (CYCLICAL_MACRO_SECTORS.has(getMacroSector(sector))) return true;
    const n = normalizeSegment(sector);
    return CYCLICAL_SUBSECTOR_HINTS.some(h => n.includes(h));
};

// ─────────────────────────────────────────────────────────────────────────────
// GOVERNANÇA — controle estatal (eixo ORTOGONAL à ciclicidade).
//
// A ciclicidade pega a Petrobras pela porta do setor (COMMODITIES), mas deixa passar
// nomes ESTATAIS de setores "seguros" — um banco estatal (BBAS3) ou uma utility
// estadual (CMIG4, SAPR11) entram no gate Defensivo como qualquer banco/elétrica.
// O risco real dessas empresas não é o setor: é o CONTROLADOR. A União/Estado pode
// redirecionar payout, política de preços e capex por decisão política (a história
// de dividendo da Petrobras muda com o governo). O DY alto não é contratual como o de
// uma pagadora privada regulada. É um eixo próprio de risco que setor nenhum captura.
//
// Lista curada (conhecimento de domínio estável, como as listas de setor seguro):
// só empresas com controlador estatal DE FATO hoje. Exclui deliberadamente as já
// PRIVATIZADAS — SBSP3 (2024), CPLE3/6 (2023), ELET3/6 (2022, só golden share) —
// que passaram a ser corporations sem controlador estatal. Revisar quando houver
// nova privatização/estatização. Tickers por classe (ON/PN/Unit) explícitos.
export const STATE_CONTROLLED_TICKERS = new Set([
    // Federal
    'PETR3', 'PETR4',      // Petrobras
    'BBAS3',               // Banco do Brasil
    'BBSE3',               // BB Seguridade (controlada pelo BB → indireta federal)
    // Estaduais
    'SAPR3', 'SAPR4', 'SAPR11', // Sanepar (PR)
    'CMIG3', 'CMIG4',      // Cemig (MG)
    'CSMG3',               // Copasa (MG)
    'BRSR3', 'BRSR5', 'BRSR6',  // Banrisul (RS)
]);

// True se o ativo tem controlador estatal de fato (federal/estadual). Normaliza o
// ticker (uppercase/trim) e ignora sufixo fracionário 'F' (ex.: PETR4F → PETR4).
export const isStateControlled = (ticker) => {
    if (!ticker) return false;
    let t = String(ticker).trim().toUpperCase();
    if (t.endsWith('F') && STATE_CONTROLLED_TICKERS.has(t.slice(0, -1))) t = t.slice(0, -1);
    return STATE_CONTROLLED_TICKERS.has(t);
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
