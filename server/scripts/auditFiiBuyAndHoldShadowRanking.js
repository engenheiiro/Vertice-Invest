/**
 * Auditoria read-only do ranking âncora de FIIs (estratégia BUY_AND_HOLD) — shadow.
 *
 * Wrapper de linha de comando sobre fiiBuyAndHoldService.generateFiiBuyAndHoldRanking().
 * NÃO escreve nada (nem MarketAnalysis, nem DiscardLog, nem config).
 *
 * Uso:
 *   node server/scripts/auditFiiBuyAndHoldShadowRanking.js            # tabela + resumo
 *   node server/scripts/auditFiiBuyAndHoldShadowRanking.js --json     # payload completo
 *   node server/scripts/auditFiiBuyAndHoldShadowRanking.js --excluded # + motivos de exclusão
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { fiiBuyAndHoldService } from '../services/fiiBuyAndHoldService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SHOW_EXCLUDED = process.argv.includes('--excluded');
const AS_JSON = process.argv.includes('--json');

const pad = (value, width) => String(value ?? '').padEnd(width).slice(0, width);
const num = (value, width) => String(value ?? '—').padStart(width);

await mongoose.connect(process.env.MONGO_URI);
try {
  const result = await fiiBuyAndHoldService.generateFiiBuyAndHoldRanking({ includeExcluded: SHOW_EXCLUDED });

  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n${result.version} — gerado em ${result.generatedAt} (read-only, writesPerformed=${result.writesPerformed})`);
    console.log(`NTN-B longa: ${result.macro.NTNB_LONG}%  ·  SELIC ${result.macro.SELIC}%  ·  taxas stale: ${result.macro.RATES_STALE}\n`);

    console.log([
      pad('#', 4), pad('TICKER', 9), pad('SEGMENTO', 20), pad('GESTORA', 13),
      num('SCORE', 6), num('COMP', 5), num('DUR', 4), num('RES', 4), num('CON', 4),
      num('SPRD', 6), num('P/FFO', 6), num('COB', 5), num('VAC', 6), pad('  AÇÃO', 9), 'MOTIVO',
    ].join(' '));
    console.log('-'.repeat(160));
    for (const row of result.ranking) {
      console.log([
        pad(row.position, 4), pad(row.ticker, 9), pad(row.sector, 20), pad(row.manager, 13),
        num(row.score, 6), num(row.composite, 5),
        num(row.axes.durability, 4), num(row.axes.resilience, 4), num(row.axes.consistency, 4),
        num(row.spreadPp, 6), num(row.pFfo, 6), num(row.ffoCoverage, 5),
        // "!" = a fonte publicou um número e ele foi descartado por implausível.
        num(row.vacancy === null && row.vacancyRaw !== null ? `!${row.vacancyRaw}` : row.vacancy, 6),
        pad(`  ${row.action === 'BUY' ? 'COMPRAR' : 'AGUARDAR'}`, 9), row.reason,
      ].join(' '));
    }

    const { counts } = result;
    console.log(`\nAnalisados ${counts.analyzed} · elegíveis ${counts.eligible} (${counts.distinctManagers} gestoras) · excluídos ${counts.excluded}`);
    console.log(`COMPRAR ${counts.buy} · AGUARDAR ${counts.wait}`
      + (counts.eligible ? `  (${Math.round((counts.buy / counts.eligible) * 100)}% da lista sai como COMPRAR)` : ''));

    console.log('\nTop motivos de exclusão:');
    for (const { reason, count } of result.excludedByReason.slice(0, 12)) {
      console.log(`  ${num(count, 4)}  ${reason}`);
    }

    if (SHOW_EXCLUDED) {
      console.log('\nExcluídos (detalhe):');
      for (const item of result.excluded) {
        console.log(`  ${pad(item.ticker, 9)} ${item.failures.join('; ')}`);
      }
    }
  }
} finally {
  await mongoose.disconnect();
}
