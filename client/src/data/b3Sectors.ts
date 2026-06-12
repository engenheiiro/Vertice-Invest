/**
 * Fallback de setor para ações da B3, indexado pela BASE do ticker (4 letras,
 * sem o dígito). Ex.: "KLBN4" e "KLBN11" → base "KLBN" → "Papel e Celulose".
 *
 * Usado APENAS quando o backend não trouxe um setor válido (ativo não
 * sincronizado / sem fundamentos), para evitar a 2ª linha cair no genérico
 * "Ação". Os nomes seguem os subsetores de server/config/sectorTaxonomy.js.
 *
 * Não precisa ser exaustivo — cobre as ações mais negociadas/mantidas.
 * Adicionar novas entradas é trivial (base de 4 letras → setor).
 */
export const B3_SECTOR_BY_BASE: Record<string, string> = {
  // Petróleo, Gás e Biocombustíveis
  PETR: 'Petróleo',
  PRIO: 'Petróleo',
  RECV: 'Petróleo',
  RRRP: 'Petróleo',
  CSAN: 'Petróleo',
  UGPA: 'Petróleo',
  VBBR: 'Petróleo',
  ENAT: 'Petróleo',

  // Mineração e Siderurgia
  VALE: 'Mineração',
  CMIN: 'Mineração',
  BRAP: 'Mineração',
  GGBR: 'Siderurgia',
  GOAU: 'Siderurgia',
  CSNA: 'Siderurgia',
  USIM: 'Siderurgia',

  // Papel e Celulose
  KLBN: 'Papel e Celulose',
  SUZB: 'Papel e Celulose',
  RANI: 'Papel e Celulose',

  // Química
  BRKM: 'Química',
  UNIP: 'Química',
  DXCO: 'Materiais Básicos',

  // Bancos e Serviços Financeiros
  ITUB: 'Bancos',
  BBDC: 'Bancos',
  BBAS: 'Bancos',
  SANB: 'Bancos',
  BPAC: 'Bancos',
  BPAN: 'Bancos',
  ABCB: 'Bancos',
  BMGB: 'Bancos',
  B3SA: 'Serviços Financeiros Diversos',
  CIEL: 'Serviços Financeiros Diversos',

  // Seguros e Previdência
  BBSE: 'Seguros',
  CXSE: 'Seguros',
  PSSA: 'Seguros',
  IRBR: 'Seguros',
  WIZC: 'Seguros',

  // Energia Elétrica
  ELET: 'Energia Elétrica',
  CMIG: 'Energia Elétrica',
  CPLE: 'Energia Elétrica',
  CPFE: 'Energia Elétrica',
  EGIE: 'Energia Elétrica',
  ENGI: 'Energia Elétrica',
  ENEV: 'Energia Elétrica',
  EQTL: 'Energia Elétrica',
  TAEE: 'Energia Elétrica',
  NEOE: 'Energia Elétrica',
  AURE: 'Energia Elétrica',
  ALUP: 'Energia Elétrica',
  TRPL: 'Energia Elétrica',

  // Saneamento
  SBSP: 'Saneamento',
  SAPR: 'Saneamento',
  CSMG: 'Saneamento',

  // Telecom
  VIVT: 'Telecomunicações',
  TIMS: 'Telecomunicações',
  TELB: 'Telecomunicações',

  // Varejo e Consumo
  MGLU: 'Varejo',
  LREN: 'Varejo',
  AMER: 'Varejo',
  PCAR: 'Varejo',
  CRFB: 'Varejo',
  ASAI: 'Varejo',
  PETZ: 'Varejo',
  ARZZ: 'Tecidos, Vestuário e Calçados',
  SOMA: 'Tecidos, Vestuário e Calçados',
  CEAB: 'Tecidos, Vestuário e Calçados',
  GRND: 'Tecidos, Vestuário e Calçados',
  ALPA: 'Tecidos, Vestuário e Calçados',
  VULC: 'Tecidos, Vestuário e Calçados',
  NTCO: 'Consumo Cíclico',
  CVCB: 'Consumo Cíclico',

  // Bebidas e Alimentos
  ABEV: 'Bebidas',
  JBSS: 'Alimentos',
  MRFG: 'Alimentos',
  BRFS: 'Alimentos',
  BEEF: 'Alimentos',
  SMTO: 'Agropecuária',
  SLCE: 'Agropecuária',
  AGRO: 'Agropecuária',
  CAML: 'Alimentos',
  MDIA: 'Alimentos',

  // Saúde
  RDOR: 'Serviços Médico - Hospitalares',
  HAPV: 'Serviços Médico - Hospitalares',
  FLRY: 'Análises e Diagnósticos',
  QUAL: 'Serviços Médico - Hospitalares',
  RADL: 'Medicamentos e Outros Produtos',
  PNVL: 'Medicamentos e Outros Produtos',
  HYPE: 'Medicamentos e Outros Produtos',
  PARD: 'Análises e Diagnósticos',

  // Bens Industriais / Máquinas / Transporte
  WEGE: 'Máquinas e Equipamentos',
  KEPL: 'Máquinas e Equipamentos',
  ROMI: 'Máquinas e Equipamentos',
  EMBR: 'Material de Transporte',
  POMO: 'Material de Transporte',
  LEVE: 'Material de Transporte',
  TUPY: 'Material de Transporte',
  FRAS: 'Material de Transporte',
  RAIL: 'Transporte',
  CCRO: 'Transporte',
  ECOR: 'Transporte',
  STBP: 'Transporte',
  AZUL: 'Transporte',
  GOLL: 'Transporte',
  RENT: 'Serviços',
  VAMO: 'Serviços',
  SIMH: 'Transporte',

  // Construção Civil e Imobiliário
  CYRE: 'Construção Civil',
  MRVE: 'Construção Civil',
  EZTC: 'Construção Civil',
  DIRR: 'Construção Civil',
  CURY: 'Construção Civil',
  TEND: 'Construção Civil',
  JHSF: 'Exploração de Imóveis',
  MULT: 'Shoppings',
  IGTI: 'Shoppings',
  ALOS: 'Shoppings',

  // Tecnologia
  TOTS: 'Programas e Serviços',
  LWSA: 'Programas e Serviços',
  POSI: 'Computadores e Equipamentos',
  INTB: 'Programas e Serviços',

  // Educação
  COGN: 'Educação',
  YDUQ: 'Educação',
  CSED: 'Educação',
};

/** Base de 4 letras (sem dígito) de um ticker B3. Ex.: "KLBN11" → "KLBN". */
export function getTickerBase(ticker: string): string {
  return (ticker || '').trim().toUpperCase().replace(/\d+$/, '');
}

/** Setor de fallback para um ticker B3, ou undefined se não mapeado. */
export function getB3SectorFallback(ticker: string): string | undefined {
  return B3_SECTOR_BY_BASE[getTickerBase(ticker)];
}
