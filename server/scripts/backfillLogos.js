
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import { logoService } from '../services/logoService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Pré-aquece o cache de logos (AssetLogo) para os ativos conhecidos, em vez de
// esperar a busca "lazy" da primeira requisição de cada ticker.
//
// Uso:
//   node server/scripts/backfillLogos.js   (todos os tipos com fonte de logo)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🖼️  Conectado ao MongoDB. Backfill de logos...');

        // Apenas tipos que têm fonte de CDN (FII/renda fixa/caixa não têm).
        const assets = await MarketAsset.find({
            type: { $in: ['STOCK', 'STOCK_US', 'CRYPTO'] },
        }).select('ticker type').lean();

        console.log(`📦 ${assets.length} ativos a processar.\n`);

        let ok = 0;
        let missing = 0;
        for (const a of assets) {
            const logo = await logoService.getOrFetch(a.ticker, a.type);
            if (logo) {
                ok++;
            } else {
                missing++;
            }
            // Throttle leve para não martelar as CDNs.
            await sleep(120);
        }

        console.log(`\n✅ Backfill concluído. OK: ${ok} | Sem logo: ${missing}`);
    } catch (err) {
        console.error('❌ Falha no backfill de logos:', err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
};

run();
