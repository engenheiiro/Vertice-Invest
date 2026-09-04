import dotenv from 'dotenv';
dotenv.config({ path: 'D:/Github/Vertice-Invest/.env' });
import mongoose from 'mongoose';
import axios from 'axios';

const DEADLINE = Date.now() + 22 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const col = mongoose.connection.db.collection('systemconfigs');

// Espera um run NOVO (posterior ao push) para não ler o resultado da ordem antiga.
const pushedAt = new Date('2026-09-04T18:55:00.000Z');
let doc = null;
while (Date.now() < DEADLINE) {
  doc = await col.findOne({ key: 'MACRO_INDICATORS' });
  if (doc?.currenciesUpdatedAt && new Date(doc.currenciesUpdatedAt) > pushedAt) break;
  await sleep(60000);
}

const live = await axios.get('https://economia.awesomeapi.com.br/last/USD-BRL,BTC-USD', { timeout: 10000 });
const liveUsd = parseFloat(live.data.USDBRL.bid);
const liveBtc = parseFloat(live.data.BTCUSD.bid);
const drift = (a, b) => `${(((a - b) / b) * 100).toFixed(3)}%`;

console.log('\n===== PRODUÇÃO APÓS O REORDENAMENTO =====');
console.log('currenciesUpdatedAt:', doc?.currenciesUpdatedAt);
console.log('currenciesStale    :', doc?.currenciesStale);
console.log('currenciesSources  :', JSON.stringify(doc?.currenciesSources));
console.log('---');
console.log(`dollar banco ${doc?.dollar} | mercado ${liveUsd} | desvio ${drift(doc?.dollar, liveUsd)}`);
console.log(`btc    banco ${doc?.btc} | mercado ${liveBtc} | desvio ${drift(doc?.btc, liveBtc)}`);

await mongoose.disconnect();
process.exit(0);
