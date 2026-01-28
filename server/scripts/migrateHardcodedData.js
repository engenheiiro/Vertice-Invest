
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// --- DADOS HARDCODED ORIGINAIS ---
const BLACKLIST = ['AMER3', 'OIBR3', 'LIGT3', 'RCSL3', 'PCAR3', 'RSID3', 'AZEV4', 'TCNO4', 'DASA3', 'SEQL3'];
const IGNORED_TICKERS = ['ISAE4', 'PLAG11', 'FIGS11', 'MOTV3', 'AUAU3', 'OBTC3', 'AZTE3', 'AXIA3', 'AMOB3', 'TOKY3'];
const FII_TIER_1 = ['HGLG11', 'KNRI11', 'BTLG11', 'ALZR11', 'HGBS11', 'XPML11', 'VISC11', 'PVBI11', 'HGRU11', 'TRXF11', 'KNCR11', 'HGCR11', 'KNSC11', 'CPTS11', 'BTHF11'];

// SECTOR OVERRIDES (Resumido para o exemplo, mas o script real deve conter a lista completa que estava no marketDataService)
// IMPORTANTE: Ao rodar, certifique-se que esta lista reflete o arquivo original
const SECTOR_OVERRIDES = {
// FIIs
    'CPSH11': 'Shoppings', 'GGRC11': 'Logística', 'TRXF11': 'Renda Urbana', 'VISC11': 'Shoppings', 'HTMX11': 'Hotéis',
    'PLAG11': 'Fiagro', 'RZAT11': 'Híbrido', 'TJKB11': 'Híbrido', 'ALZR11': 'Híbrido', 'BTHF11': 'Papel',
    'GARE11': 'Híbrido', 'HGCR11': 'Papel', 'KNCR11': 'Papel', 'KNHY11': 'Papel', 'KNIP11': 'Infraestrutura',
    'KNSC11': 'Papel', 'KNUQ11': 'Papel', 'MCCI11': 'Papel', 'MXRF11': 'Híbrido', 'PCIP11': 'Papel',
    'PSEC11': 'Papel', 'RBRR11': 'Papel', 'RBRY11': 'Papel', 'TGAR11': 'Desenvolvimento', 'VGIR11': 'Papel',
    'KNCA11': 'Papel', 'KNHF11': 'Híbrido', 'AFHI11': 'Papel', 'AZPL11': 'Logística', 'BBFO11': 'Fundo de Fundos',
    'BCIA11': 'Fundo de Fundos', 'BRCO11': 'Logística', 'BTCI11': 'Papel', 'BTLG11': 'Logística', 'CLIN11': 'Papel',
    'FGAA11': 'Fiagro', 'GAME11': 'Papel', 'GRUL11': 'Logística', 'HGBS11': 'Shoppings', 'HGLG11': 'Logística',
    'HGRU11': 'Renda Urbana', 'HSAF11': 'Papel', 'HSML11': 'Shoppings', 'ICRI11': 'Papel', 'ITRI11': 'Papel',
    'JSAF11': 'Fundo de Fundos', 'JSCR11': 'Papel', 'KCRE11': 'Papel', 'KFOF11': 'Fundo de Fundos', 'KISU11': 'Fundo de Fundos',
    'KNRI11': 'Híbrido', 'LIFE11': 'Fundo de Fundos', 'LVBI11': 'Logística', 'MANA11': 'Papel', 'PMIS11': 'Papel',
    'PORD11': 'Papel', 'RINV11': 'Híbrido', 'RPRI11': 'Papel', 'RRCI11': 'Papel', 'RZAK11': 'Papel',
    'RZLC11': 'Logística', 'SAPI11': 'Papel', 'SNFF11': 'Fundo de Fundos', 'SNME11': 'Multiestratégia', 'SPXS11': 'Papel',
    'TEPP11': 'Lajes Corporativas', 'TMPS11': 'Fundo de Fundos', 'VCJR11': 'Papel', 'VGIP11': 'Papel', 'VGRI11': 'Papel',
    'VILG11': 'Logística', 'VRTA11': 'Papel', 'XPCI11': 'Papel', 'XPLG11': 'Logística', 'XPML11': 'Shoppings',
    'AAZQ11': 'Fiagro', 'CPTR11': 'Fiagro', 'CRAA11': 'Fiagro', 'EGAF11': 'Fiagro', 'LSOP11': 'Hotéis',
    'NEWL11': 'Híbrido', 'RBRL11': 'Logística', 'RBVA11': 'Renda Urbana', 'RURA11': 'Fiagro', 'RZAG11': 'Fiagro',
    'SNFZ11': 'Fiagro', 'TVRI11': 'Papel', 'VGIA11': 'Fiagro', 'XPCA11': 'Fiagro', 'FATN11': 'Papel',
    'BTAL11': 'Fiagro', 'CXCO11': 'Lajes Corporativas', 'FIIP11': 'Logística', 'LASC11': 'Shoppings', 'VRTM11': 'Papel',
    'CPOF11': 'Lajes Corporativas', 'FIIB11': 'Logística', 'HSLG11': 'Logística', 'HSRE11': 'Híbrido', 'CPTS11': 'Papel',
    'CVBI11': 'Papel', 'GSFI11': 'Shoppings', 'RBRX11': 'Híbrido', 'TRXB11': 'Renda Urbana', 'ALZC11': 'Papel',
    'BBGO11': 'Fiagro', 'BCRI11': 'Papel', 'GTWR11': 'Lajes Corporativas', 'MFII11': 'Desenvolvimento', 'OUJP11': 'Papel',
    'RVBI11': 'Fundo de Fundos', 'XPSF11': 'Fundo de Fundos', 'RZTR11': 'Fiagro', 'ARRI11': 'Papel', 'CXRI11': 'Fundo de Fundos',
    'KIVO11': 'Papel', 'KOPA11': 'Híbrido', 'MCLO11': 'Lajes Corporativas', 'RBFF11': 'Fundo de Fundos', 'RBHG11': 'Híbrido',
    'RELG11': 'Logística', 'SMRE11': 'Multiestratégia', 'AGRX11': 'Fiagro', 'BICE11': 'Papel', 'PQAG11': 'Fiagro',
    'RBIR11': 'Papel', 'SNAG11': 'Fiagro', 'SNCI11': 'Papel', 'SNEL11': 'Infraestrutura', 'WHGR11': 'Híbrido',
    'BRCR11': 'Lajes Corporativas', 'JSRE11': 'Lajes Corporativas', 'RECT11': 'Lajes Corporativas', 'VINO11': 'Lajes Corporativas', 'VIUR11': 'Renda Urbana',
    'XPIN11': 'Logística', 'CACR11': 'Papel', 'HBCR11': 'Papel', 'MALL11': 'Shoppings', 'TRBL11': 'Logística',
    'AIEC11': 'Lajes Corporativas', 'CPUR11': 'Desenvolvimento', 'HGBL11': 'Logística', 'JGPX11': 'Papel', 'MGHT11': 'Hotéis',
    'VCRA11': 'Papel', 'AJFI11': 'Lajes Corporativas', 'HGRE11': 'Lajes Corporativas', 'ICNE11': 'Lajes Corporativas', 'IRIM11': 'Papel',
    'NEXG11': 'Papel', 'PNDL11': 'Papel', 'RCRB11': 'Lajes Corporativas', 'BBIG11': 'Lajes Corporativas', 'BPML11': 'Shoppings',
    'FIGS11': 'Shoppings', 'INLG11': 'Híbrido', 'TOPP11': 'Papel', 'RECR11': 'Papel', 'HABT11': 'Papel',
    'VGHF11': 'Híbrido', 'BTRA11': 'Fiagro', 'HPDP11': 'Shoppings', 'PATL11': 'Logística', 'GZIT11': 'Shoppings',
    'OULG11': 'Lajes Corporativas', 'PATC11': 'Lajes Corporativas', 'PVBI11': 'Lajes Corporativas', 'CPLG11': 'Logística', 'NSLU11': 'Saúde',
    'BLCA11': 'Lajes Corporativas', 'MCRE11': 'Papel', 'RBRP11': 'Lajes Corporativas', 'BROF11': 'Lajes Corporativas', 'KORE11': 'Papel',
    'CCME11': 'Lajes Corporativas', 'HOFC11': 'Lajes Corporativas', 'VCRR11': 'Papel', 'DEVA11': 'Papel', 'HCTR11': 'Papel',
    'URPR11': 'Papel', 'PQDP11': 'Shoppings', 'CNES11': 'Lajes Corporativas', 'VXXV11': 'Papel',

    // AÇÕES
    'RANI3': 'Papel e Celulose', 'CEAB3': 'Varejo', 'COGN3': 'Educação', 'VTRU3': 'Educação', 'LAVV3': 'Construção Civil',
    'TAEE11': 'Elétricas', 'TGMA3': 'Logística', 'CAMB3': 'Varejo', 'PSSA3': 'Seguros', 'GMAT3': 'Varejo',
    'SAPR11': 'Saneamento', 'ISAE4': 'Elétricas', 'BLAU3': 'Saúde', 'EZTC3': 'Construção Civil', 'MDNE3': 'Construção Civil',
    'INTB3': 'Tecnologia', 'PRIO3': 'Petróleo', 'CASH3': 'Tecnologia', 'DIRR3': 'Construção Civil', 'LREN3': 'Varejo',
    'VIVA3': 'Varejo', 'ODPV3': 'Saúde', 'LOGG3': 'Logística', 'POMO4': 'Indústria', 'AZZA3': 'Varejo',
    'WIZC3': 'Seguros', 'ALOS3': 'Shoppings', 'TECN3': 'Tecnologia', 'VLID3': 'Tecnologia', 'FIQE3': 'Telecom',
    'ABEV3': 'Bebidas', 'CSUD3': 'Tecnologia', 'MULT3': 'Shoppings', 'PLPL3': 'Construção Civil', 'MDIA3': 'Alimentos',
    'PETR4': 'Petróleo', 'KEPL3': 'Indústria', 'IGTI11': 'Shoppings', 'BMOB3': 'Tecnologia', 'TFCO4': 'Varejo',
    'RECV3': 'Petróleo', 'CYRE3': 'Construção Civil', 'VALE3': 'Mineração', 'SBSP3': 'Saneamento', 'JHSF3': 'Construção Civil',
    'LEVE3': 'Indústria', 'CEBR6': 'Elétricas', 'MILS3': 'Indústria', 'B3SA3': 'Financeiro', 'DEXP3': 'Materiais Básicos',
    'EUCA4': 'Materiais Básicos', 'TEND3': 'Construção Civil', 'ITSA4': 'Bancos', 'ALUP11': 'Elétricas', 'EMAE4': 'Elétricas',
    'IRBR3': 'Seguros', 'CURY3': 'Construção Civil', 'CMIG4': 'Elétricas', 'FESA4': 'Siderurgia', 'ANIM3': 'Educação',
    'CSMG3': 'Saneamento', 'FLRY3': 'Saúde', 'WEGE3': 'Indústria', 'BRAV3': 'Petróleo', 'ALPA4': 'Varejo',
    'LPSB3': 'Imobiliário', 'PORT3': 'Logística', 'CMIN3': 'Mineração', 'NEOE3': 'Elétricas', 'ABCB4': 'Bancos',
    'ENGI11': 'Elétricas', 'SEER3': 'Educação', 'SLCE3': 'Agro', 'YDUQ3': 'Educação', 'VIVT3': 'Telecom',
    'TOTS3': 'Tecnologia', 'LIGT3': 'Elétricas', 'TTEN3': 'Agro', 'SBFG3': 'Varejo', 'SOJA3': 'Agro',
    'TRIS3': 'Construção Civil', 'CSED3': 'Educação', 'RDOR3': 'Saúde', 'TIMS3': 'Telecom', 'BRSR6': 'Bancos',
    'ITUB4': 'Bancos', 'SMTO3': 'Agro', 'VITT3': 'Agro', 'MOVI3': 'Logística', 'RADL3': 'Varejo',
    'ETER3': 'Materiais Básicos', 'SMFT3': 'Saúde', 'BRAP4': 'Mineração', 'CPFE3': 'Elétricas', 'AZUL4': 'Transporte',
    'EVEN3': 'Construção Civil', 'MBRF3': 'Alimentos', 'GGPS3': 'Serviços', 'BBAS3': 'Bancos', 'ECOR3': 'Infraestrutura',
    'EQTL3': 'Elétricas', 'BAZA3': 'Bancos', 'CGRA4': 'Varejo', 'MTRE3': 'Construção Civil', 'UGPA3': 'Petróleo',
    'BBSE3': 'Seguros', 'SUZB3': 'Papel e Celulose', 'FRAS3': 'Indústria', 'SHUL4': 'Indústria', 'CLSC4': 'Elétricas',
    'COCE5': 'Elétricas', 'ASAI3': 'Varejo', 'EGIE3': 'Elétricas', 'GOAU4': 'Siderurgia', 'DESK3': 'Telecom',
    'BBDC4': 'Bancos', 'SANB11': 'Bancos', 'UNIP6': 'Química', 'CXSE3': 'Seguros', 'CPLE3': 'Elétricas',
    'RENT3': 'Logística', 'MYPK3': 'Indústria', 'HBOR3': 'Construção Civil', 'PFRM3': 'Varejo', 'DMVF3': 'Varejo',
    'BPAC11': 'Bancos', 'HYPE3': 'Saúde', 'BMGB4': 'Bancos', 'GGBR4': 'Siderurgia', 'KLBN11': 'Papel e Celulose',
    'PETZ3': 'Varejo', 'CAML3': 'Alimentos', 'PGMN3': 'Varejo', 'VAMO3': 'Logística', 'BMEB4': 'Bancos',
    'PINE4': 'Bancos', 'MGLU3': 'Varejo', 'MATD3': 'Saúde', 'RAPT4': 'Indústria', 'ENEV3': 'Elétricas',
    'EMBJ3': 'Indústria', 'ORVR3': 'Saneamento', 'ROMI3': 'Indústria', 'RAIL3': 'Logística', 'PNVL3': 'Varejo',
    'JPSA3': 'Shoppings', 'BRST3': 'Telecom', 'TASA4': 'Indústria', 'ARML3': 'Serviços', 'BRBI11': 'Bancos',
    'PRNR3': 'Indústria', 'VBBR3': 'Petróleo', 'ESPA3': 'Varejo', 'LOGN3': 'Logística', 'ALPK3': 'Infraestrutura',
    'BPAN4': 'Bancos', 'QUAL3': 'Saúde', 'OPCT3': 'Logística', 'CBAV3': 'Mineração', 'DXCO3': 'Materiais Básicos',
    'ALLD3': 'Varejo', 'VULC3': 'Varejo', 'GRND3': 'Varejo', 'SYNE3': 'Construção Civil', 'MELK3': 'Construção Civil',
    'GUAR3': 'Varejo', 'JSLG3': 'Logística', 'HBRE3': 'Construção Civil', 'POSI3': 'Tecnologia', 'AURA33': 'Mineração',
    'AGRO3': 'Agro', 'LAND3': 'Agro', 'HBSA3': 'Logística', 'MLAS3': 'Tecnologia', 'HAPV3': 'Saúde',
    'CVCB3': 'Varejo', 'SCAR3': 'Indústria', 'BIOM3': 'Saúde', 'TUPY3': 'Indústria', 'NGRD3': 'Tecnologia',
    'JALL3': 'Agro', 'ENJU3': 'Varejo', 'LWSA3': 'Tecnologia', 'AURE3': 'Elétricas', 'CSNA3': 'Siderurgia',
    'RCSL4': 'Indústria', 'AALR3': 'Saúde', 'SIMH3': 'Logística', 'NATU3': 'Varejo', 'BEEF3': 'Alimentos',
    'LUPA3': 'Indústria', 'DASA3': 'Saúde', 'LJQQ3': 'Varejo', 'MRVE3': 'Construção Civil', 'TPIS3': 'Logística',
    'PTBL3': 'Materiais Básicos', 'USIM5': 'Siderurgia', 'MEAL3': 'Alimentos', 'AMBP3': 'Saneamento', 'CSAN3': 'Petróleo',
    'GFSA3': 'Construção Civil', 'BRKM5': 'Química', 'BHIA3': 'Varejo', 'PCAR3': 'Varejo', 'AMER3': 'Varejo',
    'ONCO3': 'Saúde', 'RAIZ4': 'Petróleo', 'SHOW3': 'Varejo', 'VVEO3': 'Logística', 'IFCM3': 'Tecnologia',
    'AZEV4': 'Construção Civil', 'AERI3': 'Indústria', 'PMAM3': 'Indústria', 'PDGR3': 'Construção Civil', 'OIBR3': 'Telecom',
    'SEQL3': 'Logística'
};

const runMigration = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("📡 Conectado ao MongoDB...");

        // 1. Migrar Configurações Macro (SystemConfig)
        console.log("⚙️  Atualizando SystemConfig (Macro)...");
        await SystemConfig.findOneAndUpdate(
            { key: 'MACRO_INDICATORS' },
            {
                selic: 11.25,
                ipca: 4.50,
                cdi: 11.15,
                riskFree: 11.25,
                ntnbLong: 6.30,
                dollar: 5.75
            },
            { upsert: true, new: true }
        );

        // 2. Atualizar MarketAssets com Flags
        console.log("📊 Atualizando Assets (Flags, Setores)...");
        
        // Loop de Setores
        const promises = Object.entries(SECTOR_OVERRIDES).map(async ([ticker, sector]) => {
            return MarketAsset.findOneAndUpdate(
                { ticker: ticker },
                { $set: { sector: sector } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).then(() => {
                // Se o ativo não existia, criamos com nome = ticker.
                // Idealmente, o scraper já populou, mas isso garante.
                process.stdout.write(".");
            });
        });
        
        await Promise.all(promises);
        console.log("\n✅ Setores atualizados.");

        // Loop Blacklist
        await MarketAsset.updateMany(
            { ticker: { $in: BLACKLIST } },
            { $set: { isBlacklisted: true } }
        );
        console.log("✅ Blacklist persistida.");

        // Loop Ignorados
        await MarketAsset.updateMany(
            { ticker: { $in: IGNORED_TICKERS } },
            { $set: { isIgnored: true } }
        );
        console.log("✅ Ignorados persistidos.");

        // Loop Tier 1
        await MarketAsset.updateMany(
            { ticker: { $in: FII_TIER_1 } },
            { $set: { isTier1: true } }
        );
        console.log("✅ FIIs Tier 1 persistidos.");

        console.log("🎉 Migração Completa!");
        process.exit(0);

    } catch (error) {
        console.error("❌ Erro na migração:", error);
        process.exit(1);
    }
};

runMigration();
