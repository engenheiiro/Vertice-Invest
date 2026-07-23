
/**
 * Reparo de campo `name` corrompido em MarketAsset.
 *
 * Contexto: em runs antigos do sync de fundamentals US, o `name` da empresa era
 * lido do módulo `assetProfile` do Yahoo — que NÃO tem longName e sim o nome de um
 * EXECUTIVO (companyOfficers). Resultado: HOLX ficou "Mr. Paul Malenchini", SEE
 * ficou "Mr. Dustin J. Semach". O código atual já lê de `price.longName`
 * (usStocksFundamentalsService.js), então isto é LIXO LEGADO: só é sobrescrito num
 * fetch de fundamentals bem-sucedido, e esses tickers vêm falhando ("Quote not
 * found"), então o nome ruim persiste indefinidamente.
 *
 * Estratégia: detectar nomes que começam com TÍTULO PESSOAL (Mr./Mrs./Ms./Dr./Sr.…)
 * — alta precisão, empresas praticamente nunca começam assim — e resetar para o
 * próprio ticker (placeholder neutro que a UI já tolera; vários ativos já vivem
 * assim: CFLT, EXAS). No próximo fetch de fundamentals bem-sucedido, o longName
 * correto sobrescreve.
 *
 * Segurança:
 *   - DRY-RUN por padrão. Só grava com --apply.
 *   - Idempotente: só toca em docs cujo name casa o padrão de título pessoal.
 *   - Não apaga histórico nem posições — só o rótulo `name`.
 *
 * Uso:
 *   node server/scripts/repairCorruptedNames.js                 # dry-run
 *   node server/scripts/repairCorruptedNames.js --apply         # grava
 *   node server/scripts/repairCorruptedNames.js --tickers=HOLX,SEE --apply
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const tickersArg = args.find(a => a.startsWith('--tickers='));
const explicitTickers = tickersArg
    ? tickersArg.replace('--tickers=', '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
    : null;

// Título pessoal no início do nome → executivo vazado no campo da empresa.
const PERSONAL_TITLE_RE = /^\s*(mr|mrs|ms|mx|dr|sr|sra|prof|miss)\.?\s+/i;

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`\n🩹 Reparo de nomes corrompidos ${apply ? '(APLICANDO)' : '(DRY-RUN — nada será gravado)'}\n`);

        const baseQuery = explicitTickers ? { ticker: { $in: explicitTickers } } : {};
        const docs = await MarketAsset.find(baseQuery).select('ticker name type').lean();

        // Com --tickers explícito, repara mesmo sem casar o regex (alvo manual);
        // sem alvo, só os que casam o padrão de título pessoal.
        const corrupted = docs.filter(d =>
            explicitTickers ? true : (typeof d.name === 'string' && PERSONAL_TITLE_RE.test(d.name)),
        );

        if (corrupted.length === 0) {
            console.log('✅ Nenhum nome corrompido encontrado — nada a fazer.');
            process.exit(0);
        }

        console.log(`🔎 ${corrupted.length} ativo(s) com nome suspeito:`);
        for (const a of corrupted) {
            console.log(`   • ${a.ticker.padEnd(8)} [${a.type}] "${a.name}"  →  "${a.ticker}"`);
        }

        if (apply) {
            const ops = corrupted.map(a => ({
                updateOne: { filter: { ticker: a.ticker }, update: { $set: { name: a.ticker } } },
            }));
            const res = await MarketAsset.bulkWrite(ops);
            console.log(`\n✅ ${res.modifiedCount} nome(s) resetado(s) para o ticker.`);
            console.log('📌 O longName correto volta no próximo fetch de fundamentals bem-sucedido.');
        } else {
            console.log(`\nℹ️  DRY-RUN: rode com --apply para resetar os ${corrupted.length} acima.`);
        }
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
};

run();
