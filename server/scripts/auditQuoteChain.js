/**
 * AUDITORIA DA CADEIA DE COTAÇÃO — READ-ONLY.
 *
 * Responde a pergunta que o painel de fontes não responde sozinho: "todo mundo
 * está recebendo preço, e o preço está CERTO?".
 *
 * O painel mostra o que aconteceu nas chamadas recentes. Logo depois de um
 * reinício isso são três chamadas, e três chamadas verdes não provam cobertura —
 * provam que o pouco que foi pedido chegou. Aqui o universo inteiro é perguntado
 * de uma vez, pela MESMA cadeia da produção (`externalMarketService.getQuotes`),
 * e o resultado é cruzado com o fechamento oficial da B3.
 *
 * Duas perguntas, porque uma não cobre a outra:
 *   1. **Chegou preço?** — quem ficou sem, e quem precisou de reserva (o ledger
 *      de escaladas do processo diz o caminho de cada ativo).
 *   2. **O preço está certo?** — para papel da B3, comparação com o LastPric do
 *      arquivo do pregão. Fonte que devolve número errado é pior que fonte que
 *      não devolve nada: o erro entra no ranking e na carteira sem avisar.
 *
 * Não escreve nada. `getQuotes` só lê; a gravação mora em `refreshQuotesBatch`.
 *
 * Uso:
 *   node server/scripts/auditQuoteChain.js                 # universo ativo inteiro
 *   node server/scripts/auditQuoteChain.js --tickers=A,B   # alvo explícito
 *   node server/scripts/auditQuoteChain.js --limit=200     # amostra
 *   node server/scripts/auditQuoteChain.js --chunk=60      # tamanho do lote
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import { connectScriptDb } from './lib/scriptDb.js';
import { externalMarketService } from '../services/externalMarketService.js';
import { fetchB3DailyCloses } from '../services/b3DailyFileService.js';
import { getEscalations } from '../utils/sourceHealth.js';
import { isB3Ticker } from '../utils/tickerShape.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const valueOf = (flag) => args.find((a) => a.startsWith(`${flag}=`))?.split('=')[1] || null;
const explicit = valueOf('--tickers')?.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) || null;
const LIMIT = Number(valueOf('--limit') || 0);
// Lote do Yahoo. Grande demais e a resposta vem truncada sem erro; pequeno demais
// multiplica as idas. 60 é o meio-termo que o sync usa na prática.
const CHUNK = Number(valueOf('--chunk') || 60);

/** Divergência a partir da qual o preço merece o olho. */
const TOLERANCIA_PCT = 1;

const pct = (a, b) => (b > 0 ? Math.abs((a - b) / b) * 100 : null);

const run = async () => {
    await connectScriptDb({ label: 'auditQuoteChain' });

    const query = explicit
        ? { ticker: { $in: explicit } }
        : { isActive: true, isBlacklisted: { $ne: true }, isIgnored: { $ne: true } };
    let docs = await MarketAsset.find(query).select('ticker type lastPrice').sort({ ticker: 1 }).lean();
    if (LIMIT > 0) docs = docs.slice(0, LIMIT);

    if (!docs.length) {
        console.log('Nenhum ativo no alvo.');
        await mongoose.disconnect();
        return;
    }

    const tipoDe = Object.fromEntries(docs.map((d) => [d.ticker, d.type]));
    const tickers = docs.map((d) => d.ticker);
    console.log(`\n🔎 Auditoria da cadeia de cotação · ${tickers.length} ativo(s) · lotes de ${CHUNK}\n`);

    // Fechamento oficial do último pregão publicado — a régua da pergunta 2.
    let closes = null;
    let diaB3 = null;
    for (let i = 0; i < 7 && !closes; i += 1) {
        const dia = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
         
        const c = await fetchB3DailyCloses(dia);
        if (c) { closes = c; diaB3 = dia; }
    }
    console.log(closes ? `📄 Régua da B3: pregão de ${diaB3}\n` : '⚠️  Sem arquivo da B3 — só a pergunta 1 será respondida\n');

    const recebidos = new Map();
    for (let i = 0; i < tickers.length; i += CHUNK) {
        const lote = tickers.slice(i, i + CHUNK);
        process.stdout.write(`   lote ${Math.floor(i / CHUNK) + 1}/${Math.ceil(tickers.length / CHUNK)} (${lote.length})…\r`);
         
        const quotes = await externalMarketService.getQuotes(lote, { typeByTicker: tipoDe });
        for (const q of quotes || []) {
            if (q?.ticker && q.price > 0) recebidos.set(q.ticker.toUpperCase(), q);
        }
    }
    console.log(' '.repeat(60));

    const semPreco = tickers.filter((t) => !recebidos.has(t));
    const porFonte = {};
    for (const q of recebidos.values()) porFonte[q.source || '?'] = (porFonte[q.source || '?'] || 0) + 1;

    console.log('── 1. CHEGOU PREÇO? ───────────────────────────────────');
    console.log(`   ✅ com preço: ${recebidos.size}/${tickers.length} (${((recebidos.size / tickers.length) * 100).toFixed(1)}%)`);
    for (const [fonte, n] of Object.entries(porFonte).sort((a, b) => b[1] - a[1])) {
        console.log(`      · ${fonte}: ${n}`);
    }
    if (semPreco.length) {
        console.log(`   ⛔ sem preço em fonte nenhuma (${semPreco.length}):`);
        for (const t of semPreco) console.log(`      ${t.padEnd(10)} [${tipoDe[t]}]`);
    } else {
        console.log('   ⛔ sem preço: nenhum');
    }

    const escaladas = getEscalations();
    console.log(`\n── 2. QUEM PRECISOU DE RESERVA? (${escaladas.length}) ──────────`);
    if (!escaladas.length) {
        console.log('   Nenhum: o Yahoo cobriu o universo inteiro nesta passada.');
    }
    for (const e of escaladas) {
        const quem = e.resolvedBy || 'NINGUÉM';
        console.log(`   ${e.subject.padEnd(10)} ${e.tried.join(' → ')}  ⇒ ${quem}`);
    }

    if (closes) {
        console.log('\n── 3. O PREÇO ESTÁ CERTO? (contra o fechamento da B3) ──');
        const divergentes = [];
        let conferidos = 0;
        for (const [ticker, q] of recebidos) {
            if (!isB3Ticker(ticker)) continue;
            const oficial = closes.get(ticker);
            if (!oficial) continue;
            conferidos += 1;
            const d = pct(q.price, oficial.close);
            if (d !== null && d > TOLERANCIA_PCT) {
                divergentes.push({ ticker, nosso: q.price, oficial: oficial.close, d, fonte: q.source });
            }
        }
        console.log(`   Conferidos: ${conferidos} ativo(s) da B3 presentes no arquivo`);
        if (!divergentes.length) {
            console.log(`   ✅ Todos dentro de ${TOLERANCIA_PCT}% do fechamento oficial.`);
        } else {
            console.log(`   ⚠️  ${divergentes.length} fora da tolerância:`);
            for (const v of divergentes.sort((a, b) => b.d - a.d).slice(0, 30)) {
                console.log(`      ${v.ticker.padEnd(10)} nosso=${String(v.nosso).padEnd(10)} B3=${String(v.oficial).padEnd(10)} Δ=${v.d.toFixed(2)}%  [${v.fonte}]`);
            }
        }
    }

    await mongoose.disconnect();
};

run().catch((e) => {
    console.error('❌ Erro:', e.message);
    process.exit(1);
});
