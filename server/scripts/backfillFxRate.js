/**
 * Backfill do câmbio de compra (fxRate) e do custo em BRL das posições.
 *
 * Antes desta migração o custo de um ativo em dólar era reconvertido pela
 * cotação de HOJE. Como o saldo usa a mesma cotação, o câmbio se cancelava e o
 * resultado exibido era o retorno em dólar — um stablecoin ficava travado em
 * 0,00% para sempre e cripto em alta aparecia no vermelho.
 *
 * O que faz:
 *   1. carimba `fxRate` nos lançamentos sem ele (histórico USD-BRL por data);
 *   2. recalcula cada posição para preencher `totalCostBrl`/`realizedProfitBrl`.
 *
 * O passo 2 usa a MESMA função de produção (recalculatePosition), então também
 * revalida quantidade/custo contra os lançamentos. Divergências pré-existentes
 * são reportadas item a item — elas indicam posição que já estava fora de
 * sincronia com o extrato, não efeito desta migração.
 *
 * Uso:
 *   node scripts/backfillFxRate.js --dry            # simula, não escreve nada
 *   node scripts/backfillFxRate.js                  # aplica em todos
 *   node scripts/backfillFxRate.js --email=a@b.com  # aplica num usuário só
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { default: User } = await import('../models/User.js');
const { default: UserAsset } = await import('../models/UserAsset.js');
const { default: AssetTransaction } = await import('../models/AssetTransaction.js');
const { default: SystemConfig } = await import('../models/SystemConfig.js');
const { financialService } = await import('../services/financialService.js');
const { loadUsdRateResolver, fxDayKey } = await import('../utils/fxRate.js');
const { resolveTransactionCurrency } = await import('../utils/assetCurrency.js');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const emailArg = args.find(a => a.startsWith('--email='));
const EMAIL = emailArg ? emailArg.split('=')[1] : null;

const brl = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`\n=== Backfill de câmbio ${DRY ? '(DRY RUN — nada será gravado)' : '(APLICANDO)'} ===`);

    let userFilter = {};
    if (EMAIL) {
        const user = await User.findOne({ email: EMAIL }).select('_id email').lean();
        if (!user) { console.error(`Usuário ${EMAIL} não encontrado.`); process.exit(1); }
        userFilter = { user: user._id };
        console.log(`Escopo: ${user.email}`);
    } else {
        console.log('Escopo: todos os usuários');
    }

    const macro = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).select('dollar').lean();
    const resolver = await loadUsdRateResolver(macro?.dollar);
    console.log(`Cotação corrente (âncora p/ datas após o último candle): ${macro?.dollar}`);

    // --- Passo 1: carimbar fxRate nos lançamentos ---
    const assets = await UserAsset.find(userFilter).select('_id user wallet ticker type currency quantity totalCost totalCostBrl').lean();
    const assetsByKey = new Map(assets.map(a => [`${a.wallet}|${a.ticker}`, a]));

    const txs = await AssetTransaction.find({ ...userFilter, fxRate: { $in: [null, undefined] } })
        .select('_id wallet ticker type currency date fxRate').lean();
    console.log(`\nLançamentos sem câmbio carimbado: ${txs.length}`);

    // Só lançamentos em DÓLAR são carimbados: em real o câmbio é 1 por definição
    // e gravá-lo seria escrita sem informação (mesma regra de recalculatePosition).
    const ops = [];
    let brlCount = 0;
    for (const tx of txs) {
        const asset = assetsByKey.get(`${tx.wallet}|${String(tx.ticker).toUpperCase()}`) || null;
        if (resolveTransactionCurrency(tx, asset) !== 'USD') { brlCount++; continue; }
        const rate = resolver(fxDayKey(tx.date));
        console.log(`   ${tx.ticker.padEnd(10)} ${fxDayKey(tx.date)} ${tx.type.padEnd(4)} → câmbio ${rate.toFixed(4)}`);
        ops.push({ updateOne: { filter: { _id: tx._id }, update: { $set: { fxRate: rate } } } });
    }
    console.log(`   (${ops.length} em dólar a carimbar; ${brlCount} em real ignorados)`);

    if (ops.length > 0 && !DRY) {
        const res = await AssetTransaction.bulkWrite(ops);
        console.log(`   ✅ ${res.modifiedCount} lançamentos carimbados.`);
    }

    // --- Prévia do impacto (dry): custo exibido hoje × custo com câmbio de compra ---
    if (DRY) {
        console.log('\nPrévia do custo das posições em dólar:');
        for (const a of assets) {
            if (a.currency !== 'USD') continue;
            const posTxs = await AssetTransaction.find({ wallet: a.wallet, ticker: a.ticker })
                .sort({ date: 1, createdAt: 1 }).select('type quantity price date fxRate').lean();
            // Mesma caminhada de preço médio de recalculatePosition, em BRL.
            let qty = 0, costBrl = 0;
            for (const tx of posTxs) {
                const rate = Number(tx.fxRate) > 0 ? Number(tx.fxRate) : resolver(fxDayKey(tx.date));
                const totalBrl = tx.quantity * tx.price * rate;
                if (tx.type === 'BUY') { qty += tx.quantity; costBrl += totalBrl; }
                else { costBrl -= qty > 0 ? costBrl * (tx.quantity / qty) : 0; qty -= tx.quantity; }
            }
            const legacy = (a.totalCost || 0) * (macro?.dollar || 0);
            console.log(`   ${a.ticker.padEnd(10)} exibido ${brl(legacy)} → real ${brl(costBrl)} (${brl(costBrl - legacy)})`);
        }
        console.log('(estimativa: o valor gravado vem do recálculo de produção, sem --dry)');
    }

    // --- Passo 2: recalcular posições (preenche totalCostBrl/realizedProfitBrl) ---
    console.log(`\nRecalculando ${assets.length} posições...`);
    let changed = 0, drifted = 0, failed = 0;

    for (const before of assets) {
        if (DRY) continue;
        try {
            const after = await financialService.recalculatePosition(
                before.user, before.ticker, before.type, null, before.currency, before.wallet,
            );
            if (!after) continue;

            const qtyDrift = Math.abs((after.quantity || 0) - (before.quantity || 0)) > 1e-8;
            const costDrift = Math.abs((after.totalCost || 0) - (before.totalCost || 0)) > 0.01;
            if (qtyDrift || costDrift) {
                drifted++;
                console.log(`   ⚠️  ${before.ticker}: posição estava fora de sincronia com o extrato — ` +
                    `qtd ${before.quantity}→${after.quantity}, custo ${before.totalCost}→${after.totalCost}`);
            }

            const legacy = before.currency === 'USD' && macro?.dollar
                ? (before.totalCost || 0) * macro.dollar
                : (before.totalCost || 0);
            if (Math.abs((after.totalCostBrl || 0) - legacy) > 0.01) {
                changed++;
                console.log(`   ${before.ticker.padEnd(10)} custo exibido ${brl(legacy)} → real ${brl(after.totalCostBrl)} ` +
                    `(diferença ${brl((after.totalCostBrl || 0) - legacy)})`);
            }
        } catch (err) {
            failed++;
            console.log(`   ❌ ${before.ticker}: ${err.message}`);
        }
    }

    console.log(`\nResumo: ${changed} posições com custo corrigido | ${drifted} fora de sincronia | ${failed} com erro`);
    if (DRY) console.log('(DRY RUN — o passo 2 não roda em simulação; rode sem --dry para aplicar)');
    await mongoose.disconnect();
};

run().catch(err => { console.error(err); process.exit(1); });
