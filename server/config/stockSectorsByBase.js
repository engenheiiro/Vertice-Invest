
// Mapa de setor para AÇÕES da B3, indexado pela BASE do ticker (letras, sem o
// dígito). Ex.: "KLBN3", "KLBN4" e "KLBN11" → base "KLBN" → "Papel e Celulose".
//
// Motivo: o scraping do Fundamentus (resultado.php) NÃO traz setor de ações, e o
// SECTOR_OVERRIDES é por ticker exato (tinha KLBN11 mas não KLBN4). Este mapa por
// base garante que todas as classes de uma mesma empresa resolvam o mesmo setor.
//
// Os nomes seguem a convenção de server/config/sectorOverrides.js (subsetores
// reconhecidos por server/config/sectorTaxonomy.js → getMacroSector).
// Não precisa ser exaustivo; cobre as ações mais negociadas/mantidas e é trivial
// de estender (BASE: 'Setor').

export const STOCK_SECTOR_BY_BASE = {
    // Petróleo, Gás e Biocombustíveis
    PETR: 'Petróleo', PRIO: 'Petróleo', RECV: 'Petróleo', RRRP: 'Petróleo', BRAV: 'Petróleo',
    CSAN: 'Petróleo', UGPA: 'Petróleo', VBBR: 'Petróleo', RAIZ: 'Petróleo', ENAT: 'Petróleo',

    // Mineração e Siderurgia
    VALE: 'Mineração', CMIN: 'Mineração', BRAP: 'Mineração', CBAV: 'Mineração', AURA: 'Mineração',
    GGBR: 'Siderurgia', GOAU: 'Siderurgia', CSNA: 'Siderurgia', USIM: 'Siderurgia', FESA: 'Siderurgia',

    // Papel e Celulose
    KLBN: 'Papel e Celulose', SUZB: 'Papel e Celulose', RANI: 'Papel e Celulose',

    // Química e Materiais Básicos
    BRKM: 'Química', UNIP: 'Química', DXCO: 'Materiais Básicos', DEXP: 'Materiais Básicos',
    EUCA: 'Materiais Básicos', ETER: 'Materiais Básicos', PTBL: 'Materiais Básicos',

    // Bancos e Financeiro
    ITUB: 'Bancos', BBDC: 'Bancos', BBAS: 'Bancos', SANB: 'Bancos', BPAC: 'Bancos',
    BPAN: 'Bancos', ABCB: 'Bancos', BMGB: 'Bancos', BMEB: 'Bancos', BRSR: 'Bancos',
    BAZA: 'Bancos', PINE: 'Bancos', BRBI: 'Bancos', ITSA: 'Bancos',
    B3SA: 'Financeiro', CIEL: 'Financeiro',

    // Seguros
    BBSE: 'Seguros', CXSE: 'Seguros', PSSA: 'Seguros', IRBR: 'Seguros', WIZC: 'Seguros',

    // Energia Elétrica
    ELET: 'Elétricas', CMIG: 'Elétricas', CPLE: 'Elétricas', CPFE: 'Elétricas', EGIE: 'Elétricas',
    ENGI: 'Elétricas', ENEV: 'Elétricas', EQTL: 'Elétricas', TAEE: 'Elétricas', NEOE: 'Elétricas',
    AURE: 'Elétricas', ALUP: 'Elétricas', TRPL: 'Elétricas', LIGT: 'Elétricas', CLSC: 'Elétricas',
    COCE: 'Elétricas', CEBR: 'Elétricas', EMAE: 'Elétricas', ISAE: 'Elétricas',

    // Saneamento
    SBSP: 'Saneamento', SAPR: 'Saneamento', CSMG: 'Saneamento', AMBP: 'Saneamento', ORVR: 'Saneamento',

    // Telecom
    VIVT: 'Telecom', TIMS: 'Telecom', DESK: 'Telecom', FIQE: 'Telecom', BRST: 'Telecom', OIBR: 'Telecom',

    // Varejo e Consumo
    MGLU: 'Varejo', LREN: 'Varejo', AMER: 'Varejo', PCAR: 'Varejo', CRFB: 'Varejo',
    ASAI: 'Varejo', PETZ: 'Varejo', NTCO: 'Varejo', CVCB: 'Varejo', VIVA: 'Varejo',
    ARZZ: 'Varejo', AZZA: 'Varejo', SOMA: 'Varejo', CEAB: 'Varejo', GRND: 'Varejo',
    ALPA: 'Varejo', VULC: 'Varejo', GUAR: 'Varejo', PGMN: 'Varejo', PNVL: 'Varejo',
    RADL: 'Varejo', PFRM: 'Varejo', SBFG: 'Varejo', CGRA: 'Varejo', NATU: 'Varejo',

    // Bebidas e Alimentos
    ABEV: 'Bebidas', JBSS: 'Alimentos', MRFG: 'Alimentos', BRFS: 'Alimentos', BEEF: 'Alimentos',
    MBRF: 'Alimentos', CAML: 'Alimentos', MDIA: 'Alimentos', MEAL: 'Alimentos',

    // Agro
    SMTO: 'Agro', SLCE: 'Agro', AGRO: 'Agro', TTEN: 'Agro', SOJA: 'Agro', JALL: 'Agro',
    VITT: 'Agro', LAND: 'Agro',

    // Saúde
    RDOR: 'Saúde', HAPV: 'Saúde', FLRY: 'Saúde', QUAL: 'Saúde', HYPE: 'Saúde', BLAU: 'Saúde',
    ODPV: 'Saúde', MATD: 'Saúde', SMFT: 'Saúde', DASA: 'Saúde', AALR: 'Saúde', ONCO: 'Saúde',
    BIOM: 'Saúde',

    // Indústria / Bens Industriais
    WEGE: 'Indústria', KEPL: 'Indústria', ROMI: 'Indústria', POMO: 'Indústria', LEVE: 'Indústria',
    TUPY: 'Indústria', FRAS: 'Indústria', RAPT: 'Indústria', MYPK: 'Indústria', SHUL: 'Indústria',
    TASA: 'Indústria', MILS: 'Indústria', PRNR: 'Indústria', AERI: 'Indústria', PMAM: 'Indústria',
    SCAR: 'Indústria', LUPA: 'Indústria', RCSL: 'Indústria', EMBJ: 'Indústria', EMBR: 'Indústria',

    // Logística e Transporte
    RAIL: 'Logística', RENT: 'Logística', VAMO: 'Logística', SIMH: 'Logística', JSLG: 'Logística',
    LOGG: 'Logística', LOGN: 'Logística', MOVI: 'Logística', PORT: 'Logística', HBSA: 'Logística',
    TGMA: 'Logística', TPIS: 'Logística', OPCT: 'Logística', SEQL: 'Logística', VVEO: 'Logística',
    STBP: 'Logística', CCRO: 'Logística', AZUL: 'Transporte', GOLL: 'Transporte',
    ECOR: 'Infraestrutura', ALPK: 'Infraestrutura',

    // Construção Civil e Imobiliário
    CYRE: 'Construção Civil', MRVE: 'Construção Civil', EZTC: 'Construção Civil', DIRR: 'Construção Civil',
    CURY: 'Construção Civil', TEND: 'Construção Civil', JHSF: 'Construção Civil', EVEN: 'Construção Civil',
    GFSA: 'Construção Civil', HBOR: 'Construção Civil', MTRE: 'Construção Civil', TRIS: 'Construção Civil',
    PLPL: 'Construção Civil', LAVV: 'Construção Civil', MDNE: 'Construção Civil', MELK: 'Construção Civil',
    SYNE: 'Construção Civil', HBRE: 'Construção Civil', PDGR: 'Construção Civil', AZEV: 'Construção Civil',
    LPSB: 'Imobiliário',
    MULT: 'Shoppings', IGTI: 'Shoppings', ALOS: 'Shoppings',

    // Tecnologia
    TOTS: 'Tecnologia', LWSA: 'Tecnologia', POSI: 'Tecnologia', INTB: 'Tecnologia', CASH: 'Tecnologia',
    TECN: 'Tecnologia', VLID: 'Tecnologia', CSUD: 'Tecnologia', BMOB: 'Tecnologia', NGRD: 'Tecnologia',
    MLAS: 'Tecnologia', IFCM: 'Tecnologia',

    // Educação
    COGN: 'Educação', YDUQ: 'Educação', CSED: 'Educação', ANIM: 'Educação', SEER: 'Educação',
    VTRU: 'Educação',

    // Serviços
    GGPS: 'Serviços', ARML: 'Serviços',

    // --- Lote de agosto/2026: 108 ações que resolviam para 'Outros' -----------
    // Setor lido um a um no detalhes.php do Fundamentus (a tabela resultado.php,
    // que o sync usa, não traz setor de ação). Onde a fonte devolve um balde
    // genérico ("Diversos", "Comércio"), vale o subsetor dela.

    // Bancos e financeiro
    BEES: 'Bancos', BGIP: 'Bancos', BMIN: 'Bancos', BNBR: 'Bancos', BSLI: 'Bancos',
    RPAD: 'Bancos', MERC: 'Financeiro',
    ADMF: 'Holdings Diversificadas', MOAR: 'Holdings Diversificadas', PEAB: 'Holdings Diversificadas',

    // Energia, gás e saneamento
    AXIA: 'Energia Elétrica', CBEE: 'Energia Elétrica', CEEB: 'Energia Elétrica', EKTR: 'Energia Elétrica',
    ENMT: 'Energia Elétrica', EQPA: 'Energia Elétrica', GEPA: 'Energia Elétrica', REDE: 'Energia Elétrica',
    RNEW: 'Energia Elétrica', EQMA3B: 'Energia Elétrica',
    CGAS: 'Gás', PASS: 'Gás',

    // Petróleo, químicos e materiais
    AZTE: 'Petróleo', OSXB: 'Petróleo', RPMG: 'Petróleo',
    CRPG: 'Químicos', FHER: 'Químicos', NUTR: 'Químicos', PLTO: 'Químicos',
    SNSY: 'Materiais Básicos',
    MGEL: 'Siderurgia', PATI: 'Siderurgia', TKNO: 'Siderurgia',

    // Bens de capital e material de transporte
    EALT: 'Máquinas e Equipamentos', FRIO: 'Máquinas e Equipamentos', INEP: 'Máquinas e Equipamentos',
    MTSA: 'Máquinas e Equipamentos', NORD: 'Máquinas e Equipamentos',
    MWET: 'Material de Transporte', RSUL: 'Material de Transporte',

    // Construção, engenharia e imobiliário
    AVLL: 'Construção Civil', FIEI: 'Construção Civil', HAGA: 'Construção Civil', JFEN: 'Construção Civil',
    RSID: 'Construção Civil', SOND: 'Construção Civil', TCSA: 'Construção Civil', VIVR: 'Construção Civil',
    IGBR: 'Exploração de Imóveis', NEXP: 'Exploração de Imóveis',

    // Consumo e comércio
    AMAR: 'Comércio', AMOB: 'Comércio', AUAU: 'Comércio', EPAR: 'Comércio', RIAA: 'Comércio',
    VSTE: 'Comércio', WLMM: 'Comércio',
    CEDO: 'Tecidos, Vestuário e Calçados', CTKA: 'Tecidos, Vestuário e Calçados',
    DOHL: 'Tecidos, Vestuário e Calçados', MNDL: 'Tecidos, Vestuário e Calçados',
    PTNT: 'Tecidos, Vestuário e Calçados',
    UCAS: 'Utilidades Domésticas', WHRL: 'Utilidades Domésticas', BOBR: 'Produtos de Limpeza',
    BMKS: 'Consumo Cíclico', RVEE: 'Consumo Cíclico', HOOT: 'Hotelaria',

    // Alimentos e agro
    BAUH: 'Alimentos', FICT: 'Alimentos', JOPA: 'Alimentos', MNPR: 'Alimentos', AGXY: 'Agropecuária',

    // Saúde
    BALM: 'Saúde', SAUD: 'Saúde', OFSA: 'Medicamentos e Outros Produtos',

    // Tecnologia, telecom, serviços e educação
    ECOM: 'Programas e Serviços', TOKY: 'Programas e Serviços', TRAD: 'Programas e Serviços',
    WDCN: 'Programas e Serviços', WEST: 'Programas e Serviços',
    TELB: 'Telecomunicações',
    // Padtec fabrica equipamento óptico; o Fundamentus a classifica como "Gestão de
    // Recursos", que descreve a holding e não o negócio.
    PDTC: 'Telecomunicações',
    CTAX: 'Serviços', DOTZ: 'Serviços',
    ATED: 'Educação', BIED: 'Educação', OBTC: 'Educação',

    // Transporte
    LUXM: 'Transporte', MOTV: 'Transporte',
};
