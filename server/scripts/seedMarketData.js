
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import { SECTOR_OVERRIDES } from '../config/sectorOverrides.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });


const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("🌱 Conectado ao MongoDB para Seed...");

        console.log("🧹 Limpando coleção antiga de ativos...");
        await MarketAsset.deleteMany({});
        console.log("✅ Coleção limpa.");

        // Construir lista de ativos baseada no SECTOR_OVERRIDES
        const assetsToCreate = [];
        
        // 1. Adicionar ativos do Overrides (Garante que tudo que configuramos existe)
        Object.entries(SECTOR_OVERRIDES).forEach(([ticker, sector]) => {
            let type = 'STOCK';
            // Lógica simples para inferir tipo baseada no ticker (pode refinar se quiser)
            if (ticker.endsWith('11') || ticker.endsWith('11B')) type = 'FII'; 
            // Exceções conhecidas de Ações com final 11
            if (['TAEE11', 'ALUP11', 'KLBN11', 'SANB11', 'SAPR11', 'ENGI11', 'BPAC11'].includes(ticker)) type = 'STOCK';

            assetsToCreate.push({
                ticker,
                name: ticker,
                type,
                sector: sector, // Já insere com o setor correto
                currency: 'BRL'
            });
        });

        // 2. Adicionar Crypto e US Stocks (que não estão no Overrides geralmente)
        const extras = [
            { ticker: 'BTC', name: 'Bitcoin', type: 'CRYPTO', currency: 'USD', sector: 'Blockchain' },
            { ticker: 'ETH', name: 'Ethereum', type: 'CRYPTO', currency: 'USD', sector: 'Smart Contracts' },
            { ticker: 'AAPL', name: 'Apple', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' },
            { ticker: 'NVDA', name: 'NVIDIA', type: 'STOCK_US', currency: 'USD', sector: 'Tecnologia' }
        ];
        assetsToCreate.push(...extras);

        // Remove duplicatas (caso haja overlap)
        const uniqueAssets = Array.from(new Map(assetsToCreate.map(item => [item.ticker, item])).values());

        // Inserção em batch
        await MarketAsset.insertMany(uniqueAssets);
        
        console.log(`\n✅ Base de dados recriada com ${uniqueAssets.length} ativos.`);
        console.log("👉 Setores sincronizados com server/config/sectorOverrides.js");
        process.exit(0);
    } catch (e) {
        console.error("Erro no seed:", e);
        process.exit(1);
    }
};

seed();
