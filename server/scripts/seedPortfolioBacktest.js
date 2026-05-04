
/**
 * Backtest de Portfólio — cadastra um ranking publicado na carteira de um usuário
 * com preços históricos de uma data específica.
 *
 * Uso: npm run backtest:portfolio
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User.js';
import MarketAnalysis from '../models/MarketAnalysis.js';
import AssetTransaction from '../models/AssetTransaction.js';
import SystemConfig from '../models/SystemConfig.js';
import { marketDataService } from '../services/marketDataService.js';
import { financialService } from '../services/financialService.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

const PORTFOLIOS = [
    { label: 'Brasil 10 (Top 5 Ações + Top 5 FIIs)', assetClass: 'BRASIL_10' },
    { label: 'Ações (STOCK)',                         assetClass: 'STOCK' },
    { label: 'FIIs',                                  assetClass: 'FII' },
    { label: 'Cripto (CRYPTO)',                       assetClass: 'CRYPTO' },
];

const PROFILES = [
    { label: 'Defensiva  — ativos conservadores, menor risco', value: 'DEFENSIVE' },
    { label: 'Moderado   — equilíbrio entre retorno e risco',  value: 'MODERATE'  },
    { label: 'Arrojado   — maior potencial, maior volatilidade', value: 'BOLD'    },
];

const DATE_OPTIONS = [
    { label: '1 semana atrás',   days: 7 },
    { label: '30 dias atrás',    days: 30 },
    { label: '1 ano atrás',      days: 365 },
    { label: '2 anos atrás',     days: 730 },
    { label: 'Data personalizada', days: null },
];

function calcPastDate(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
}

function formatBRL(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function pickNum(input, max) {
    const n = parseInt(input) - 1;
    if (isNaN(n) || n < 0 || n >= max) return -1;
    return n;
}

async function main() {
    console.log('\n📊  BACKTEST DE PORTFÓLIO — Vértice Invest\n');

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('📡 Conectado ao MongoDB\n');
    } catch (err) {
        console.error('❌ Falha na conexão:', err.message);
        process.exit(1);
    }

    // ── 1. Selecionar usuário ─────────────────────────────────────────────────
    const users = await User.find({}).select('_id name email plan').sort({ email: 1 });
    if (!users.length) { console.error('❌ Nenhum usuário encontrado.'); process.exit(1); }

    console.log('👤 Usuários disponíveis:');
    users.forEach((u, i) => console.log(`  [${i + 1}] ${u.email} (${u.name || '—'}) — ${u.plan}`));

    const userIdx = pickNum(await ask('\nEscolha o usuário [número]: '), users.length);
    if (userIdx < 0) { console.error('❌ Opção inválida.'); process.exit(1); }
    const targetUser = users[userIdx];
    console.log(`✅ Usuário selecionado: ${targetUser.email}\n`);

    // ── 2. Selecionar portfólio ───────────────────────────────────────────────
    console.log('📁 Portfólios disponíveis:');
    PORTFOLIOS.forEach((p, i) => console.log(`  [${i + 1}] ${p.label}`));

    const portIdx = pickNum(await ask('\nEscolha o portfólio [número]: '), PORTFOLIOS.length);
    if (portIdx < 0) { console.error('❌ Opção inválida.'); process.exit(1); }
    const portfolio = PORTFOLIOS[portIdx];
    console.log(`✅ Portfólio: ${portfolio.label}\n`);

    // ── 3. Selecionar perfil de risco ─────────────────────────────────────────
    console.log('🎯 Perfil de risco (quais ativos do ranking serão cadastrados):');
    PROFILES.forEach((p, i) => console.log(`  [${i + 1}] ${p.label}`));

    const profIdx = pickNum(await ask('\nEscolha o perfil [número]: '), PROFILES.length);
    if (profIdx < 0) { console.error('❌ Opção inválida.'); process.exit(1); }
    const selectedProfile = PROFILES[profIdx];
    console.log(`✅ Perfil: ${selectedProfile.label.split('—')[0].trim()}\n`);

    // ── 5. Selecionar data de compra ──────────────────────────────────────────
    console.log('📅 Data de compra:');
    DATE_OPTIONS.forEach((d, i) => console.log(`  [${i + 1}] ${d.label}`));

    const dateIdx = pickNum(await ask('\nEscolha a data [número]: '), DATE_OPTIONS.length);
    if (dateIdx < 0) { console.error('❌ Opção inválida.'); process.exit(1); }

    let purchaseDateStr;
    if (DATE_OPTIONS[dateIdx].days === null) {
        purchaseDateStr = (await ask('  Digite a data (YYYY-MM-DD): ')).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDateStr)) {
            console.error('❌ Formato inválido. Use YYYY-MM-DD.'); process.exit(1);
        }
    } else {
        purchaseDateStr = calcPastDate(DATE_OPTIONS[dateIdx].days);
    }

    if (new Date(purchaseDateStr) < new Date('2020-01-01')) {
        console.error('❌ Data anterior a 2020-01-01 não suportada (limite do histórico Yahoo Finance).');
        process.exit(1);
    }
    if (new Date(purchaseDateStr) > new Date()) {
        console.error('❌ Data futura não permitida.'); process.exit(1);
    }
    console.log(`✅ Data de compra: ${purchaseDateStr}\n`);

    // ── 6. Valor total a investir ─────────────────────────────────────────────
    const investInput = (await ask('💰 Valor total a investir em R$ (ex: 10000): R$ ')).trim().replace(',', '.');
    const totalInvestment = parseFloat(investInput);
    if (isNaN(totalInvestment) || totalInvestment <= 0) {
        console.error('❌ Valor inválido.'); process.exit(1);
    }

    // ── 7. Buscar ranking publicado ───────────────────────────────────────────
    console.log(`\n🔍 Buscando ranking ${portfolio.assetClass} / perfil ${selectedProfile.value}...`);
    const analysis = await MarketAnalysis.findOne({
        assetClass: portfolio.assetClass,
        isRankingPublished: true
    }).sort({ createdAt: -1 });

    if (!analysis?.content?.ranking?.length) {
        console.error(`❌ Nenhum ranking publicado para ${portfolio.assetClass}.`); process.exit(1);
    }

    const buyAssets = analysis.content.ranking
        .filter(a => a.action === 'BUY' && a.riskProfile === selectedProfile.value)
        .slice(0, 10);
    if (!buyAssets.length) {
        console.error(`❌ Nenhum ativo com COMPRAR no perfil ${selectedProfile.value}. Tente outro perfil ou atualize o ranking.`);
        process.exit(1);
    }
    console.log(`✅ ${buyAssets.length} ativos encontrados (perfil ${selectedProfile.value}, top 10 da aba Research).\n`);

    // ── 8. Buscar preços históricos ───────────────────────────────────────────
    console.log(`📈 Buscando preços em ${purchaseDateStr} (pode demorar, busca no Yahoo Finance)...`);

    const sysConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    const currentUsdRate = sysConfig?.dollar || 5.75;

    const eligible = [];
    const skipped = [];

    for (const asset of buyAssets) {
        process.stdout.write(`   ${asset.ticker}... `);
        const result = await marketDataService.getPriceAtDate(asset.ticker, purchaseDateStr, asset.type);
        if (!result || result.price <= 0) {
            skipped.push({ ticker: asset.ticker, reason: 'Preço histórico não encontrado' });
            console.log('❌ sem preço');
            continue;
        }
        console.log(`✅ R$${result.price.toFixed(2)}${result.foundDate ? ` (≈${result.foundDate})` : ''}`);
        eligible.push({
            ticker:         asset.ticker,
            type:           asset.type,
            name:           asset.name,
            historicalPrice: result.price,
            foundDate:      result.foundDate || purchaseDateStr,
            isUSD:          asset.type === 'CRYPTO' || asset.type === 'STOCK_US',
        });
    }

    if (!eligible.length) {
        console.error('\n❌ Nenhum preço histórico encontrado. Tente uma data mais recente.');
        process.exit(1);
    }

    // Calcular quantidade por ativo
    const perAssetBRL = totalInvestment / eligible.length;
    const eligibleWithQty = [];

    for (const asset of eligible) {
        const priceInBRL = asset.isUSD ? asset.historicalPrice * currentUsdRate : asset.historicalPrice;
        const quantity   = Math.floor(perAssetBRL / priceInBRL);
        if (quantity === 0) {
            skipped.push({ ticker: asset.ticker, reason: `Orçamento insuficiente (${formatBRL(perAssetBRL)} / ${formatBRL(priceInBRL)})` });
            continue;
        }
        eligibleWithQty.push({ ...asset, quantity, priceInBRL, actualCostBRL: quantity * priceInBRL });
    }

    if (!eligibleWithQty.length) {
        console.error('❌ Nenhum ativo com quantidade > 0. Aumente o valor de investimento.');
        process.exit(1);
    }

    // ── 9. Confirmação ────────────────────────────────────────────────────────
    const totalActualCost = eligibleWithQty.reduce((s, a) => s + a.actualCostBRL, 0);

    console.log('\n' + '─'.repeat(72));
    console.log('📋 RESUMO DO BACKTEST');
    console.log('─'.repeat(72));
    console.log(`Usuário     : ${targetUser.email} (${targetUser.name || '—'})`);
    console.log(`Portfólio   : ${portfolio.label}`);
    console.log(`Perfil      : ${selectedProfile.label.split('—')[0].trim()} (${selectedProfile.value})`);
    console.log(`Data compra : ${purchaseDateStr}`);
    console.log(`Ativos      : ${eligibleWithQty.length} com COMPRAR${skipped.length ? ` | ${skipped.length} ignorados` : ''}`);
    console.log(`Budget      : ${formatBRL(totalInvestment)} total | ${formatBRL(perAssetBRL)} por ativo`);
    console.log(`Custo real  : ${formatBRL(totalActualCost)} (arredondamento de lotes inteiros)`);

    if (skipped.length) {
        console.log('\n⚠️  Ignorados:');
        skipped.forEach(s => console.log(`   [SKIP] ${s.ticker} — ${s.reason}`));
    }

    console.log('\n📦 Ativos a cadastrar:');
    const col = (s, w) => String(s).padEnd(w);
    console.log(col('Ticker', 10) + col('Preço hist.', 14) + col('Qtd', 8) + col('Custo', 16) + 'Data usada');
    console.log('─'.repeat(60));
    for (const a of eligibleWithQty) {
        const priceStr = a.isUSD ? `$${a.historicalPrice.toFixed(2)}` : `R$${a.historicalPrice.toFixed(2)}`;
        const dateNote = a.foundDate !== purchaseDateStr ? `≈${a.foundDate}` : purchaseDateStr;
        console.log(col(a.ticker, 10) + col(priceStr, 14) + col(a.quantity, 8) + col(formatBRL(a.actualCostBRL), 16) + dateNote);
    }
    console.log('─'.repeat(60));

    const confirm = (await ask('\n⚡ Confirmar cadastro? [s/N]: ')).trim().toLowerCase();
    if (confirm !== 's') { console.log('Cancelado.'); rl.close(); await mongoose.disconnect(); process.exit(0); }

    // ── 10. Cadastrar transações ──────────────────────────────────────────────
    console.log('\n🚀 Cadastrando transações...\n');
    const purchaseDate = new Date(purchaseDateStr + 'T12:00:00.000Z');
    const results = [];

    for (const asset of eligibleWithQty) {
        try {
            await new AssetTransaction({
                user:       targetUser._id,
                ticker:     asset.ticker,
                type:       'BUY',
                quantity:   asset.quantity,
                price:      asset.historicalPrice,
                totalValue: asset.quantity * asset.historicalPrice,
                date:       purchaseDate,
                notes:      `Backtest ${portfolio.assetClass} — data: ${purchaseDateStr}`,
            }).save();

            await financialService.recalculatePosition(targetUser._id, asset.ticker, asset.type);

            // Preço atual para cálculo do retorno estimado
            const mkt = await marketDataService.getMarketDataByTicker(asset.ticker);
            const currentPrice    = mkt?.price || 0;
            const currentPriceBRL = asset.isUSD ? currentPrice * currentUsdRate : currentPrice;
            const returnPct = currentPriceBRL > 0 && asset.priceInBRL > 0
                ? ((currentPriceBRL - asset.priceInBRL) / asset.priceInBRL * 100).toFixed(1)
                : null;

            results.push({ ...asset, currentPrice, currentPriceBRL, returnPct, success: true });
            console.log(`  ✅ ${asset.ticker} — ${asset.quantity}x ${asset.isUSD ? '$' : 'R$'}${asset.historicalPrice.toFixed(2)}`);
        } catch (err) {
            results.push({ ticker: asset.ticker, success: false, error: err.message });
            console.log(`  ❌ ${asset.ticker} — ${err.message}`);
        }
    }

    // ── 11. Reconstruir histórico de snapshots ────────────────────────────────
    console.log('\n🔄 Reconstruindo histórico patrimonial (pode demorar alguns minutos)...');
    try {
        await financialService.rebuildUserHistory(targetUser._id);
        console.log('✅ Histórico reconstruído.\n');
    } catch (err) {
        console.warn(`⚠️  Histórico não pôde ser reconstruído: ${err.message}`);
        console.warn('   Ativos cadastrados corretamente; gráfico histórico pode estar incompleto.\n');
    }

    // ── 12. Tabela de resultado ───────────────────────────────────────────────
    const ok = results.filter(r => r.success);
    if (ok.length) {
        const LINE = '─'.repeat(80);
        console.log(LINE);
        console.log('📊 RESULTADO DO BACKTEST');
        console.log(LINE);
        console.log(col('Ativo', 10) + col('Preço compra', 14) + col('Preço atual', 14) + col('Qtd', 8) + col('Custo BRL', 16) + 'Resultado');
        console.log(LINE);

        let totalCostBRL    = 0;
        let totalCurrentBRL = 0;

        for (const r of ok) {
            const buyPriceStr  = r.isUSD ? `$${r.historicalPrice.toFixed(2)}` : `R$${r.historicalPrice.toFixed(2)}`;
            const currPriceStr = r.isUSD ? `$${r.currentPrice.toFixed(2)}`    : `R$${r.currentPrice.toFixed(2)}`;
            const retStr       = r.returnPct !== null ? `${r.returnPct > 0 ? '+' : ''}${r.returnPct}%` : 'N/A';
            console.log(col(r.ticker, 10) + col(buyPriceStr, 14) + col(currPriceStr, 14) + col(r.quantity, 8) + col(formatBRL(r.actualCostBRL), 16) + retStr);
            totalCostBRL    += r.actualCostBRL;
            totalCurrentBRL += r.currentPriceBRL * r.quantity;
        }

        const totalRet = totalCostBRL > 0 ? ((totalCurrentBRL - totalCostBRL) / totalCostBRL * 100).toFixed(1) : '0.0';
        const sign     = parseFloat(totalRet) >= 0 ? '+' : '';
        console.log(LINE);
        console.log(col('TOTAL', 10) + col('', 14) + col('', 14) + col('', 8) + col(formatBRL(totalCostBRL), 16) + `${sign}${totalRet}%`);
        console.log(LINE);
    }

    console.log(`\n✅ ${ok.length}/${eligibleWithQty.length} ativos cadastrados com sucesso.`);
    console.log(`👉 Acesse a carteira de ${targetUser.email} no painel para ver o P&L completo.\n`);

    rl.close();
    await mongoose.disconnect();
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Erro fatal:', err.message);
    rl.close();
    mongoose.disconnect().finally(() => process.exit(1));
});
