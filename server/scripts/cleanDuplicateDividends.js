/**
 * Remove DividendEvent duplicados e normaliza todos para a identidade canônica
 * (ticker + ex-date à meia-noite UTC + type). Também migra o índice único antigo
 * {ticker,date,amount} → {ticker,date,type}.
 *
 * PORQUÊ: o mesmo provento mensal volta de fontes diferentes (Yahoo/Brapi/
 * Fundamentus) com hora distinta (00:00Z vs 13:00Z) E valor levemente diferente
 * (ex.: 0.109829 vs 0.109744). O índice antigo incluía o VALOR na chave, então
 * NÃO unia os dois → dois eventos por mês → soma de proventos DOBRADA (inflando
 * Prov. Acumulados, Lucro Total e o % no card Patrimônio Líquido). A correção:
 * o valor sai da identidade — mesmo ticker + mesma ex-date = mesmo provento.
 *
 * O script:
 *   1) agrupa por (ticker, ex-date dia, type);
 *   2) em grupos com >1, mantém o registro mais autoritativo (com paymentDate;
 *      desempate por createdAt mais recente) e apaga os demais;
 *   3) normaliza data (meia-noite UTC) e valor (arredondado) do sobrevivente;
 *   4) migra o índice único para {ticker,date,type} (fora do dry-run);
 *   5) opcionalmente reconstrói o histórico das contas afetadas (--rebuild).
 *
 * Uso:
 *   node scripts/cleanDuplicateDividends.js --dry-run          (só relatório)
 *   node scripts/cleanDuplicateDividends.js                    (aplica + migra índice)
 *   node scripts/cleanDuplicateDividends.js --ticker=MXRF11    (um ticker só, sem migrar índice)
 *   node scripts/cleanDuplicateDividends.js --rebuild          (aplica + rebuild histórico)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import DividendEvent from '../models/DividendEvent.js';
import AssetTransaction from '../models/AssetTransaction.js';
import { financialService } from '../services/financialService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const canonDate = (d) => financialService.normalizeDividendDate(d);
const canonAmount = (a) => financialService.roundDividendAmount(a);
const sameDate = (a, b) => new Date(a).getTime() === new Date(b).getTime();

// Mais autoritativo: tem paymentDate? então o mais recente. O escolhido fica
// em [0] após a ordenação.
const pickSurvivor = (events) =>
    [...events].sort((a, b) => {
        const ap = a.paymentDate ? 1 : 0;
        const bp = b.paymentDate ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

const run = async () => {
    const isDryRun = process.argv.includes('--dry-run');
    const doRebuild = process.argv.includes('--rebuild');
    const tickerArg = process.argv.find((a) => a.startsWith('--ticker='));
    const onlyTicker = tickerArg ? tickerArg.split('=')[1].toUpperCase() : null;

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`📡 Conectado ao MongoDB${isDryRun ? '  [DRY-RUN — nada será alterado]' : ''}\n`);

        const tickers = onlyTicker ? [onlyTicker] : await DividendEvent.distinct('ticker');

        let totalGroups = 0;
        let totalDuplicates = 0;
        let totalNormalized = 0;
        const affectedTickers = new Set();

        for (const ticker of tickers) {
            const events = await DividendEvent.find({ ticker }).sort({ date: 1, _id: 1 }).lean();
            if (events.length === 0) continue;

            // Agrupa por identidade canônica (ticker já é fixo): dia UTC + type.
            const groups = new Map();
            for (const ev of events) {
                const key = `${canonDate(ev.date).getTime()}|${ev.type || 'DIVIDEND'}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(ev);
            }

            const idsToDelete = [];
            const survivorsToNormalize = [];

            for (const groupEvents of groups.values()) {
                const [keep, ...extras] = pickSurvivor(groupEvents);
                if (extras.length > 0) {
                    totalGroups++;
                    totalDuplicates += extras.length;
                    affectedTickers.add(ticker);
                    extras.forEach((e) => idsToDelete.push(e._id));
                }
                const cd = canonDate(keep.date);
                const ca = canonAmount(keep.amount);
                if (!sameDate(keep.date, cd) || keep.amount !== ca) {
                    survivorsToNormalize.push({ _id: keep._id, date: cd, amount: ca });
                    totalNormalized++;
                    affectedTickers.add(ticker);
                }
            }

            if (idsToDelete.length > 0 || survivorsToNormalize.length > 0) {
                console.log(
                    `• ${ticker.padEnd(8)} ${events.length} eventos → ` +
                    `${idsToDelete.length} duplicado(s) a remover, ${survivorsToNormalize.length} a normalizar`,
                );
            }

            if (!isDryRun) {
                // 1) Apaga duplicados ANTES de normalizar (evita colisão no índice).
                if (idsToDelete.length > 0) {
                    await DividendEvent.deleteMany({ _id: { $in: idsToDelete } });
                }
                // 2) Normaliza sobreviventes para a forma canônica.
                for (const s of survivorsToNormalize) {
                    await DividendEvent.updateOne({ _id: s._id }, { $set: { date: s.date, amount: s.amount } });
                }
            }
        }

        console.log('\n──────────────────────────────────────────────');
        console.log(`Tickers analisados:        ${tickers.length}`);
        console.log(`Grupos com duplicata:      ${totalGroups}`);
        console.log(`Registros duplicados ${isDryRun ? '(a remover)' : 'removidos'}: ${totalDuplicates}`);
        console.log(`Sobreviventes ${isDryRun ? '(a normalizar)' : 'normalizados'}: ${totalNormalized}`);
        console.log('──────────────────────────────────────────────\n');

        if (isDryRun) {
            console.log('DRY-RUN: nenhuma alteração feita. Rode sem --dry-run para aplicar.');
            process.exit(0);
        }

        // Migração do índice único: só na varredura completa (todos os tickers),
        // pois exige que o conjunto inteiro já esteja deduplicado/normalizado.
        if (!onlyTicker) {
            try {
                const indexes = await DividendEvent.collection.indexes();
                const old = indexes.find((i) => i.key && i.key.ticker === 1 && i.key.date === 1 && i.key.amount === 1);
                if (old) {
                    await DividendEvent.collection.dropIndex(old.name);
                    console.log(`🗂️  Índice antigo removido: ${old.name}`);
                }
                await DividendEvent.syncIndexes();
                console.log('🗂️  Índice {ticker,date,type} sincronizado.\n');
            } catch (e) {
                console.error(`⚠️  Falha ao migrar índice (revise manualmente): ${e.message}\n`);
            }
        }

        if (doRebuild && affectedTickers.size > 0) {
            // Fase 2: o histórico é por CARTEIRA — reconstrói cada carteira afetada,
            // não cada usuário (um usuário pode ter o ticker em mais de uma carteira).
            const pairs = await AssetTransaction.aggregate([
                { $match: { ticker: { $in: [...affectedTickers] } } },
                { $group: { _id: { user: '$user', wallet: '$wallet' } } },
            ]);

            console.log(`🔧 Reconstruindo histórico de ${pairs.length} carteira(s) afetada(s)...\n`);
            let ok = 0, failed = 0;
            for (let i = 0; i < pairs.length; i++) {
                const { user, wallet } = pairs[i]._id;
                const label = `user=${user} wallet=${wallet}`;
                try {
                    await financialService.rebuildUserHistory(user, wallet);
                    ok++;
                    console.log(`✅ [${i + 1}/${pairs.length}] ${label}`);
                } catch (err) {
                    failed++;
                    console.error(`❌ [${i + 1}/${pairs.length}] ${label} — ${err.message}`);
                }
                await sleep(300);
            }
            console.log(`\n🏁 Rebuild: ${ok} ok, ${failed} com erro.`);
        } else if (affectedTickers.size > 0) {
            console.log('ℹ️  Rode com --rebuild para reconstruir o histórico das contas afetadas');
            console.log('   (ou use: npm run rebuild:history).');
        }

        process.exit(0);
    } catch (err) {
        console.error('❌ Erro na limpeza de proventos:', err.message);
        process.exit(1);
    }
};

run();
