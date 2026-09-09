/**
 * Remove as DATAS DE PAGAMENTO INVENTADAS de `DividendEvent`.
 *
 * O QUE ELAS SÃO
 * Em 09/09/2026 o banco tinha 442 eventos com `paymentDate` preenchido — 18% do
 * total — e a leitura natural era "temos 18% de cobertura". A medição desmentiu:
 * os 442 têm EXATAMENTE o mesmo lag de +16 dias sobre a ex-date. Todos. Entre eles
 * há pagamento marcado para 25/12/2025 (ITSA4) e 01/01/2026 (CSMG3), dias em que a
 * B3 não liquida nada, e nenhum dos 70 conferidos contra a B3 e o Fundamentus
 * bateu com a data que o emissor publicou.
 *
 * Data real de pagamento não se comporta assim: FII paga 7–10 dias depois da
 * data-com, empresa paga meses depois, e o calendário desvia de feriado. Lag
 * constante é a assinatura de uma conta, não de um anúncio. Foram criados todos em
 * 31/01/2026 e nenhum código vivo escreve +16 (a régua atual é +15), então vieram
 * de uma carga que não existe mais.
 *
 * POR QUE APAGAR É MELHOR DO QUE DEIXAR
 * `resolvePaymentDate` trata qualquer `paymentDate` não-nulo como OFICIAL
 * (`isEstimated: false`). Para esses 442 a tela mostra hoje "Agendado"/"Creditado"
 * sobre uma data inventada — sem o "~" e sem o selo "Previsto" que existem
 * justamente para não afirmar chute. Nulo é pior em aparência e melhor em verdade:
 * o evento volta para a estimativa, e a estimativa se declara.
 *
 * O CRITÉRIO (fail-closed)
 * Apaga `paymentDate` de quem NÃO tem `paymentDateSource`. Esse campo só é escrito
 * por `dividendPaymentDateService` a partir da B3 ou do Fundamentus; sua ausência
 * é, por construção, "data de origem desconhecida". Nada com procedência é tocado,
 * mesmo que o lag calhe de dar 16 dias.
 *
 * Idempotente: reexecutar depois do conserto não altera nada.
 *
 * Uso:
 *   node server/scripts/cleanFabricatedPaymentDates.js --dry
 *   node server/scripts/cleanFabricatedPaymentDates.js
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';
import DividendEvent from '../models/DividendEvent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dryRun = process.argv.slice(2).includes('--dry');

const DIA_MS = 86400000;

/** Sem procedência = origem desconhecida. É o alvo, e é o único. */
const SEM_PROCEDENCIA = {
    paymentDate: { $ne: null, $exists: true },
    paymentDateSource: { $in: [null, undefined] },
};

const run = async () => {
    await connectScriptDb({ label: 'clean-fabricated-payment-dates' });

    console.log(`\n🧹 Limpeza de datas de pagamento sem procedência ${dryRun ? '(DRY RUN)' : ''}\n`);

    const alvos = await DividendEvent.find(SEM_PROCEDENCIA).select('ticker date paymentDate').lean();
    const comProcedencia = await DividendEvent.countDocuments({ paymentDateSource: { $ne: null, $exists: true } });

    if (alvos.length === 0) {
        console.log('Nenhuma data sem procedência no banco.');
        console.log(`${comProcedencia} evento(s) com data de fonte — intactos.\n`);
        await mongoose.disconnect();
        return;
    }

    // Distribuição do lag: é o que prova, na tela, que o alvo é chute e não dado.
    // Se um dia esta distribuição aparecer espalhada, o critério de "sem
    // procedência" está pegando algo que talvez fosse real — e aí a decisão volta
    // a ser humana antes de apagar.
    const hist = {};
    for (const e of alvos) {
        const d = Math.round((new Date(e.paymentDate).getTime() - new Date(e.date).getTime()) / DIA_MS);
        hist[d] = (hist[d] || 0) + 1;
    }
    const linhas = Object.entries(hist).sort((a, b) => b[1] - a[1]);
    const [lagDominante, freq] = linhas[0];
    const concentracao = freq / alvos.length;

    console.log(`Alvos: ${alvos.length} evento(s) com data e sem procedência.`);
    console.log(`Lag (pagamento − ex-date): ${linhas.slice(0, 10).map(([d, n]) => `${d >= 0 ? '+' : ''}${d}d:${n}`).join('  ')}`);
    console.log(concentracao >= 0.95
        ? `⛔ ${(concentracao * 100).toFixed(1)}% no MESMO lag (${lagDominante}d) — assinatura de estimativa gravada como anúncio.`
        : `⚠️  Lag espalhado (maior grupo: ${(concentracao * 100).toFixed(1)}% em ${lagDominante}d). Confira antes de apagar.`);

    const emFeriado = alvos.filter((e) => {
        const k = new Date(e.paymentDate).toISOString().slice(5, 10);
        return k === '12-25' || k === '01-01';
    });
    if (emFeriado.length) {
        console.log(`   ${emFeriado.length} pagamento(s) marcados para 25/12 ou 01/01, quando a B3 não liquida:`);
        for (const e of emFeriado.slice(0, 5)) {
            console.log(`     ${e.ticker} ex=${new Date(e.date).toISOString().slice(0, 10)} → pago ${new Date(e.paymentDate).toISOString().slice(0, 10)}`);
        }
    }

    console.log(`\n${comProcedencia} evento(s) com data de fonte permanecem intactos.`);

    if (dryRun) {
        console.log('\n✅ DRY RUN concluído (nada foi gravado).\n');
        await mongoose.disconnect();
        return;
    }

    const res = await DividendEvent.updateMany(SEM_PROCEDENCIA, { $unset: { paymentDate: '' } });
    console.log(`\n✅ ${res.modifiedCount} data(s) removida(s). Esses eventos voltam à estimativa, marcada como "Previsto" na tela.`);
    console.log('   Para preenchê-los com data real: botão "Preencher datas de pagamento" no Admin (rodando em dev), ou');
    console.log('   node server/scripts/backfillDividendPaymentDates.js\n');

    await mongoose.disconnect();
};

run().catch(async (e) => {
    console.error('Limpeza falhou:', e);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
