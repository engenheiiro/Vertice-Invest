
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import SystemConfig from '../models/SystemConfig.js';
import { SECTOR_OVERRIDES } from '../config/sectorOverrides.js'; // Importa a fonte da verdade

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// --- DADOS HARDCODED ORIGINAIS ---
const BLACKLIST = ['AMER3', 'OIBR3', 'LIGT3', 'RCSL3', 'PCAR3', 'RSID3', 'AZEV4', 'TCNO4', 'DASA3', 'SEQL3'];
const IGNORED_TICKERS = ['ISAE4', 'PLAG11', 'FIGS11', 'MOTV3', 'AUAU3', 'OBTC3', 'AZTE3', 'AXIA3', 'AMOB3', 'TOKY3'];
const FII_TIER_1 = ['HGLG11', 'KNRI11', 'BTLG11', 'ALZR11', 'HGBS11', 'XPML11', 'VISC11', 'PVBI11', 'HGRU11', 'TRXF11', 'KNCR11', 'HGCR11', 'KNSC11', 'CPTS11', 'BTHF11'];

const runMigration = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("📡 Conectado ao MongoDB...");

        // 1. Migrar Configurações Macro (SystemConfig)
        console.log("⚙️  Atualizando SystemConfig (Macro)...");
        await SystemConfig.findOneAndUpdate(
            { key: 'MACRO_INDICATORS' },
            {
                selic: 10.00,
                ipca: 1.00,
                cdi: 10.00,
                riskFree: 11.25,
                ntnbLong: 6.30,
                dollar: 5.75
            },
            { upsert: true, new: true }
        );

        // 2. Atualizar MarketAssets com Flags e Setores CENTRALIZADOS
        console.log("📊 Atualizando Assets (Baseado em server/config/sectorOverrides.js)...");
        
        // Loop de Setores (Usando o objeto importado)
        const promises = Object.entries(SECTOR_OVERRIDES).map(async ([ticker, sector]) => {
            return MarketAsset.findOneAndUpdate(
                { ticker: ticker },
                { $set: { sector: sector } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).then(() => {
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
