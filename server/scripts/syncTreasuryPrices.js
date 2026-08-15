/**
 * Ingestão manual da série de PU do Tesouro Direto (marcação a mercado da RF).
 *
 * Em produção isso roda sozinho (cron 12.1 do schedulerService, dias úteis 18:30).
 * Este script é para primeira carga, backfill mais profundo e diagnóstico.
 *
 * Uso:
 *   npm run sync:treasury              # 8 anos de histórico (padrão)
 *   npm run sync:treasury -- --years=15
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestTreasuryPrices, HISTORY_YEARS } from '../services/treasuryPriceService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const yearsArg = process.argv.find((a) => a.startsWith('--years='));
const years = yearsArg ? Number(yearsArg.split('=')[1]) : HISTORY_YEARS;

const run = async () => {
    if (!process.env.MONGO_URI) {
        console.error('❌ MONGO_URI não definida.');
        process.exit(1);
    }
    if (!Number.isFinite(years) || years <= 0) {
        console.error(`❌ --years inválido: ${yearsArg}`);
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`🏛️  Baixando CSV oficial do Tesouro Transparente (${years} ano(s) de histórico)...`);

    const result = await ingestTreasuryPrices({ years, force: true });

    if (!result.ok) {
        console.error(`❌ Ingestão falhou: ${result.reason}`);
        await mongoose.disconnect();
        process.exit(1);
    }

    console.log(`✅ ${result.titles} título(s), ${result.points} ponto(s) de PU. Última Data Base: ${result.lastBase}`);
    if (result.suspicious.length > 0) {
        console.log(`\n⚠️  ${result.suspicious.length} título(s) com salto diário atípico (>20%) — mantidos, mas vale conferir:`);
        for (const s of result.suspicious) {
            console.log(`   ${s.titleKey}: ${s.moves.map((m) => `${m.date} ${m.move}%`).join(', ')}`);
        }
    }

    await mongoose.disconnect();
    process.exit(0);
};

run().catch(async (error) => {
    console.error(`❌ Erro fatal: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
