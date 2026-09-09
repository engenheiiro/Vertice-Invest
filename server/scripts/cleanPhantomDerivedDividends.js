/**
 * Remove os PROVENTOS PROVISÓRIOS que nunca foram provento.
 *
 * O QUE ELES SÃO
 * O provento derivado do gap do dia-ex (`utils/dividendGap.js`) é uma ponte sobre
 * o atraso de 1-3 dias da fonte: no dia-ex o `previousClose` da cotação já vem
 * ajustado pelo provento enquanto o nosso candle da véspera segue bruto, e a
 * diferença é o valor por cota. Onde há pregão e o par de fechamentos é o certo,
 * ele acerta na casa do centavo (KNCR11 1,2500 contra 1,25 real).
 *
 * Onde o par NÃO é o certo, a mesma subtração devolve oscilação de preço com cara
 * de renda. Medição de 09/09/2026 — 928 eventos DERIVED no banco, 36% de todo o
 * razão de proventos, todos criados em setembro:
 *
 *   · 07/09 (Independência, B3 fechada): 44 eventos. A barra de continuação do
 *     Yahoo data o feriado e o `previousClose` dela aponta uma sessão mais atrás
 *     que o nosso candle — KNCR11 virou R$ 0,45 de "provisão a receber" que a B3
 *     nunca publicou, exibida na Carteira como pagamento previsto para 21/09.
 *   · 02-03/09: 516 eventos num dia só, incluindo 304 papéis americanos, na era em
 *     que candle em andamento entrava na série (fechado em 783339d). Fechamento
 *     parcial contra `previousClose` oficial dá gap em TODO ativo: GS "pagou"
 *     US$ 23,34, LMT US$ 16,73.
 *   · Papel dos EUA, todo dia: o `previousClose` da cotação chega 1-2 pontos-base
 *     distante do nosso candle (mesmo fechamento, menos casas decimais), e o teto
 *     absoluto de um centavo deixava o resíduo virar provento de US$ 0,01.
 *
 * E O QUE NÃO É FANTASMA
 * Dos 139 provisórios de FII com data-ex em 01/09, a B3 datou o pagamento de 133,
 * com o valor batendo no centavo (HGLG11 1,17; XPLG11 0,82; MXRF11 0,10). É renda
 * REAL que a nossa fonte de valor (Yahoo) simplesmente não publicou — o provisório
 * é o único registro dela. Critério que olhe só para o Yahoo apagaria esses 133.
 *
 * As portas de entrada foram fechadas na origem (prova de pregão pelo volume e
 * piso relativo de 0,2% em `dividendGap.js`; expiração automática em
 * `financialService.expireUnconfirmedDerivedDividends`). Este script limpa o que
 * já está gravado.
 *
 * OS DOIS CRITÉRIOS (fail-closed)
 *
 *  A) SESSÃO QUE NÃO HOUVE. Data-ex derivada que não é dia útil na B3 E para a
 *     qual não existe candle nosso do próprio ativo. Sem pregão não há data-ex, e
 *     o evento não podia existir — vale em qualquer idade. As duas condições
 *     juntas protegem o papel estrangeiro que negocia em feriado brasileiro: se
 *     ele negociou, tem candle, e não é tocado.
 *
 *  B) PRAZO VENCIDO SEM CONFIRMAÇÃO DE NINGUÉM. Provisório com mais de 7 dias,
 *     sem evento oficial do mesmo ticker a até 4 dias da data-ex (a janela com que
 *     `syncDividends` reconcilia os dois) E sem `paymentDateSource` — isto é, nem a
 *     fonte de VALOR nem a fonte de CALENDÁRIO reconheceram aquele pagamento.
 *     Provisório recente fica: para ele as duas ainda estão dentro do prazo.
 *
 * Nada com procedência de fonte (PROVIDER) é tocado por nenhum dos dois.
 *
 * Idempotente. Uso:
 *   node server/scripts/cleanPhantomDerivedDividends.js --dry
 *   node server/scripts/cleanPhantomDerivedDividends.js
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectScriptDb } from './lib/scriptDb.js';
import DividendEvent from '../models/DividendEvent.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import { DERIVED_EXPIRY_MS, DERIVED_RECONCILE_WINDOW_MS } from '../utils/dividendGap.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { isBrBusinessDay } from '../utils/walletSnapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dryRun = process.argv.slice(2).includes('--dry');

const dia = (d) => new Date(d).toISOString().slice(0, 10);

const run = async () => {
    await connectScriptDb({ label: 'clean-phantom-derived-dividends' });

    console.log(`\n🧹 Limpeza de proventos provisórios não confirmados ${dryRun ? '(DRY RUN)' : ''}\n`);

    const limite = new Date(Date.now() - DERIVED_EXPIRY_MS);
    const provisorios = await DividendEvent.find({ source: 'DERIVED' })
        .select('ticker date amount paymentDateSource').lean();
    const recentes = provisorios.filter((p) => new Date(p.date) >= limite);
    const vencidos = provisorios.filter((p) => new Date(p.date) < limite);

    console.log(`${provisorios.length} provisório(s) no banco — ${vencidos.length} fora do prazo de publicação, ${recentes.length} ainda dentro dele.`);

    if (provisorios.length === 0) {
        console.log('Nada a limpar.\n');
        await mongoose.disconnect();
        return;
    }

    // ── Critério A: data-ex em dia sem pregão, sem candle nosso que a desminta.
    const classes = new Map((await MarketAsset.find({ ticker: { $in: [...new Set(provisorios.map((p) => p.ticker))] } })
        .select('ticker type lastPrice').lean()).map((a) => [a.ticker, a]));
    // Confirmado pela B3 nunca entra em nenhum alvo, nem no A: se o calendário
    // casou valor e data-com, o pagamento existe — e uma data-ex nossa deslocada
    // em um dia é erro de carimbo, não prova de que o provento não houve.
    const emDiaFechado = provisorios.filter((p) => !p.paymentDateSource && !isBrBusinessDay(dia(p.date)));
    const chaves = [...new Set(emDiaFechado.map((p) => historyStorageKey(p.ticker, classes.get(p.ticker)?.type)))];
    const series = new Map((await AssetHistory.find({ ticker: { $in: chaves } }).select('ticker history.date').lean())
        .map((h) => [h.ticker, new Set((h.history || []).map((c) => c.date))]));
    const semSessao = emDiaFechado.filter((p) => {
        const datas = series.get(historyStorageKey(p.ticker, classes.get(p.ticker)?.type));
        return !datas || !datas.has(dia(p.date));
    });

    const tickers = [...new Set(vencidos.map((p) => p.ticker))];
    const oficiais = await DividendEvent.find({ ticker: { $in: tickers }, source: { $ne: 'DERIVED' } })
        .select('ticker date').lean();
    const porTicker = new Map();
    for (const o of oficiais) {
        if (!porTicker.has(o.ticker)) porTicker.set(o.ticker, []);
        porTicker.get(o.ticker).push(new Date(o.date).getTime());
    }

    const porValor = [];
    const porCalendario = [];
    const vencidosOrfaos = [];
    for (const p of vencidos) {
        const t = new Date(p.date).getTime();
        const perto = (porTicker.get(p.ticker) || []).some((o) => Math.abs(o - t) <= DERIVED_RECONCILE_WINDOW_MS);
        if (perto) porValor.push(p);
        else if (p.paymentDateSource) porCalendario.push(p);
        else vencidosOrfaos.push(p);
    }

    const porId = new Map();
    for (const p of [...semSessao, ...vencidosOrfaos]) porId.set(String(p._id), p);
    const orfaos = [...porId.values()];

    console.log(`   ${semSessao.length} em data-ex sem pregão e sem candle nosso (critério A).`);
    console.log(`   ${vencidosOrfaos.length} vencido(s) que nenhuma fonte reconheceu (critério B).`);
    console.log(`   ${porValor.length} confirmado(s) por evento oficial próximo — intactos.`);
    console.log(`   ${porCalendario.length} confirmado(s) pelo calendário de pagamento da B3 — intactos.`);
    console.log(`   ${orfaos.length} alvo(s) no total.\n`);

    if (orfaos.length === 0) {
        await mongoose.disconnect();
        return;
    }

    // Perfil do alvo. Serve para o operador ver, ANTES de apagar, que o que sai é
    // o que as três portas fechadas descrevem — e não renda de verdade.
    const semPregao = orfaos.filter((o) => !isBrBusinessDay(dia(o.date)));
    const porTipo = {};
    const miudos = [];
    for (const o of orfaos) {
        const a = classes.get(o.ticker);
        porTipo[a?.type || '?'] = (porTipo[a?.type || '?'] || 0) + 1;
        if (a?.lastPrice > 0 && o.amount / a.lastPrice < 0.002) miudos.push(o);
    }

    const porDia = {};
    for (const o of orfaos) porDia[dia(o.date)] = (porDia[dia(o.date)] || 0) + 1;

    console.log(`Por data-ex: ${Object.entries(porDia).sort().map(([d, n]) => `${d}:${n}`).join('  ')}`);
    console.log(`Por classe:  ${Object.entries(porTipo).map(([t, n]) => `${t}:${n}`).join('  ')}`);
    console.log(`${semPregao.length} em dia SEM pregão na B3 (fim de semana ou feriado).`);
    console.log(`${miudos.length} abaixo de 0,2% do preço — resíduo de arredondamento, não provento.`);
    console.log('\nAmostra:');
    for (const o of orfaos.slice(0, 8)) {
        const a = classes.get(o.ticker);
        const pct = a?.lastPrice > 0 ? ` (${((o.amount / a.lastPrice) * 100).toFixed(2)}% do preço)` : '';
        console.log(`  ${o.ticker.padEnd(9)} ex=${dia(o.date)}  ${o.amount}${pct}`);
    }

    if (dryRun) {
        console.log('\n✅ DRY RUN concluído (nada foi gravado).\n');
        await mongoose.disconnect();
        return;
    }

    const res = await DividendEvent.deleteMany({ _id: { $in: orfaos.map((o) => o._id) } });
    console.log(`\n✅ ${res.deletedCount} provisório(s) removido(s).`);
    console.log('   Provento de verdade não se perde aqui: o oficial da fonte é PROVIDER e não foi tocado.');
    console.log('   Se a carteira mostrava provisão a receber que não existia, ela sai na próxima leitura.\n');

    await mongoose.disconnect();
};

run().catch(async (e) => {
    console.error('Limpeza falhou:', e);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
