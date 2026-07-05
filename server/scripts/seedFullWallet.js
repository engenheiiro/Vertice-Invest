
/**
 * Gera uma carteira COMPLETA (todas as 7 classes: Ações BR, FIIs, Exterior, ETF,
 * Cripto, Renda Fixa, Caixa) para um usuário já cadastrado, com 2 compras por
 * ativo em datas diferentes — para exercitar preço médio ponderado e FIFO de
 * verdade, não só um holding final estático. Uso em dev/teste (não é fluxo de
 * produção): popula Carteira/Dashboard pra validar UI sem cadastro manual.
 *
 * Reaproveita o MESMO caminho de código da API real (financialService.recalculatePosition
 * + rebuildUserHistory) em vez de escrever UserAsset/WalletSnapshot na mão — garante
 * que o resultado é idêntico ao que a rota POST /wallet/add produziria.
 *
 * Uso: npm run seed:wallet <email> [--reset]
 *   --reset  apaga ativos/transações/snapshots existentes do usuário antes de semear
 *            (destrutivo — só passe se tiver certeza).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';

const daysAgoStr = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
};

// Preços de reserva usados SÓ quando o histórico Yahoo Finance não responde
// (ex.: sem internet no ambiente de dev). São aproximações, não cotações reais —
// o objetivo aqui é gerar uma carteira plausível pra testar UI, não precisão financeira.
const FALLBACK_PRICE = {
    PETR4: 38, VALE3: 62, WEGE3: 52,
    MXRF11: 10.2, HGLG11: 165,
    BOVA11: 135,
    AAPL: 195, MSFT: 430,
    BTC: 95000, ETH: 3400,
};

// Ativos de mercado: 2 lotes por ticker (mais antigo + mais recente) em preços
// históricos reais (via getPriceAtDate) — gera preço médio ponderado e taxLots
// FIFO de verdade, igual a uma conta usada há meses.
const MARKET_BASKET = [
    { ticker: 'PETR4',  type: 'STOCK',    currency: 'BRL', buys: [{ daysAgo: 270, amount: 1200 }, { daysAgo: 80, amount: 900 }] },
    { ticker: 'VALE3',  type: 'STOCK',    currency: 'BRL', buys: [{ daysAgo: 260, amount: 1100 }, { daysAgo: 75, amount: 850 }] },
    { ticker: 'WEGE3',  type: 'STOCK',    currency: 'BRL', buys: [{ daysAgo: 250, amount: 1000 }, { daysAgo: 65, amount: 700 }] },
    { ticker: 'MXRF11', type: 'FII',      currency: 'BRL', buys: [{ daysAgo: 240, amount: 900 },  { daysAgo: 60, amount: 600 }] },
    { ticker: 'HGLG11', type: 'FII',      currency: 'BRL', buys: [{ daysAgo: 230, amount: 1000 }, { daysAgo: 55, amount: 700 }] },
    { ticker: 'BOVA11', type: 'ETF',      currency: 'BRL', buys: [{ daysAgo: 220, amount: 1500 }, { daysAgo: 45, amount: 1000 }] },
    { ticker: 'AAPL',   type: 'STOCK_US', currency: 'USD', fractional: true, buys: [{ daysAgo: 210, amount: 250 }, { daysAgo: 40, amount: 200 }] },
    { ticker: 'MSFT',   type: 'STOCK_US', currency: 'USD', fractional: true, buys: [{ daysAgo: 200, amount: 300 }, { daysAgo: 35, amount: 250 }] },
    { ticker: 'BTC',    type: 'CRYPTO',   currency: 'USD', fractional: true, buys: [{ daysAgo: 190, amount: 300 }, { daysAgo: 20, amount: 150 }] },
    { ticker: 'ETH',    type: 'CRYPTO',   currency: 'USD', fractional: true, buys: [{ daysAgo: 180, amount: 200 }, { daysAgo: 15, amount: 120 }] },
];

// Renda Fixa: no cadastro real cada aporte é 1 transação com quantity=1 e
// price=valor total investido (não "preço por cota") — replicado aqui fielmente
// (ver client/AddAssetModal.tsx: defaultQty='1' travado para FIXED_INCOME).
const FIXED_INCOME_BASKET = [
    { ticker: 'TESOURO SELIC 2029',  index: 'SELIC', spread: 0.08, buys: [{ daysAgo: 300, amount: 3000 }, { daysAgo: 90, amount: 1500 }] },
    { ticker: 'TESOURO IPCA+ 2035',  index: 'IPCA',  spread: 6.2,  buys: [{ daysAgo: 280, amount: 2500 }, { daysAgo: 100, amount: 1200 }] },
];

const CASH_RESERVE = { ticker: 'RESERVA-EMERGENCIA', name: 'Reserva de Emergência', amount: 5000, daysAgo: 20 };

async function insertBuy(userId, ticker, type, quantity, price, dateStr, notes) {
    await new AssetTransaction({
        user: userId, ticker, type: 'BUY',
        quantity, price, totalValue: quantity * price,
        date: new Date(`${dateStr}T12:00:00.000Z`),
        notes,
    }).save();
}

async function seedMarketAsset(userId, def) {
    const ticker = def.ticker.toUpperCase();
    console.log(`\n📈 ${ticker} (${def.type})`);
    for (const buy of def.buys) {
        const dateStr = daysAgoStr(buy.daysAgo);
        let price = null;
        const historical = await marketDataService.getPriceAtDate(ticker, dateStr, def.type);
        if (historical?.price > 0) {
            price = historical.price;
        } else {
            price = FALLBACK_PRICE[ticker] || null;
            if (!price) { console.log(`   ⚠️  Sem preço para ${ticker} em ${dateStr} — pulando lote.`); continue; }
            console.log(`   ⚠️  Histórico indisponível em ${dateStr} — usando preço de fallback R$/US$${price}`);
        }
        const quantity = def.fractional
            ? Number((buy.amount / price).toFixed(6))
            : Math.max(1, Math.floor(buy.amount / price));
        if (quantity <= 0) { console.log(`   ⚠️  Orçamento insuficiente para 1 unidade em ${dateStr} — pulando lote.`); continue; }
        await insertBuy(userId, ticker, def.type, quantity, price, dateStr, `Seed — lote de ${dateStr}`);
        console.log(`   ✅ ${dateStr}: ${quantity} × ${def.currency === 'USD' ? '$' : 'R$'}${price.toFixed(2)}`);
    }
    const asset = await financialService.recalculatePosition(userId, ticker, def.type, null, def.currency);
    return asset;
}

async function seedFixedIncome(userId, def) {
    const ticker = def.ticker.toUpperCase();
    console.log(`\n💰 ${ticker} (FIXED_INCOME, ${def.index} + ${def.spread}%)`);
    for (const buy of def.buys) {
        const dateStr = daysAgoStr(buy.daysAgo);
        // quantity=1 por aporte, price=valor total investido — convenção do cadastro real.
        await insertBuy(userId, ticker, 'FIXED_INCOME', 1, buy.amount, dateStr, `Seed — aporte de ${dateStr}`);
        console.log(`   ✅ ${dateStr}: aporte de R$${buy.amount.toFixed(2)}`);
    }
    const asset = await financialService.recalculatePosition(userId, ticker, 'FIXED_INCOME', null, 'BRL');
    if (asset) {
        asset.fixedIncomeIndex = def.index;
        asset.fixedIncomeSpread = def.spread;
        const oldestBuy = daysAgoStr(Math.max(...def.buys.map(b => b.daysAgo)));
        asset.startDate = new Date(`${oldestBuy}T12:00:00.000Z`);
        await asset.save();
    }
    return asset;
}

async function seedCash(userId, def) {
    console.log(`\n🐷 ${def.ticker} (CASH — ${def.name})`);
    const dateStr = daysAgoStr(def.daysAgo);
    await insertBuy(userId, def.ticker, 'CASH', def.amount, 1, dateStr, `Seed — aporte de ${dateStr}`);
    const asset = await financialService.recalculatePosition(userId, def.ticker, 'CASH', null, 'BRL');
    if (asset) { asset.name = def.name; await asset.save(); }
    console.log(`   ✅ ${dateStr}: R$${def.amount.toFixed(2)}`);
    return asset;
}

async function main() {
    const args = process.argv.slice(2);
    const reset = args.includes('--reset');
    const email = args.find(a => !a.startsWith('--'));

    if (!email) {
        console.error('❌ Uso: npm run seed:wallet <email> [--reset]');
        console.error('   Ex: npm run seed:wallet pai@email.com');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 Conectado ao MongoDB\n');

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
        console.error(`❌ Usuário não encontrado: ${email}`);
        process.exit(1);
    }
    console.log(`✅ Usuário: ${user.name || '—'} (${user.email})`);

    if (reset) {
        console.log('🗑️  --reset: apagando carteira existente...');
        await UserAsset.deleteMany({ user: user._id });
        await AssetTransaction.deleteMany({ user: user._id });
        await WalletSnapshot.deleteMany({ user: user._id });
    }

    for (const def of MARKET_BASKET) {
        await seedMarketAsset(user._id, def);
    }
    for (const def of FIXED_INCOME_BASKET) {
        await seedFixedIncome(user._id, def);
    }
    await seedCash(user._id, CASH_RESERVE);

    console.log('\n🔄 Reconstruindo histórico patrimonial (WalletSnapshot)...');
    try {
        await financialService.rebuildUserHistory(user._id);
        console.log('✅ Histórico reconstruído.');
    } catch (err) {
        console.warn(`⚠️  Rebuild de histórico falhou: ${err.message} (ativos já estão cadastrados)`);
    }

    console.log('\n📰 Sincronizando proventos (Fundamentus/Yahoo, pode demorar)...');
    const dividendTargets = MARKET_BASKET
        .filter(d => !['CRYPTO'].includes(d.type))
        .map(d => ({ ticker: d.ticker, type: d.type }));
    try {
        const result = await financialService.syncDividends(dividendTargets);
        console.log(`✅ Proventos sincronizados: ${result.events} evento(s) em ${result.tickers} ticker(s).`);
    } catch (err) {
        console.warn(`⚠️  Sync de proventos falhou: ${err.message}`);
    }

    const finalAssets = await UserAsset.find({ user: user._id }).sort({ type: 1, ticker: 1 });
    const totalCostBRL = finalAssets.reduce((sum, a) => {
        const rate = 5.4; // só para o resumo impresso; a carteira real usa a taxa live do dia
        return sum + (a.currency === 'USD' ? a.totalCost * rate : a.totalCost);
    }, 0);

    console.log('\n' + '─'.repeat(60));
    console.log(`📋 CARTEIRA COMPLETA — ${user.email}`);
    console.log('─'.repeat(60));
    finalAssets.forEach(a => {
        console.log(`  ${a.ticker.padEnd(22)} ${a.type.padEnd(13)} qtd=${String(a.quantity).padEnd(10)} custo=${a.currency === 'USD' ? '$' : 'R$'}${a.totalCost.toFixed(2)}`);
    });
    console.log('─'.repeat(60));
    console.log(`Total investido (estimado, câmbio fixo p/ resumo): ~R$${totalCostBRL.toFixed(2)}`);
    console.log(`\n👉 Acesse a carteira de ${user.email} no painel para conferir.\n`);

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Erro fatal:', err.message);
    mongoose.disconnect().finally(() => process.exit(1));
});
