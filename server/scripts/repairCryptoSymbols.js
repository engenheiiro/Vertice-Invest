/**
 * RECONCILIA O BANCO COM O CATÁLOGO DE CRIPTO.
 *
 * Existe por causa de um estrago específico, mas a forma dele volta toda vez que
 * um símbolo do catálogo é corrigido: enquanto apontávamos para o token errado,
 * o banco acumulou o preço, o NOME e a SÉRIE INTEIRA do impostor. Trocar o
 * símbolo em `config/cryptoList.js` conserta o futuro e não toca em nada disso —
 * e a série é o pior dos três, porque o worker de séries MESCLA em vez de
 * substituir: sem limpar, a história do token certo entra no mesmo documento que
 * a do impostor e as duas ficam entrelaçadas sem como separar depois.
 *
 * Medido em 05/09/2026: oito moedas nessa condição (TAO, GRT, IMX, UNI, APT,
 * TON, MNT, ARB), com séries de até 401 pontos que não eram do ativo.
 *
 * O DIAGNÓSTICO É O PREÇO, NÃO O NOME. A primeira versão deste script usava o
 * nome gravado como assinatura do estrago — afinal, enquanto o preço vinha do
 * impostor, o enriquecimento gravava o nome dele junto (`TAO` estava salvo como
 * "Together As One USD"). Mas nome também envelhece por conta própria: `USDC`
 * estava salvo com um rótulo antigo e foi acusado junto, e "reparar" o USDC
 * significaria apagar uma série que sempre esteve certa. Nome velho e nome de
 * outro token são indistinguíveis olhando só a string.
 *
 * O que distingue é o PREÇO: pergunta-se ao provedor pelo símbolo CORRIGIDO e
 * compara-se com o que está gravado. Divergência de ordem de grandeza é dado de
 * outro ativo — Arbitrum valia US$ 0,1311 e o banco guardava US$ 0,00063, o
 * preço do "ARbit". Movimento normal de mercado entre dois ciclos de 15 minutos
 * não chega perto do limiar.
 *
 * Duas ações, com pesos diferentes de propósito:
 *   • NOME — reconciliado em todas as moedas do catálogo. É cosmético e reversível.
 *   • PREÇO e SÉRIE — só onde o preço prova contaminação: zera a cotação e APAGA
 *     o `AssetHistory` para o worker reconstruir do símbolo certo. Destrutivo,
 *     então exige evidência, não suspeita.
 *
 * Uso:
 *   node server/scripts/repairCryptoSymbols.js                  # dry-run
 *   node server/scripts/repairCryptoSymbols.js --apply
 *   node server/scripts/repairCryptoSymbols.js --tickers=TAO,GRT --apply
 *
 * Requer MONGO_URI no .env. Confira antes com:
 *   node server/scripts/auditCryptoSymbols.js
 */
import mongoose from 'mongoose';
import YahooFinance from 'yahoo-finance2';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import { connectScriptDb } from './lib/scriptDb.js';
import { CRYPTO_ASSETS, cryptoNameMatches, cryptoYahooSymbol } from '../config/cryptoList.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { marketDataService } from '../services/marketDataService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const alvo = args.find((a) => a.startsWith('--tickers='))?.split('=')[1]
    ?.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) || null;

/**
 * Desvio a partir do qual o preço gravado é de OUTRO ativo.
 *
 * Folgado de propósito: cripto se move, e o que se quer separar não é ruído de
 * mercado, é ordem de grandeza. Os casos reais estavam em 208× (Arbitrum), 6×
 * (Mantle), 273× (Toncoin) e 1,8 bilhão de vezes (Bittensor). Nenhum ciclo de 15
 * minutos chega a 25%, e errar para o lado de NÃO apagar é a direção certa.
 */
const DESVIO_MAXIMO = 0.25;

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

/** Preço ao vivo pelo símbolo CORRIGIDO. `null` quando o provedor não responde. */
const precoVivo = async (ticker) => {
    try {
        const q = await yahooFinance.quote(cryptoYahooSymbol(ticker), {}, { validateResult: false });
        const p = q?.regularMarketPrice;
        return p > 0 ? p : null;
    } catch {
        return null;
    }
};


const run = async () => {
    await connectScriptDb({ label: 'repairCryptoSymbols' });

    const catalogo = alvo ? CRYPTO_ASSETS.filter((c) => alvo.includes(c.ticker)) : CRYPTO_ASSETS;
    // `type: 'CRYPTO'` não é detalhe de performance: sem ele este script comete o
    // MESMO erro que veio consertar. O catálogo tem `STX` (Stacks) e o banco tem
    // `STX` (Seagate, STOCK_US) — casar só pelo texto do ticker renomearia uma
    // ação do S&P 500 para "Stacks" e apagaria a série dela, que está correta.
    // O dry-run pegou isso; a guarda existe para não depender de alguém ler.
    const docs = await MarketAsset.find({ ticker: { $in: catalogo.map((c) => c.ticker) }, type: 'CRYPTO' })
        .select('ticker name lastPrice priceDate type').lean();
    const porTicker = new Map(docs.map((d) => [d.ticker, d]));

    console.log(`\n🧼 Reconciliação do catálogo de cripto ${apply ? '(APLICANDO)' : '(DRY-RUN — nada será gravado)'}`);
    console.log(`   ${catalogo.length} moeda(s) no catálogo · ${docs.length} no banco · consultando o provedor…\n`);

    const contaminados = [];
    const renomear = [];
    for (const c of catalogo) {
        const doc = porTicker.get(c.ticker);
        if (!doc) continue; // ainda não semeada; o sync a cria com o nome certo

        if (!cryptoNameMatches(c.ticker, doc.name)) renomear.push({ c, doc });

        // A pergunta destrutiva precisa da resposta do provedor, então ela custa
        // uma chamada por moeda. É um script manual: a lentidão é aceitável, e o
        // contrário — apagar série por suspeita — não é.
        const vivo = await precoVivo(c.ticker);
        if (vivo === null) continue;              // sem resposta: não condena
        if (!(doc.lastPrice > 0)) continue;       // sem preço gravado: nada a comparar
        const desvio = Math.abs(doc.lastPrice - vivo) / vivo;
        if (desvio > DESVIO_MAXIMO) contaminados.push({ c, doc, vivo, desvio });
    }

    if (!renomear.length && !contaminados.length) {
        console.log('✅ Nada a reparar: nome e preço conferem em todas as moedas.\n');
        await mongoose.disconnect();
        return;
    }

    if (renomear.length) {
        console.log(`✏️  Nome a reconciliar (${renomear.length}):`);
        for (const { c, doc } of renomear) console.log(`   • ${c.ticker.padEnd(7)} "${doc.name}" ⇒ "${c.name}"`);
        console.log('');
    }

    if (!contaminados.length) {
        console.log('✅ Nenhum preço divergente: nenhuma série será apagada.\n');
        if (apply) {
            await MarketAsset.bulkWrite(renomear.map(({ c }) => ({
                updateOne: { filter: { ticker: c.ticker }, update: { $set: { name: c.name } } },
            })));
            console.log(`✅ ${renomear.length} nome(s) reconciliado(s).\n`);
        } else {
            console.log('ℹ️  DRY-RUN: rode com --apply para reconciliar os nomes.\n');
        }
        await mongoose.disconnect();
        return;
    }

    console.log(`⛔ Preço de OUTRO ativo (${contaminados.length}) — série será apagada e reconstruída:`);

    const chaves = contaminados.map(({ c }) => historyStorageKey(c.ticker, 'CRYPTO'));
    const series = await AssetHistory.find({ ticker: { $in: chaves } })
        .select('ticker history').lean();
    const pontosPor = new Map(series.map((s) => [s.ticker, (s.history || []).length]));

    for (const { c, doc, vivo, desvio } of contaminados) {
        const chave = historyStorageKey(c.ticker, 'CRYPTO');
        console.log(`   • ${c.ticker.padEnd(7)} → ${cryptoYahooSymbol(c.ticker)}   (${c.name})`);
        console.log(`       gravado: ${doc.lastPrice} (sessão ${doc.priceDate})`);
        // O fator diz mais que a porcentagem: com o gravado perto de zero o desvio
        // satura em ~100% e o Bittensor (1,8 bilhão de vezes) leria igual a uma
        // moeda que dobrou de preço.
        const fator = doc.lastPrice > 0 ? Math.max(vivo / doc.lastPrice, doc.lastPrice / vivo) : Infinity;
        console.log(`       real:    ${vivo}   — ${fator >= 10 ? `${fator.toExponential(1)}× de diferença` : `${(desvio * 100).toFixed(0)}% de desvio`}`);
        console.log(`       série:   ${chave} com ${pontosPor.get(chave) ?? 0} ponto(s) ⇒ apagar e reconstruir`);
    }

    if (!apply) {
        console.log('\nℹ️  DRY-RUN: rode com --apply para reparar.\n');
        await mongoose.disconnect();
        return;
    }

    const tickers = contaminados.map(({ c }) => c.ticker);
    const paraRenomear = new Set(renomear.map(({ c }) => c.ticker));
    const ops = [
        // Nome: reconciliação simples, sem tocar em mais nada.
        ...renomear.filter(({ c }) => !tickers.includes(c.ticker)).map(({ c }) => ({
            updateOne: { filter: { ticker: c.ticker }, update: { $set: { name: c.name } } },
        })),
        // Contaminado: zera o que veio do outro token em vez de deixar como ponto
        // de partida — preço de outro ativo não é aproximação de nada.
        ...contaminados.map(({ c }) => ({
            updateOne: {
                filter: { ticker: c.ticker },
                update: {
                    $set: {
                        ...(paraRenomear.has(c.ticker) ? { name: c.name } : {}),
                        lastPrice: 0, change: 0, previousClose: 0,
                        priceDate: null, failCount: 0, lastFailDate: null,
                    },
                },
            },
        })),
    ];
    await MarketAsset.bulkWrite(ops);
    console.log(`\n✅ ${renomear.length} nome(s) reconciliado(s) · ${tickers.length} preço(s) zerado(s) para recotar.`);

    const del = await AssetHistory.deleteMany({ ticker: { $in: chaves } });
    console.log(`🗑️  ${del.deletedCount} série(s) do impostor apagada(s) — o worker reconstrói do símbolo certo.`);

    // Re-cota já, pela cadeia normal: o painel e o ranking não precisam esperar
    // o próximo ciclo de 15 minutos para deixar de mostrar zero.
    await marketDataService.refreshQuotesBatch(tickers, true);
    const depois = await MarketAsset.find({ ticker: { $in: tickers } })
        .select('ticker name lastPrice priceDate').sort({ ticker: 1 }).lean();
    console.log('\n📈 Depois da recotação:');
    for (const d of depois) {
        const ok = d.lastPrice > 0 ? '✅' : '⚠️ ';
        console.log(`   ${ok} ${d.ticker.padEnd(7)} ${String(d.lastPrice).padEnd(14)} sessão=${d.priceDate}  ${d.name}`);
    }
    console.log('\n📌 A série é reconstruída pelo worker (npm run sync:TimeSeriesWorker ou o cron diário).\n');

    await mongoose.disconnect();
};

run().catch(async (e) => {
    console.error('Falha no reparo:', e.message);
    try { await mongoose.disconnect(); } catch { /* já desconectado */ }
    process.exit(1);
});
