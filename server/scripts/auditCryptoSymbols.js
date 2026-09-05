/**
 * AUDITORIA DOS SÍMBOLOS DE CRIPTO — READ-ONLY.
 *
 * Responde a pergunta que nenhuma falha responde: "o preço que chega é do token
 * que a gente pensa que é?".
 *
 * Ticker de cripto não é único. Quando dois tokens disputam a sigla, o Yahoo
 * desempata com o id da CoinMarketCap (`TAO22974-USD`) e serve o IMPOSTOR no
 * símbolo curto (`TAO-USD`). Nada nisso é erro: a chamada volta 200, com preço,
 * com data de sessão — de outro ativo. Em 05/09/2026 eram 11 moedas assim, e
 * três delas (Toncoin, Mantle, Arbitrum) tinham impostor NEGOCIANDO no mesmo
 * dia, o que torna qualquer régua de frescor cega para o caso.
 *
 * O que sobra é comparar o NOME. Este script pergunta ao provedor por cada
 * símbolo do catálogo e confronta com o nome que o catálogo declara — é o passo
 * obrigatório antes de acrescentar moeda em `config/cryptoList.js`.
 *
 * Uso:
 *   node server/scripts/auditCryptoSymbols.js              # catálogo inteiro
 *   node server/scripts/auditCryptoSymbols.js --tickers=TAO,GRT
 *
 * Não escreve nada e não precisa de banco.
 */
import YahooFinance from 'yahoo-finance2';
import { CRYPTO_ASSETS, cryptoNameMatches, cryptoYahooSymbol } from '../config/cryptoList.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const args = process.argv.slice(2);
const alvo = args.find((a) => a.startsWith('--tickers='))?.split('=')[1]
    ?.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) || null;

/** Sessão mais velha que isto já é suspeita por si só. */
const DIAS_SUSPEITOS = 3;


const run = async () => {
    const lista = alvo ? CRYPTO_ASSETS.filter((c) => alvo.includes(c.ticker)) : CRYPTO_ASSETS;
    if (!lista.length) {
        console.log('Nenhuma moeda do catálogo no alvo.');
        return;
    }
    console.log(`\n🪙 Auditoria de símbolos · ${lista.length} moeda(s) do catálogo\n`);

    const divergentes = [];
    const antigos = [];
    const semResposta = [];

    for (const c of lista) {
        const simbolo = cryptoYahooSymbol(c.ticker);
        let q = null;
        try {
            q = await yahooFinance.quote(simbolo, {}, { validateResult: false });
        } catch { /* ausência de resposta é o dado que interessa */ }

        const nome = q?.longName || q?.shortName || null;
        const preco = q?.regularMarketPrice ?? null;
        const dias = q?.regularMarketTime
            ? Math.floor((Date.now() - new Date(q.regularMarketTime).getTime()) / 86400000)
            : null;

        if (!(preco > 0)) {
            semResposta.push(c.ticker);
            console.log(`❔ ${c.ticker.padEnd(7)} ${simbolo.padEnd(14)} sem cotação — declarado: ${c.name}`);
            continue;
        }

        const bate = cryptoNameMatches(c.ticker, nome);
        if (!bate) divergentes.push(c.ticker);
        else if (dias !== null && dias > DIAS_SUSPEITOS) antigos.push(c.ticker);

        const marca = !bate ? '⛔' : (dias !== null && dias > DIAS_SUSPEITOS ? '⚠️ ' : '✅');
        const idade = dias === null ? '  ?d' : `${String(dias).padStart(4)}d`;
        console.log(`${marca} ${c.ticker.padEnd(7)} ${simbolo.padEnd(14)} ${idade}  ${String(preco).padEnd(14)} ${nome}${bate ? '' : `   ← esperado: ${c.name}`}`);
    }

    console.log('');
    if (divergentes.length) {
        console.log(`⛔ NOME DIVERGENTE (${divergentes.length}): ${divergentes.join(', ')}`);
        console.log('   O símbolo aponta para OUTRO token. Corrija o campo `yahoo` em config/cryptoList.js.');
    }
    if (antigos.length) {
        console.log(`⚠️  SESSÃO ANTIGA (${antigos.length}): ${antigos.join(', ')}`);
        console.log(`   Nome bate, mas o símbolo parou de negociar há mais de ${DIAS_SUSPEITOS} dias — candidato a renomeação do token.`);
    }
    if (semResposta.length) {
        console.log(`❔ SEM COTAÇÃO (${semResposta.length}): ${semResposta.join(', ')}`);
    }
    if (!divergentes.length && !antigos.length && !semResposta.length) {
        console.log('✅ Todo o catálogo confere: nome e sessão recentes em todas as moedas.');
    }
    console.log('');
};

run().catch((e) => {
    console.error('Falha na auditoria:', e.message);
    process.exit(1);
});
