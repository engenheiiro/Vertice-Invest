/**
 * Auditoria da classificação de sub-tipo de Renda Fixa (IPCA / Pós-fixado / Prefixado).
 *
 * Contexto: até jul/2026, um CDB/LCI "% do CDI" cadastrado manualmente ficava com
 * `fixedIncomeIndex = null` (só `fixedIncomeRate`, ex.: 100 = 100% do CDI). O
 * classificador olhava só o índice e caía no default → PREFIXADO, mesmo o título
 * sendo pós-fixado. A correção passou a espelhar a convenção do accrual
 * (`rate > 50` = %CDI → pós). A classificação é DERIVADA em leitura, então nenhuma
 * escrita no banco é necessária — este script apenas comprova o resultado sobre as
 * posições já cadastradas e destaca quais mudam de rótulo (PRE → POS).
 *
 * Uso:
 *   node server/scripts/auditFixedIncomeSubtype.js                # todas as carteiras
 *   node server/scripts/auditFixedIncomeSubtype.js email@dominio  # só um usuário
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { fixedIncomeSubKey, SUB_LABELS } from '../utils/subAllocation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EMAIL = process.argv[2] || null;

const U = mongoose.model('U', new mongoose.Schema({}, { strict: false, collection: 'users' }));
const Asset = mongoose.model('A', new mongoose.Schema({}, { strict: false, collection: 'userassets' }));

const brl = (n) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Rótulo que o classificador ANTIGO daria (só o índice; sem índice → sempre PRE).
const legacySubKey = (index) => {
    switch (index) {
        case 'IPCA': return 'IPCA';
        case 'SELIC':
        case 'CDI': return 'POS';
        case 'PRE': return 'PRE';
        default: return 'PRE';
    }
};

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    let userFilter = {};
    if (EMAIL) {
        const user = await U.findOne({ email: EMAIL }).lean();
        if (!user) { console.error(`Usuário ${EMAIL} não encontrado`); process.exit(1); }
        userFilter = { user: user._id };
        console.log(`\nFiltro: ${user.name} <${user.email}> (${user._id})`);
    }

    const assets = await Asset.find({ ...userFilter, type: 'FIXED_INCOME' }).lean();
    console.log(`\n==== Renda Fixa: ${assets.length} posição(ões) ====\n`);

    let changed = 0;
    const label = (k) => SUB_LABELS.FIXED_INCOME[k];

    for (const a of assets) {
        const now = fixedIncomeSubKey(a.fixedIncomeIndex, a.fixedIncomeRate);
        const before = legacySubKey(a.fixedIncomeIndex);
        const flipped = now !== before;
        if (flipped) changed++;
        const idx = a.fixedIncomeIndex || '—';
        const mark = flipped ? '  ✅ CORRIGIDO' : '';
        console.log(
            `  [${a.ticker}] "${a.name || ''}" | índice=${idx} rate=${a.fixedIncomeRate ?? '—'} | ` +
            `${label(before)} → ${label(now)}${mark}`
        );
        if (flipped) {
            console.log(`        (antes classificava como ${label(before)}; agora ${label(now)} — total ${brl(a.totalCost)})`);
        }
    }

    console.log(`\n==== Resumo ====`);
    console.log(`  Total RF: ${assets.length}`);
    console.log(`  Rótulo corrigido (PRE→POS): ${changed}`);
    console.log(`  Nenhuma escrita no banco necessária — classificação é derivada em leitura.\n`);

    await mongoose.disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
