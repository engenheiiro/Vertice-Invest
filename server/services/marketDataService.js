
import logger from '../config/logger.js';
import MarketAsset from '../models/MarketAsset.js';
import { fundamentusService } from './fundamentusService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === MAPA SETORIAL MESTRE (VÉRTICE STANDARDS) ===
// Fonte unificada e higienizada
const MASTER_SECTOR_MAP = {
    // --- AÇÕES (B3) ---
    'VALE3': 'Mineração', 'CMIN3': 'Mineração', 'BRAP4': 'Mineração (Holding)', 'AURA33': 'Mineração', 'CBAV3': 'Mineração (Alumínio)',
    'PETR3': 'Petróleo e Gás', 'PETR4': 'Petróleo e Gás', 'PRIO3': 'Petróleo e Gás', 'RECV3': 'Petróleo e Gás', 
    'UGPA3': 'Distr. Combustíveis', 'VBBR3': 'Distr. Combustíveis', 'CSAN3': 'Energia / Combustíveis', 'RAIZ4': 'Biocombustíveis', 
    'BRAV3': 'Petróleo e Gás', 'LUPA3': 'Indústria (Óleo e Gás)', 'RRRP3': 'Petróleo e Gás', 'ENAT3': 'Petróleo e Gás',

    'ITUB3': 'Bancos', 'ITUB4': 'Bancos', 'BBDC3': 'Bancos', 'BBDC4': 'Bancos', 'BBAS3': 'Bancos', 'SANB11': 'Bancos', 
    'BPAC11': 'Bancos Investimento', 'ABCB4': 'Bancos', 'BRSR6': 'Bancos', 'BMGB4': 'Bancos', 'BPAN4': 'Bancos', 
    'BAZA3': 'Bancos', 'BMEB4': 'Bancos', 'PINE4': 'Bancos', 'BRBI11': 'Bancos', 'ITSA4': 'Holding Financeira',
    
    'B3SA3': 'Infraestrutura Financeira', 'CIEL3': 'Meios de Pagamento', 'CSUD3': 'Serviços Financeiros', 'WIZC3': 'Seguros (Corretagem)',
    'CASH3': 'Serviços Financeiros', 

    'BBSE3': 'Seguros', 'CXSE3': 'Seguros', 'PSSA3': 'Seguros', 'IRBR3': 'Resseguros', 'ODPV3': 'Seguros / Saúde',

    'ELET3': 'Energia Elétrica', 'ELET6': 'Energia Elétrica', 'EGIE3': 'Energia Elétrica', 'AURE3': 'Energia Elétrica',
    'TAEE11': 'Energia Elétrica', 'TRPL4': 'Energia Elétrica', 'ALUP11': 'Energia Elétrica', 'CPFE3': 'Energia Elétrica', 
    'CMIG4': 'Energia Elétrica', 'EQTL3': 'Energia Elétrica', 'NEOE3': 'Energia Elétrica', 'ENGI11': 'Energia Elétrica', 
    'ENEV3': 'Energia (Térmica)', 'LIGT3': 'Energia Elétrica', 'CPLE3': 'Energia Elétrica', 'CPLE6': 'Energia Elétrica',
    'CLSC4': 'Energia Elétrica', 'COCE5': 'Energia Elétrica', 'ISAE4': 'Energia Elétrica', 'EMAE4': 'Energia Elétrica',

    'SBSP3': 'Saneamento', 'SAPR11': 'Saneamento', 'CSMG3': 'Saneamento', 'SESP4': 'Saneamento', 'AMBP3': 'Meio Ambiente', 'ORVR3': 'Meio Ambiente',

    'MGLU3': 'Varejo / E-commerce', 'BHIA3': 'Varejo', 'AMER3': 'Varejo', 'VIIA3': 'Varejo',
    'LREN3': 'Varejo (Moda)', 'ARZZ3': 'Varejo (Moda)', 'SOMA3': 'Varejo (Moda)', 'ALPA4': 'Varejo (Calçados)', 
    'ASAI3': 'Varejo (Atacarejo)', 'CRFB3': 'Varejo (Alimentos)', 'GMAT3': 'Varejo (Atacarejo)', 'PCAR3': 'Varejo',
    'PETZ3': 'Varejo (Pets)', 'RADL3': 'Varejo (Farmácias)', 'PGMN3': 'Varejo (Farmácias)', 'PNVL3': 'Varejo (Farmácias)', 'DMVF3': 'Varejo (Farmácias)',
    'CEAB3': 'Varejo (Moda)', 'CAMB3': 'Varejo (Esporte)', 'AZZA3': 'Varejo (Moda)', 'VIVA3': 'Varejo (Jóias)', 'SBFG3': 'Varejo (Esporte)',
    'TFCO4': 'Varejo (Moda)', 'CGRA4': 'Varejo (Moda)', 'GUAR3': 'Varejo (Moda)', 'LJQQ3': 'Varejo (Moda)', 'VULC3': 'Varejo (Calçados)',
    'GRND3': 'Varejo (Calçados)', 'ESPA3': 'Varejo', 'ALLD3': 'Varejo / Distribuição', 'ENJU3': 'Varejo (E-commerce)', 'PFRM3': 'Varejo / Saúde',

    'ABEV3': 'Bebidas', 'JBSS3': 'Alimentos / Proteína', 'BRFS3': 'Alimentos / Proteína', 'BEEF3': 'Alimentos / Proteína', 
    'MRFG3': 'Alimentos / Proteína', 'SMTO3': 'Agronegócio', 'SLCE3': 'Agronegócio', 'AGRO3': 'Agronegócio', 'MDIA3': 'Alimentos',
    'CAML3': 'Agronegócio (Alimentos)', 'TTEN3': 'Agronegócio', 'SOJA3': 'Agronegócio', 'VITT3': 'Agronegócio', 'JALL3': 'Agronegócio', 'LAND3': 'Agronegócio',

    'SUZB3': 'Papel e Celulose', 'KLBN11': 'Papel e Celulose', 'RANI3': 'Papel e Celulose', 'DXCO3': 'Materiais de Construção', 'ETER3': 'Materiais de Construção',
    'GGBR4': 'Siderurgia', 'GOAU4': 'Siderurgia', 'CSNA3': 'Siderurgia', 'USIM5': 'Siderurgia', 'FESA4': 'Siderurgia (Ferroligas)',
    'UNIP6': 'Química', 'BRKM5': 'Química', 

    'WEGE3': 'Bens Industriais', 'TASA4': 'Indústria (Armas)', 'EMBR3': 'Aeronáutica', 'POMO4': 'Indústria (Veículos)', 
    'RAPT4': 'Autopeças', 'LEVE3': 'Autopeças', 'FRAS3': 'Autopeças', 'MYPK3': 'Autopeças', 'TUPY3': 'Autopeças',
    'MILS3': 'Bens de Capital (Locação)', 'KEPL3': 'Bens de Capital (Agrícola)', 'SHUL4': 'Indústria', 'ROMI3': 'Bens de Capital',
    'AERI3': 'Indústria (Energia Renovável)', 'PMAM3': 'Indústria (Metalurgia)', 'RCSL4': 'Indústria (Implementos)', 'SCAR3': 'Indústria (Têxtil)',

    'RENT3': 'Locação de Veículos', 'MOVI3': 'Locação de Veículos', 'VAMO3': 'Logística (Caminhões)',
    'CCRO3': 'Infraestrutura', 'ECOR3': 'Infraestrutura', 'RAIL3': 'Logística', 'STBP3': 'Logística Portuária', 'HBSA3': 'Logística (Hidrovias)',
    'LOGG3': 'Logística', 'TGMA3': 'Logística', 'PORT3': 'Logística Portuária', 'LOGN3': 'Logística', 'TPIS3': 'Logística Portuária', 
    'AZUL4': 'Aviação', 'GOLL4': 'Aviação', 'SIMH3': 'Holding (Logística)', 'SEQL3': 'Logística',

    'CYRE3': 'Construção Civil', 'EZTC3': 'Construção Civil', 'MRVE3': 'Construção Civil', 'CURY3': 'Construção Civil', 
    'DIRR3': 'Construção Civil', 'TEND3': 'Construção Civil', 'JHSF3': 'Construção / Alta Renda', 'LAVV3': 'Construção Civil',
    'TRIS3': 'Construção Civil', 'EVEN3': 'Construção Civil', 'MTRE3': 'Construção Civil', 'HBOR3': 'Construção Civil', 
    'MELK3': 'Construção Civil', 'HBRE3': 'Construção Civil', 'GFSA3': 'Construção Civil', 'PDGR3': 'Construção Civil', 
    'PLPL3': 'Construção Civil', 'AZEV4': 'Construção / Infra',

    'MULT3': 'Shopping Center (Op)', 'IGTI11': 'Shopping Center (Op)', 'ALOS3': 'Shopping Center (Op)', 'JPSA3': 'Shoppings / Holding', 'SYNE3': 'Construção Comercial',

    'HYPE3': 'Farmacêutico', 'FLRY3': 'Saúde / Diagnóstico', 'RDOR3': 'Saúde / Hospitais', 'HAPV3': 'Saúde / Planos', 
    'QUAL3': 'Saúde / Planos', 'BLAU3': 'Farmacêutico', 'MATD3': 'Saúde / Hospitais', 'ONCO3': 'Saúde', 'DASA3': 'Saúde', 'VVEO3': 'Logística (Saúde)',
    'AALR3': 'Saúde', 'BIOM3': 'Saúde',

    'YDUQ3': 'Educação', 'COGN3': 'Educação', 'VTRU3': 'Educação', 'SEER3': 'Educação', 'CSED3': 'Educação', 'ANIM3': 'Educação',

    'TOTS3': 'Tecnologia', 'LWSA3': 'Tecnologia', 'POSI3': 'Tecnologia', 'INTB3': 'Tecnologia', 'BMOB3': 'Tecnologia', 
    'TECN3': 'Tecnologia', 'VLID3': 'Tecnologia', 'MLAS3': 'Tecnologia', 'NGRD3': 'Tecnologia', 'IFCM3': 'Tecnologia',
    'VIVT3': 'Telecomunicações', 'TIMS3': 'Telecomunicações', 'FIQE3': 'Telecomunicações', 'DESK3': 'Telecomunicações', 'BRST3': 'Telecomunicações', 'OIBR3': 'Telecomunicações',

    'CVCB3': 'Turismo', 'SHOW3': 'Entretenimento',

    // --- FUNDOS IMOBILIÁRIOS (FIIs) ---
    // Logística
    'HGLG11': 'FII Logística', 'BTLG11': 'FII Logística', 'XPLG11': 'FII Logística', 'VILG11': 'FII Logística', 
    'BRCO11': 'FII Logística', 'LVBI11': 'FII Logística', 'GGRC11': 'FII Logística', 'GALG11': 'FII Logística', 
    'RBRL11': 'FII Logística', 'PATL11': 'FII Logística', 'SDIL11': 'FII Logística', 'HSLG11': 'FII Logística',
    'RELG11': 'FII Logística', 'TRBL11': 'FII Logística', 'HGBL11': 'FII Logística', 'CPLG11': 'FII Logística',
    'AZPL11': 'FII Logística', 'GRUL11': 'FII Logística', 'FIIP11': 'FII Logística', 'FIIB11': 'FII Logística',
    'XPIN11': 'FII Logística', 'RZLC11': 'FII Logística',

    // Shoppings
    'XPML11': 'FII Shopping Center', 'VISC11': 'FII Shopping Center', 'HGBS11': 'FII Shopping Center', 'HSML11': 'FII Shopping Center', 
    'MALL11': 'FII Shopping Center', 'GSFI11': 'FII Shopping Center', 'CPSH11': 'FII Shopping Center', 'LASC11': 'FII Shopping Center',
    'BPML11': 'FII Shopping Center', 'FIGS11': 'FII Shopping Center', 'HPDP11': 'FII Shopping Center', 'GZIT11': 'FII Shopping Center', 'PQDP11': 'FII Shopping Center',

    // Lajes
    'JSRE11': 'FII Laje Corporativa', 'PVBI11': 'FII Laje Corporativa', 'BRCR11': 'FII Laje Corporativa', 'HGRE11': 'FII Laje Corporativa', 
    'RCRB11': 'FII Laje Corporativa', 'VINO11': 'FII Laje Corporativa', 'TEPP11': 'FII Laje Corporativa', 'RBRP11': 'FII Laje Corporativa', 
    'RECT11': 'FII Laje Corporativa', 'GTWR11': 'FII Laje Corporativa', 'MCLO11': 'FII Laje Corporativa', 'CXCO11': 'FII Laje Corporativa',
    'CPOF11': 'FII Laje Corporativa', 'AIEC11': 'FII Laje Corporativa', 'AJFI11': 'FII Laje Corporativa', 'ICNE11': 'FII Laje Corporativa',
    'BBIG11': 'FII Laje Corporativa', 'OULG11': 'FII Laje Corporativa', 'PATC11': 'FII Laje Corporativa', 'BLCA11': 'FII Laje Corporativa',
    'BROF11': 'FII Laje Corporativa', 'CCME11': 'FII Laje Corporativa', 'HOFC11': 'FII Laje Corporativa', 'CNES11': 'FII Laje Corporativa',

    // Híbridos / Renda Urbana
    'KNRI11': 'FII Híbrido', 'ALZR11': 'FII Híbrido', 'HGRU11': 'FII Renda Urbana', 'TRXF11': 'FII Renda Urbana', 
    'HGNG11': 'FII Renda Urbana', 'RBVA11': 'FII Renda Urbana', 'TRXB11': 'FII Renda Urbana', 'VIUR11': 'FII Renda Urbana',
    'GARE11': 'FII Híbrido', 'TGAR11': 'FII Híbrido (Desenv.)', 'KNHF11': 'FII Híbrido', 'RZAT11': 'FII Híbrido', 
    'TJKB11': 'FII Híbrido', 'BCIA11': 'FII Híbrido', 'HSRE11': 'FII Híbrido', 'RBRX11': 'FII Híbrido', 
    'MFII11': 'FII Híbrido', 'KOPA11': 'FII Híbrido', 'RBHG11': 'FII Híbrido', 'CPUR11': 'FII Híbrido', 'INLG11': 'FII Híbrido', 
    'WHGR11': 'FII Híbrido', 'VGHF11': 'FII Híbrido (Hedge)',

    // Papel (CRI / Recebíveis)
    'KNIP11': 'FII Papel (IPCA)', 'MXRF11': 'FII Papel (Híbrido)', 'CPTS11': 'FII Papel (High Grade)', 'IRDM11': 'FII Papel (High Yield)', 
    'HGCR11': 'FII Papel (CRI)', 'KNCR11': 'FII Papel (CRI)', 'KNSC11': 'FII Papel (CRI)', 'RBRR11': 'FII Papel (CRI)', 
    'RECR11': 'FII Papel (CRI)', 'VGIR11': 'FII Papel (CRI)', 'CVBI11': 'FII Papel (CRI)', 'MCCI11': 'FII Papel (CRI)', 
    'VGIP11': 'FII Papel (CRI)', 'VRTA11': 'FII Papel (CRI)', 'RZAK11': 'FII Papel (CRI)', 'HABT11': 'FII Papel (CRI)', 
    'DEVA11': 'FII Papel (High Yield)', 'HCTR11': 'FII Papel (High Yield)', 'URPR11': 'FII Papel (High Yield)', 
    'VSLH11': 'FII Papel (High Yield)', 'TORD11': 'FII Papel (High Yield)', 'KNHY11': 'FII Papel (High Yield)', 'RBRY11': 'FII Papel (High Yield)',
    'KNCA11': 'FII Papel (CRI)', 'AFHI11': 'FII Papel (CRI)', 'BTCI11': 'FII Papel (CRI)', 'CLIN11': 'FII Papel (CRI)',
    'GAME11': 'FII Papel (CRI)', 'HSAF11': 'FII Papel (CRI)', 'ICRI11': 'FII Papel (CRI)', 'ITRI11': 'FII Papel (CRI)',
    'JSCR11': 'FII Papel (CRI)', 'KCRE11': 'FII Papel (CRI)', 'MANA11': 'FII Papel (CRI)', 'PMIS11': 'FII Papel (CRI)',
    'PORD11': 'FII Papel (CRI)', 'RPRI11': 'FII Papel (CRI)', 'RRCI11': 'FII Papel (CRI)', 'SAPI11': 'FII Papel (CRI)',
    'SPXS11': 'FII Papel (CRI)', 'VCJR11': 'FII Papel (CRI)', 'VGRI11': 'FII Papel (CRI)', 'XPCI11': 'FII Papel (CRI)',
    'TVRI11': 'FII Papel (CRI)', 'FATN11': 'FII Papel (CRI)', 'VRTM11': 'FII Papel (CRI)', 'ALZC11': 'FII Papel (CRI)',
    'BCRI11': 'FII Papel (CRI)', 'OUJP11': 'FII Papel (CRI)', 'ARRI11': 'FII Papel (CRI)', 'KIVO11': 'FII Papel (CRI)',
    'BICE11': 'FII Papel (CRI)', 'RBIR11': 'FII Papel (CRI)', 'SNCI11': 'FII Papel (CRI)', 'CACR11': 'FII Papel (CRI)',
    'HBCR11': 'FII Papel (CRI)', 'JGPX11': 'FII Papel (CRI)', 'VCRA11': 'FII Papel (CRI)', 'IRIM11': 'FII Papel (CRI)',
    'NEXG11': 'FII Papel (CRI)', 'PNDL11': 'FII Papel (CRI)', 'TOPP11': 'FII Papel (CRI)', 'MCRE11': 'FII Papel (CRI)',
    'KORE11': 'FII Papel (CRI)', 'VCRR11': 'FII Papel (CRI)', 'VXXV11': 'FII Papel (CRI)', 'KNUQ11': 'FII Papel (CRI)', 
    'PCIP11': 'FII Papel (CRI)', 'PSEC11': 'FII Papel (CRI)', 'BTHF11': 'FII Papel (CRI)',

    // Fiagros
    'SNAG11': 'Fiagro', 'KNCA11': 'Fiagro', 'RZAG11': 'Fiagro', 'FGAA11': 'Fiagro', 'VGIA11': 'Fiagro', 
    'XPCA11': 'Fiagro', 'AAZQ11': 'Fiagro', 'CPTR11': 'Fiagro', 'CRAA11': 'Fiagro', 'EGAF11': 'Fiagro',
    'RURA11': 'Fiagro', 'SNFZ11': 'Fiagro', 'BTAL11': 'Fiagro', 'BBGO11': 'Fiagro', 'RZTR11': 'Fiagro',
    'AGRX11': 'Fiagro', 'PQAG11': 'Fiagro', 'BTRA11': 'Fiagro', 'PLAG11': 'Fiagro',

    // Fundo de Fundos (FOF)
    'HFOF11': 'FII Fundo de Fundos', 'KFOF11': 'FII Fundo de Fundos', 'BCFF11': 'FII Fundo de Fundos', 'RBRF11': 'FII Fundo de Fundos', 
    'XPSF11': 'FII Fundo de Fundos', 'BBFO11': 'FII Fundo de Fundos', 'JSAF11': 'FII Fundo de Fundos', 'KISU11': 'FII Fundo de Fundos',
    'LIFE11': 'FII Fundo de Fundos', 'SNFF11': 'FII Fundo de Fundos', 'TMPS11': 'FII Fundo de Fundos', 'RVBI11': 'FII Fundo de Fundos',
    'CXRI11': 'FII Fundo de Fundos', 'RBFF11': 'FII Fundo de Fundos',

    // Outros
    'HTMX11': 'FII Hotéis', 'LSOP11': 'FII Hotéis', 'MGHT11': 'FII Hotéis', 'SNEL11': 'FII Infraestrutura', 'KNIP11': 'FII Papel (IPCA)',
    'NSLU11': 'FII Saúde (Hospital)'
};

const extractVal = (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && val !== null && 'raw' in val) {
        return typeof val.raw === 'number' && !isNaN(val.raw) ? val.raw : null;
    }
    if (typeof val === 'number') return isNaN(val) ? null : val;
    return null;
};

const normalizeSector = (ticker, rawSector, type) => {
    const t = ticker.toUpperCase().trim();
    
    // 1. Prioridade: Mapa Mestre Hardcoded
    if (MASTER_SECTOR_MAP[t]) return MASTER_SECTOR_MAP[t];

    // 2. Fallback Inteligente FIIs
    if (type === 'FII') {
        const name = rawSector ? rawSector.toUpperCase() : '';
        if (name.includes('SHOPPING') || name.includes('MALL')) return 'FII Shopping Center';
        if (name.includes('LOGISTICA') || name.includes('GALPAO') || name.includes('LOG')) return 'FII Logística';
        if (name.includes('LAJE') || name.includes('CORP') || name.includes('ESCRITORIO')) return 'FII Laje Corporativa';
        if (name.includes('PAPEL') || name.includes('CRI') || name.includes('RECEBIVEIS')) return 'FII Papel (CRI)';
        if (name.includes('FOF') || name.includes('FUNDO DE FUNDOS')) return 'FII Fundo de Fundos';
        if (name.includes('AGRO') || name.includes('FIAGRO')) return 'Fiagro';
        if (name.includes('HIBRIDO')) return 'FII Híbrido';
        return 'FII Diversos'; 
    }

    // 3. Fallback Inteligente Stocks
    if (type === 'STOCK_US') {
        return rawSector || 'Global';
    }

    if (!rawSector || rawSector === 'Outros' || rawSector.length < 3) return 'Diversos B3';
    return rawSector;
};

export const marketDataService = {
    normalizeSymbol(ticker, type) {
        if (!ticker) return '';
        let t = ticker.toUpperCase().trim();
        return t.endsWith('.SA') ? t : `${t}.SA`;
    },

    async getMarketDataByTicker(ticker) {
        // Fallback: Yahoo Finance Removido. Retorna preço zerado para evitar crash no front.
        return { price: 0, change: 0, name: ticker };
    },

    // --- OBTÉM INDICADORES MACRO (Apenas BCB) ---
    async getMacroIndicators() {
        // Inicializa com valores zerados para os dados de mercado que dependiam do Yahoo
        const indicators = {
            selic: { value: 11.25, name: 'Selic Meta', source: 'BCB' },
            cdi: { value: 11.15, name: 'CDI', source: 'Cetip' },
            ipca: { value: 4.50, name: 'IPCA (12m)', source: 'BCB' },
            ibov: { value: 0, change: 0, name: 'Ibovespa', source: 'B3' },
            usd: { value: 0, change: 0, name: 'Dólar (PTAX)', source: 'B3' },
            spx: { value: 0, change: 0, name: 'S&P 500', source: 'NYSE' },
            btc: { value: 0, change: 0, name: 'Bitcoin', source: 'Global' }
        };

        // 1. API Banco Central (Selic e IPCA) - ISOLADO
        try {
            // Selic Meta (Série 432)
            const selicRes = await axios.get('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json', { timeout: 3000 });
            if (selicRes.data && selicRes.data.length > 0) {
                indicators.selic.value = parseFloat(selicRes.data[0].valor);
                indicators.cdi.value = Math.max(0, indicators.selic.value - 0.10);
            }

            // IPCA Acumulado 12 meses (Série 13522)
            const ipcaRes = await axios.get('https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json', { timeout: 3000 });
            if (ipcaRes.data && ipcaRes.data.length > 0) {
                indicators.ipca.value = parseFloat(ipcaRes.data[0].valor);
            }
        } catch (bcbError) {
            logger.warn(`⚠️ API BCB Falhou: ${bcbError.message}`);
        }

        return indicators;
    },

    async getMarketData(assetClass) {
        try {
            const isBrasil = assetClass === 'STOCK' || assetClass === 'FII' || assetClass === 'BRASIL_10';
            const results = [];
            
            const dbAssets = await MarketAsset.find({ 
                isActive: true,
                type: isBrasil ? { $in: ['STOCK', 'FII'] } : assetClass 
            }).lean();
            
            const dbMap = new Map(dbAssets.map(a => [a.ticker, a]));

            if (isBrasil) {
                let fundDataMap = new Map();

                if (assetClass === 'STOCK' || assetClass === 'BRASIL_10') {
                    const stockMap = await fundamentusService.getStocksMap();
                    if (stockMap) stockMap.forEach((v, k) => fundDataMap.set(k, { ...v, type: 'STOCK' }));
                }
                if (assetClass === 'FII' || assetClass === 'BRASIL_10') {
                    const fiiMap = await fundamentusService.getFIIsMap();
                    if (fiiMap) fiiMap.forEach((v, k) => fundDataMap.set(k, { ...v, type: 'FII' }));
                }

                logger.info(`🔄 Normalizando ${fundDataMap.size} ativos BR com Mapa Mestre...`);

                const uniqueAssets = new Map();

                for (const [ticker, fundData] of fundDataMap) {
                    const currentPrice = fundData.price;
                    const liquidity = fundData.liq2m || fundData.liquidity || 0;

                    if (currentPrice <= 0 || liquidity < 200000) continue;

                    const rootTicker = ticker.substring(0, 4); 
                    
                    if (fundData.type === 'STOCK') {
                        if (uniqueAssets.has(rootTicker)) {
                            const existing = uniqueAssets.get(rootTicker);
                            if (liquidity > existing.liquidity) {
                                uniqueAssets.set(rootTicker, { ...fundData, liquidity });
                            }
                        } else {
                            uniqueAssets.set(rootTicker, { ...fundData, liquidity });
                        }
                    } else {
                        uniqueAssets.set(ticker, { ...fundData, liquidity });
                    }
                }

                for (const fundData of uniqueAssets.values()) {
                    const ticker = fundData.ticker;
                    const dbInfo = dbMap.get(ticker);
                    
                    const finalSector = normalizeSector(ticker, dbInfo?.sector, fundData.type);
                    const finalName = dbInfo?.name || ticker;

                    let grahamPrice = 0;
                    let impliedEPS = fundData.pl > 0 ? fundData.price / fundData.pl : 0; 
                    let impliedBVPS = fundData.pvp > 0 ? fundData.price / fundData.pvp : 0; 
                    if (impliedEPS > 0 && impliedBVPS > 0) {
                        grahamPrice = Math.sqrt(22.5 * impliedEPS * impliedBVPS);
                    }

                    let bazinPrice = 0;
                    if (fundData.dy > 0) {
                        const dpa = fundData.price * (fundData.dy / 100);
                        bazinPrice = dpa / 0.06;
                    }

                    results.push({
                        ticker: ticker,
                        type: fundData.type,
                        name: finalName,
                        sector: finalSector, 
                        price: fundData.price,
                        change: 0, 
                        metrics: {
                            grahamPrice: Number(grahamPrice.toFixed(2)),
                            bazinPrice: Number(bazinPrice.toFixed(2)),
                            pl: fundData.pl,
                            pvp: fundData.pvp,
                            evEbitda: fundData.evEbitda,
                            psr: fundData.psr,
                            earningsYield: fundData.pl > 0 ? (1 / fundData.pl) * 100 : 0,
                            roe: fundData.roe,
                            roic: fundData.roic,
                            netMargin: fundData.netMargin,
                            dy: fundData.dy,
                            currentRatio: fundData.currentRatio,
                            debtToEquity: fundData.divBrutaPatrim || 0,
                            patrimLiq: fundData.patrimLiq, 
                            vacancy: fundData.vacancy || 0,
                            capRate: fundData.capRate || 0,
                            ffoYield: fundData.ffoYield || 0,
                            qtdImoveis: fundData.qtdImoveis || 0,
                            vpCota: fundData.vpCota || 0,
                            marketCap: fundData.marketCap || 0,
                            netDebt: fundData.netDebt || 0,
                            netRevenue: fundData.netRevenue || 0,
                            netIncome: fundData.netIncome || 0,
                            totalAssets: fundData.totalAssets || 0,
                            revenueGrowth: fundData.cresRec5a || 0,
                            avgLiquidity: fundData.liquidity,
                            dataSource: 'Fundamentus'
                        }
                    });
                }

            } else {
                // FLUXO GLOBAL / CRYPTO (YAHOO REMOVIDO)
                // Retorna vazio temporariamente até nova fonte ser implementada
                logger.info(`ℹ️ Coleta para ${assetClass} ignorada (Yahoo Finance removido).`);
                return [];
            }

            return results;
        } catch (error) {
            logger.error(`Erro MarketData: ${error.message}`);
            return [];
        }
    }
};
