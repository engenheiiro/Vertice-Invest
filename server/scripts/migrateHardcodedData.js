
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js'; // Importado
import AssetTransaction from '../models/AssetTransaction.js'; // Importado
import AssetHistory from '../models/AssetHistory.js'; // Importado
import SystemConfig from '../models/SystemConfig.js';
import { SECTOR_OVERRIDES } from '../config/sectorOverrides.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BLACKLIST = ['AMER3', 'OIBR3', 'LIGT3', 'RCSL3', 'PCAR3', 'RSID3', 'AZEV4', 'TCNO4', 'DASA3', 'SEQL3'];
const IGNORED_TICKERS = ['ISAE4', 'PLAG11', 'FIGS11', 'MOTV3', 'AUAU3', 'OBTC3', 'AZTE3', 'AXIA3', 'AMOB3', 'TOKY3', 'SNLG11'];
const FII_TIER_1 = ['HGLG11', 'KNRI11', 'BTLG11', 'ALZR11', 'HGBS11', 'XPML11', 'VISC11', 'PVBI11', 'HGRU11', 'TRXF11', 'KNCR11', 'HGCR11', 'KNSC11', 'CPTS11', 'BTHF11'];

const FIX_TYPOS = {
    'CPLEE5': 'CPLE6',
    'AZULL4': 'AZUL4',
    'CVBII11': 'CVBI11',
    'MALLL11': 'MALL11',
    'QAGRR11': 'QAGR11',
    'JPSA3': 'IGTI3',
    'BPAN4': 'BPAN4', // Auto-correção caso haja duplicidade oculta
    'B3SA3': 'B3SA3'
};

const runMigration = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("📡 Conectado ao MongoDB...");

        // 1. SystemConfig
        console.log("⚙️  Atualizando Macro Config...");
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

        // 2. Setores e Flags
        console.log("📊 Atualizando Flags e Setores...");
        const promises = Object.entries(SECTOR_OVERRIDES).map(async ([ticker, sector]) => {
            return MarketAsset.findOneAndUpdate(
                { ticker: ticker },
                { $set: { sector: sector } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        });
        await Promise.all(promises);

        await MarketAsset.updateMany({ ticker: { $in: BLACKLIST } }, { $set: { isBlacklisted: true } });
        await MarketAsset.updateMany({ ticker: { $in: IGNORED_TICKERS } }, { $set: { isIgnored: true } });
        await MarketAsset.updateMany({ ticker: { $in: FII_TIER_1 } }, { $set: { isTier1: true } });

        // 3. Correção de Typos (Com Migração de Dados de Usuário)
        console.log("🔧 Corrigindo Tickers e Migrando Histórico de Usuários...");
        
        for (const [wrong, correct] of Object.entries(FIX_TYPOS)) {
            if (wrong === correct) continue; // Pula se for o mesmo (sanity check)

            console.log(`Processing ${wrong} -> ${correct}`);

            // A. Migrar Ativos dos Usuários (Carteira)
            // Se o usuário tem CPLEE5, vira CPLE6.
            // Se já tiver CPLE6, pode dar erro de duplicidade, então usamos catch.
            try {
                const resAssets = await UserAsset.updateMany(
                    { ticker: wrong }, 
                    { $set: { ticker: correct } }
                );
                if (resAssets.modifiedCount > 0) console.log(`   - ${resAssets.modifiedCount} carteiras migradas.`);
            } catch (e) {
                console.log(`   - Aviso: Alguns usuários já possuíam ${correct}, fusão manual necessária se houver duplicata.`);
            }

            // B. Migrar Transações (Histórico)
            const resTxs = await AssetTransaction.updateMany(
                { ticker: wrong },
                { $set: { ticker: correct } }
            );
            if (resTxs.modifiedCount > 0) console.log(`   - ${resTxs.modifiedCount} transações corrigidas.`);

            // C. Corrigir MarketAsset (Dados de Mercado)
            const wrongAsset = await MarketAsset.findOne({ ticker: wrong });
            const correctAsset = await MarketAsset.findOne({ ticker: correct });

            if (wrongAsset) {
                if (correctAsset) {
                    // Se o correto já existe, apenas apagamos o errado (já que migramos os usuários acima)
                    console.log(`   - Deletando MarketAsset duplicado/errado: ${wrong}`);
                    await MarketAsset.deleteOne({ _id: wrongAsset._id });
                    
                    // Opcional: Copiar dados do errado para o certo se o certo estiver vazio? 
                    // Melhor não, deixamos o Sync preencher o certo.
                } else {
                    // Se o correto não existe, renomeamos o errado para o correto
                    console.log(`   - Renomeando MarketAsset: ${wrong} -> ${correct}`);
                    wrongAsset.ticker = correct;
                    wrongAsset.name = wrongAsset.name.replace(wrong, correct);
                    await wrongAsset.save();
                }
            }
            
            // D. Limpar Histórico de Preços Cacheado Antigo
            await AssetHistory.deleteOne({ ticker: wrong });
        }

        console.log("✅ Migração e Limpeza concluídas.");
        process.exit(0);

    } catch (error) {
        console.error("❌ Erro na migração:", error);
        process.exit(1);
    }
};

runMigration();
