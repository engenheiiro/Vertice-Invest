
/**
 * Reparo — spread de renda fixa contaminado pelo scraping do Investidor10.
 *
 * Contexto do bug: o Investidor10 reordenou/renomeou as colunas da tabela do
 * Tesouro Direto e o scraper passou a capturar a "Rentabilidade estimada" (retorno
 * NOMINAL projetado) em vez da "Rentabilidade anual" (taxa REAL/contratada). Esse
 * valor foi gravado em `TreasuryBond.rate` e, no cadastro de renda fixa sem spread
 * informado (walletController.addAssetTransaction), copiado para
 * `UserAsset.fixedIncomeSpread`. Efeito: IPCA+ ficou com spread ~12% (deveria ~7,9%)
 * e Selic com spread ~14% (deveria ~0,07%), inflando o rendimento da carteira.
 *
 * A correção do scraper (macroDataService.parseGenericRow → 1ª coluna %) e da fonte
 * oficial (CSV do Tesouro Transparente) conserta o catálogo e os cadastros NOVOS.
 * Este script conserta as posições JÁ gravadas com spread contaminado.
 *
 * Estratégia (conservadora, determinística):
 *   1. Seleciona FIXED_INCOME com índice SELIC/CDI/IPCA e spread FORA da faixa
 *      plausível do índice (o número contaminado é sempre nominal, bem acima).
 *   2. Re-deriva o spread correto do catálogo TreasuryBond (JÁ corrigido) casando
 *      `ticker` ↔ `title`. Só grava se o valor do catálogo for plausível p/ o índice.
 *   3. Sem match no catálogo (ou catálogo ainda implausível) → NÃO adivinha:
 *      apenas LISTA para revisão manual.
 *
 * Idempotente: só toca em spreads implausíveis; reexecutar após o conserto não
 * altera nada. IMPORTANTE: rode o sync de mercado (que repopula TreasuryBond com a
 * taxa REAL) ANTES deste script, senão o catálogo ainda estará contaminado.
 *
 * Faixas de plausibilidade do SPREAD por índice:
 *   IPCA  → yield real: [2.0, 9.5]   (mesma faixa da NTN-B)
 *   SELIC → spread sobre a Selic:  [-1.0, 3.0]
 *   CDI   → spread sobre o CDI:     [-1.0, 3.0]
 *
 * Uso:
 *   node server/scripts/repairFixedIncomeSpread.js --dry
 *   node server/scripts/repairFixedIncomeSpread.js
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import UserAsset from '../models/UserAsset.js';
import TreasuryBond from '../models/TreasuryBond.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dryRun = process.argv.slice(2).includes('--dry');

// Faixa plausível do SPREAD (não da taxa cheia) por índice.
const SPREAD_RANGE = {
    IPCA: { min: 2.0, max: 9.5 },
    SELIC: { min: -1.0, max: 3.0 },
    CDI: { min: -1.0, max: 3.0 },
};
const isPlausibleSpread = (idx, v) => {
    const r = SPREAD_RANGE[idx];
    return r && Number.isFinite(v) && v >= r.min && v <= r.max;
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`🔧 Reparo de spread de renda fixa ${dryRun ? '(DRY RUN)' : ''}...\n`);

        // Só índices indexados; PRE guarda a taxa cheia em fixedIncomeRate (não afetado).
        const candidates = await UserAsset.find({
            type: 'FIXED_INCOME',
            fixedIncomeIndex: { $in: ['SELIC', 'CDI', 'IPCA'] },
        }).select('_id ticker wallet fixedIncomeIndex fixedIncomeSpread').lean();

        let fixed = 0;
        let manual = 0;
        let ok = 0;
        const manualList = [];

        for (const a of candidates) {
            const idx = a.fixedIncomeIndex;
            const spread = Number(a.fixedIncomeSpread) || 0;
            if (isPlausibleSpread(idx, spread)) { ok++; continue; }

            // Tenta re-derivar do catálogo corrigido (title ↔ ticker).
            const bond = await TreasuryBond.findOne({
                title: new RegExp(`^${escapeRegex(a.ticker)}$`, 'i'),
            }).select('rate index').lean();

            const catalogRate = bond ? Number(bond.rate) : NaN;
            if (bond && isPlausibleSpread(idx, catalogRate)) {
                console.log(`   ✓ ${a.ticker} (wallet ${a.wallet}) [${idx}] spread ${spread} → ${catalogRate} (catálogo)`);
                if (!dryRun) {
                    await UserAsset.updateOne({ _id: a._id }, { $set: { fixedIncomeSpread: catalogRate } });
                }
                fixed++;
            } else {
                manual++;
                manualList.push({ ticker: a.ticker, wallet: String(a.wallet), idx, spread, catalogRate: bond ? catalogRate : 'sem-match' });
            }
        }

        console.log(`\n📊 Resumo: ${candidates.length} posições indexadas | ${ok} já OK | ${fixed} corrigidas${dryRun ? ' (dry)' : ''} | ${manual} p/ revisão manual`);

        if (manualList.length) {
            console.log('\n⚠️  Revisão manual (spread implausível e sem taxa confiável no catálogo):');
            for (const m of manualList) {
                console.log(`   • ${m.ticker} [${m.idx}] spread atual=${m.spread} | catálogo=${m.catalogRate}`);
            }
            console.log('\n   → Ajuste essas posições pela UI (índice + spread corretos). O valor da');
            console.log('     carteira já usa o spread salvo; corrigir aqui reflete no próximo cálculo live.');
        }

        console.log('\n   Obs.: snapshots patrimoniais PASSADOS foram gravados com o spread antigo.');
        console.log('   O KPI/valor LIVE já fica correto após este reparo. Para recompor o histórico,');
        console.log('   rode o rebuild de histórico da carteira (npm run rebuild:history) se desejado.');

        console.log(dryRun ? '\n✅ DRY RUN concluído (nada foi gravado).' : '\n✅ Reparo concluído.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
};

run();
