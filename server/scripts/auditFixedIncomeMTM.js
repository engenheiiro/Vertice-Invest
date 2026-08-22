/**
 * Auditoria da marcação a mercado da renda fixa: accrual ("na curva") × mercado.
 *
 * Mostra, posição por posição, se o título foi identificado na série oficial de
 * PU, quanto a marcação muda o valor exibido, e qual volatilidade real o título
 * carrega — a que o accrual apagava por construção. Somente LEITURA.
 *
 * Uso:
 *   npm run audit:rf-mtm                    # todas as carteiras
 *   npm run audit:rf-mtm -- email@dominio   # só um usuário
 */
import mongoose from 'mongoose';
import { connectScriptDb } from './lib/scriptDb.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import UserAsset from '../models/UserAsset.js';
import User from '../models/User.js';
import SystemConfig from '../models/SystemConfig.js';
import { loadTreasuryPricing } from '../services/treasuryPriceService.js';
import { valueFixedIncomeAsset, brazilToday, PRICING_SOURCE } from '../utils/fixedIncome.js';
import { DEFAULT_SELIC_FALLBACK } from '../config/financialConstants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EMAIL = process.argv[2] || null;
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Volatilidade anualizada da série de PU no último ano — o risco que o accrual escondia. */
const annualVolatility = (history, days = 252) => {
    const slice = (history || []).slice(-(days + 1));
    if (slice.length < 30) return null;
    const returns = [];
    for (let i = 1; i < slice.length; i++) {
        if (slice[i - 1].pu > 0 && slice[i].pu > 0) returns.push(slice[i].pu / slice[i - 1].pu - 1);
    }
    if (returns.length < 30) return null;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(252) * 100;
};

const run = async () => {
    if (!process.env.MONGO_URI) { console.error('❌ MONGO_URI não definida.'); process.exit(1); }
    await connectScriptDb({ label: 'auditFixedIncomeMTM' });

    let filter = { type: { $in: ['FIXED_INCOME', 'CASH'] }, quantity: { $gt: 0 } };
    if (EMAIL) {
        const user = await User.findOne({ email: EMAIL }).lean();
        if (!user) { console.error(`❌ Usuário ${EMAIL} não encontrado.`); process.exit(1); }
        filter.user = user._id;
        console.log(`\nFiltro: ${user.name} <${user.email}>`);
    }

    const assets = await UserAsset.find(filter).lean();
    if (assets.length === 0) {
        console.log('\nNenhuma posição de renda fixa/caixa.');
        await mongoose.disconnect();
        return;
    }

    const config = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' }).lean();
    const cdiRate = (config?.cdi > 0 ? config.cdi : null) || (config?.selic > 0 ? config.selic : null) || DEFAULT_SELIC_FALLBACK;
    const macro = { cdiRate, selic: config?.selic, ipca: config?.ipca };
    const calcDate = brazilToday();

    const pricing = await loadTreasuryPricing(assets);
    const users = await User.find({}).select('_id email').lean();
    const emailOf = new Map(users.map((u) => [String(u._id), u.email]));

    console.log(`\n==== Renda fixa: ${assets.length} posição(ões) | catálogo de PU: ${pricing.catalog.length} título(s) ====\n`);

    let totalAccrued = 0;
    let totalMarked = 0;
    let marked = 0;

    for (const asset of assets) {
        const match = pricing.resolve(asset);
        const history = pricing.historyFor(asset);
        const valued = valueFixedIncomeAsset(asset, { ...macro, calcDate, history });

        totalAccrued += valued.accrued;
        totalMarked += valued.value;

        const label = `${asset.name || asset.ticker}`.slice(0, 38);
        console.log(`${label.padEnd(40)} ${emailOf.get(String(asset.user)) || '?'}`);
        console.log(`   custo          R$ ${brl(asset.totalCost).padStart(14)}`);
        console.log(`   na curva       R$ ${brl(valued.accrued).padStart(14)}`);

        if (valued.source === PRICING_SOURCE.MTM) {
            marked++;
            const delta = valued.value - valued.accrued;
            const pct = valued.accrued > 0 ? (delta / valued.accrued) * 100 : 0;
            const vol = annualVolatility(history);
            console.log(`   a mercado      R$ ${brl(valued.value).padStart(14)}   (${delta >= 0 ? '+' : ''}${brl(delta)} / ${pct.toFixed(2)}%)`);
            console.log(`   título         ${match.key}  PU de ${valued.priceDate}`);
            console.log(`   vol real 1a    ${vol === null ? 'série curta' : `${vol.toFixed(2)}% a.a.`}   ← o accrual assumia 0%`);
        } else {
            console.log(`   a mercado      — não marcado (${match.reason || 'sem série'})`);
        }
        console.log('');
    }

    const delta = totalMarked - totalAccrued;
    console.log('─'.repeat(72));
    console.log(`Posições marcadas a mercado: ${marked}/${assets.length}`);
    console.log(`Renda fixa na curva:  R$ ${brl(totalAccrued)}`);
    console.log(`Renda fixa a mercado: R$ ${brl(totalMarked)}   (${delta >= 0 ? '+' : ''}${brl(delta)})`);

    await mongoose.disconnect();
};

run().catch(async (error) => {
    console.error(`❌ Erro: ${error.message}`);
    console.error(error.stack);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
