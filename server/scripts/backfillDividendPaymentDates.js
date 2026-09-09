/**
 * Preenche a DATA DE PAGAMENTO dos proventos que ainda estão sem ela.
 *
 * Mesma rotina do botão "Preencher datas de pagamento" do Admin — os dois chamam
 * `dividendPaymentDateService.backfillPaymentDates`, para não existirem duas
 * respostas diferentes para a mesma pergunta. Este script existe para quem prefere
 * o terminal e para poder rodar com `--tickers`.
 *
 * CADEIA: B3 primeiro (autoritativa, cobre ~12 meses), Fundamentus depois, para o
 * que a B3 não alcança — o Fundamentus chega a 1995. Rode da SUA máquina: o IP do
 * Render é bloqueado com 403 pelo Fundamentus, então em produção o segundo elo
 * simplesmente não responde e o backfill fica limitado à janela da B3.
 *
 * QUANDO RODAR: uma vez, para zerar o passivo histórico. Depois disso o sync
 * diário de proventos já consulta a B3 sozinho e nenhum provento novo envelhece
 * sem data — só volte aqui se o card "Data de pagamento dos proventos" no Admin
 * acusar evento antigo sem data.
 *
 * Fail-closed: evento que a fonte não conhece, cujo valor não bate ou cujo
 * pagamento está dividido em datas diferentes fica com `paymentDate` nulo e segue
 * na estimativa. Nada aqui grava data deduzida.
 *
 * Uso:
 *   node server/scripts/backfillDividendPaymentDates.js
 *   node server/scripts/backfillDividendPaymentDates.js --limit=50
 *   node server/scripts/backfillDividendPaymentDates.js --tickers=GGRC11,PETR4
 *   node server/scripts/backfillDividendPaymentDates.js --sources=b3
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';
import DividendEvent from '../models/DividendEvent.js';
import { backfillPaymentDates, FONTES, CADEIA_BACKFILL } from '../services/dividendPaymentDateService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const arg = (nome, padrao = null) => {
    const hit = args.find((a) => a.startsWith(`--${nome}=`));
    return hit ? hit.split('=').slice(1).join('=') : padrao;
};

const tickers = arg('tickers')?.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) || null;
const limite = Number(arg('limit', '0')) || 0;
const fontesArg = arg('sources');
const cadeia = fontesArg
    ? fontesArg.split(',').map((s) => FONTES[s.trim().toUpperCase()]).filter(Boolean)
    : CADEIA_BACKFILL;

const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');

const run = async () => {
    await connectScriptDb({ label: 'backfill-dividend-payment-dates' });

    const antes = {
        total: await DividendEvent.countDocuments(),
        comData: await DividendEvent.countDocuments({ paymentDateSource: { $ne: null, $exists: true } }),
    };

    console.log('\n📅 Backfill de data de pagamento de proventos');
    console.log(`Cadeia: ${cadeia.map((f) => f.rotulo).join(' → ')}`);
    console.log(`Antes: ${antes.comData}/${antes.total} eventos com data de fonte (${pct(antes.comData, antes.total)})\n`);

    const resumo = await backfillPaymentDates({
        cadeia,
        limite,
        tickers,
        onProgress: ({ i, total, ticker, resumo: r }) => {
            process.stdout.write(`\r[${String(i).padStart(4)}/${total}] ${ticker.padEnd(8)} · ${r.preenchidos} data(s) gravada(s)   `);
        },
    });

    const depois = await DividendEvent.countDocuments({ paymentDateSource: { $ne: null, $exists: true } });

    console.log(`\n\n✅ ${resumo.preenchidos} data(s) gravada(s) em ${resumo.ativos} ativo(s) (${Math.round(resumo.duracaoMs / 1000)}s).`);
    console.log(`   ${resumo.tentados} evento(s) sem data foram tentados.`);
    console.log(`   Agora: ${depois}/${antes.total} eventos com data de fonte (${pct(depois, antes.total)}).`);
    if (Object.keys(resumo.porFonte).length) {
        console.log(`   Por fonte: ${Object.entries(resumo.porFonte).map(([f, n]) => `${f} ${n}`).join(' · ')}`);
    }
    if (resumo.foraDeEscopo > 0) {
        console.log(`   ${resumo.foraDeEscopo} ativo(s) fora do alcance destas fontes (cripto, renda fixa, papel dos EUA) — não são buraco.`);
    }
    if (resumo.falhas.length) {
        const porMotivo = {};
        for (const f of resumo.falhas) {
            const k = `${f.fonte}: ${f.motivo}`;
            porMotivo[k] = (porMotivo[k] || 0) + 1;
        }
        console.log('\n⚠️  Falhas de acesso:');
        for (const [motivo, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
            console.log(`   ${motivo} (${n} ativo(s))`);
        }
        console.log('   403 no Fundamentus a partir de servidor é esperado — rode este script da sua máquina.');
    }
    console.log('\nO que ficou sem data segue na estimativa, marcada como "Previsto" na tela.\n');

    await mongoose.disconnect();
};

run().catch(async (e) => {
    console.error('\nBackfill falhou:', e);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
