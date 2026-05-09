
/**
 * Gera relatório completo do Radar Alpha + diagnóstico de elegibilidade.
 * Saída: reports/radar_latest.txt
 *
 * Exporta `generateRadarReport()` para ser chamada com o DB já conectado.
 * Quando executado diretamente (`npm run radar:report`), conecta e roda sozinho.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import QuantSignal from '../models/QuantSignal.js';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import SystemConfig from '../models/SystemConfig.js';

// ── helpers ────────────────────────────────────────────────────────────────

function pad(str, len, right = false) {
    const s = String(str ?? '—');
    return right ? s.padEnd(len) : s.padStart(len);
}
const hr   = (c = '═', n = 80) => c.repeat(n);
const sep  = (n = 80) => '─'.repeat(n);

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const closes = prices.slice(0, period + 1);
    let gains = 0, losses = 0;
    for (let i = 0; i < period; i++) {
        const d = closes[i] - closes[i + 1];
        if (d > 0) gains += d; else losses += Math.abs(d);
    }
    if (losses === 0) return 100;
    return 100 - (100 / (1 + gains / losses));
}

function timeAgo(date) {
    if (!date) return 'N/A';
    const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 60) return `há ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `há ${hrs}h`;
    return `há ${Math.floor(hrs / 24)}d`;
}

// ── função principal (exportável) ──────────────────────────────────────────

export async function generateRadarReport() {
    const now   = new Date();
    const lines = [];
    const w     = (s = '') => lines.push(s);

    // CABEÇALHO
    w(hr());
    w('  VÉRTICE INVEST — RADAR ALPHA REPORT');
    w(`  Gerado em: ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR')}`);

    const scanMeta = await SystemConfig.findOne({ key: 'RADAR_SCAN_META' }).lean();
    if (scanMeta?.value) {
        const m = scanMeta.value;
        w(`  Última varredura: ${timeAgo(m.lastScanAt)} — ${m.assetsScanned} ativos, ${m.assetsWithHistory} com histórico`);
        w(`  Upserts: ${m.upsertedSignals} | Inativados: ${m.staleSignalsClosed} | Ativos Total: ${m.activeSignalsTotal}`);
    }
    w(hr());

    // SINAIS ATIVOS
    const active = await QuantSignal.find({ status: 'ACTIVE' }).lean();
    const urgencyOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    const sorted = [...active].sort((a, b) => (urgencyOrder[a.urgencyLevel] ?? 3) - (urgencyOrder[b.urgencyLevel] ?? 3));

    w('');
    w(hr());
    w(`  SINAIS ATIVOS: ${active.length} oportunidades`);
    w(hr());

    if (active.length === 0) {
        w('  (nenhum sinal ativo no momento)');
    }

    for (const s of sorted) {
        const ageMin = Math.floor((now - new Date(s.timestamp)) / 60000);
        const ageStr = ageMin < 60 ? `${ageMin}min` : `${Math.floor(ageMin / 60)}h`;
        const urgBadge = s.urgencyLevel === 'CRITICAL' ? '[⚠ CRÍTICO]' : s.urgencyLevel === 'HIGH' ? '[↑ ALTO]  ' : '[· MÉDIO] ';
        const qualBadge = s.quality === 'GOLD' ? '🥇 GOLD  ' : '🥈 SILVER';

        w(sep());
        w(`  ${urgBadge} ${pad(s.ticker, 8, true)}  ${pad(s.assetType, 10, true)}  ${qualBadge}  ${pad(s.type, 14, true)}  ${pad(ageStr, 6)}`);
        w(`  Setor: ${s.sector || '—'}   Perfil: ${s.riskProfile}`);
        w(`  ${s.message}`);
        if (s.type === 'RSI_OVERSOLD') w(`  RSI: ${s.value?.toFixed(1)}`);
        if (s.type === 'DEEP_VALUE')   w(`  Graham: R$ ${s.value?.toFixed(2)}   Entrada: R$ ${s.priceAtSignal?.toFixed(2)}`);
        w(`  Desde: ${new Date(s.timestamp).toLocaleString('pt-BR')}`);
    }

    // RESUMO POR CLASSE
    w('');
    w(hr());
    w('  SINAIS ATIVOS POR CLASSE');
    w(hr());
    const byClass = {};
    for (const s of active) byClass[s.assetType] = (byClass[s.assetType] || 0) + 1;
    for (const cls of ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED_INCOME']) {
        const n = byClass[cls] || 0;
        w(`  ${pad(cls, 14, true)} ${'█'.repeat(n)}${'░'.repeat(Math.max(0, 10 - n))}  ${n} sinais`);
    }

    // HISTÓRICO RECENTE 48h (apenas sinais v2 — gerados após 2026-05-09)
    const since48h = new Date(now.getTime() - 48 * 3600 * 1000);
    const v2StartDate = new Date('2026-05-09T00:00:00.000Z');
    const recent = await QuantSignal.find({
        status: { $in: ['HIT', 'MISS', 'NEUTRAL'] },
        quality: 'GOLD',
        timestamp: { $gte: v2StartDate },
        auditDate: { $gte: since48h }
    }).sort({ auditDate: -1 }).lean();

    const hits    = recent.filter(s => s.status === 'HIT').length;
    const misses  = recent.filter(s => s.status === 'MISS').length;
    const neutral = recent.filter(s => s.status === 'NEUTRAL').length;
    const total   = hits + misses;
    const winRate = total > 0 ? ((hits / total) * 100).toFixed(1) : 'N/A';

    w('');
    w(hr());
    w(`  HISTÓRICO RECENTE (48h): ${recent.length} encerrados   HIT: ${hits}  MISS: ${misses}  NEUTRO: ${neutral}   Win Rate: ${winRate}%`);
    w(hr());

    for (const s of recent.slice(0, 20)) {
        const r = s.resultPercent != null ? `${s.resultPercent > 0 ? '+' : ''}${s.resultPercent.toFixed(2)}%` : 'N/A';
        const b = s.status === 'HIT' ? '✅ HIT   ' : s.status === 'MISS' ? '❌ MISS  ' : '⏱ NEUTRO';
        w(`  ${b}  ${pad(s.ticker, 8, true)} ${pad(s.type, 14, true)} ${pad(r, 8)} entrada: R$ ${s.priceAtSignal?.toFixed(2)} → R$ ${s.finalPrice?.toFixed(2) ?? '—'}`);
    }

    // DIAGNÓSTICO BR + FII
    w('');
    w(hr());
    w('  DIAGNÓSTICO — ELEGIBILIDADE STOCK BR + FII');
    w(hr());

    const brFiiAssets = await MarketAsset.find({
        isActive: true, isIgnored: false, isBlacklisted: false,
        type: { $in: ['STOCK', 'FII'] }
    }).lean();

    const passLiq = brFiiAssets.filter(a => a.liquidity > 500000 || a.avgLiquidity > 500000);

    w(`  Total STOCK + FII: ${brFiiAssets.length}`);
    w(`  ✅ Passam liquidez (>500k): ${passLiq.length}   ❌ Reprovados: ${brFiiAssets.length - passLiq.length}`);

    const passTickers = passLiq.map(a => a.ticker);
    const histories = await AssetHistory.find(
        { ticker: { $in: passTickers } },
        { ticker: 1, history: { $slice: -60 } }
    ).lean();

    const withHist = histories.filter(h => h.history && h.history.length > 15);
    const noHist   = passTickers.filter(t => !withHist.some(h => h.ticker === t));

    w(`  ✅ Com histórico (>15 candles): ${withHist.length}   ❌ Sem histórico: ${noHist.length}`);
    if (noHist.length > 0 && noHist.length <= 30) w(`     Tickers: ${noHist.join(', ')}`);

    const histMap  = new Map(withHist.map(h => [h.ticker, h.history.sort((a, b) => new Date(b.date) - new Date(a.date))]));
    const assetMap = new Map(brFiiAssets.map(a => [a.ticker, a]));

    let rsiOk = 0, rsiNo = 0, rsiOut = 0;
    const rsiCands = [];

    for (const [ticker, hist] of histMap) {
        const asset  = assetMap.get(ticker);
        if (!asset) continue;
        const closes = hist.map(h => h.adjClose || h.close).filter(v => v > 0);
        const rsi    = calculateRSI(closes, 14);
        if (rsi === null) { rsiNo++; continue; }
        if (rsi < 30) {
            rsiOk++;
            rsiCands.push({ ticker, rsi, type: asset.type, netMargin: asset.netMargin, ok: asset.netMargin > -5 });
        } else {
            rsiOut++;
        }
    }

    w('');
    w('  [RSI < 30 — limiar GOLD]');
    w(`  Calculados: ${rsiOk + rsiOut}   Sem dados: ${rsiNo}`);
    w(`  ✅ RSI < 30 (GOLD): ${rsiOk}   ❌ RSI >= 30: ${rsiOut}`);

    if (rsiCands.length > 0) {
        w('  Candidatos (verificando netMargin > -5):');
        for (const s of rsiCands.slice(0, 20)) {
            const ms = s.ok ? '✅ margem OK' : `❌ margem reprovada (${s.netMargin?.toFixed(2)})`;
            w(`    ${pad(s.ticker, 8, true)} [${s.type}]  RSI: ${s.rsi.toFixed(1)}  netMargin: ${s.netMargin?.toFixed(2) ?? '?'}  ${ms}`);
        }
    } else {
        w('  ⚠️  Nenhum ativo BR/FII com RSI < 30 — mercado fora da zona de sobrevenda extrema.');
    }

    const stocks     = brFiiAssets.filter(a => a.type === 'STOCK');
    const stocksFull = stocks.filter(a => a.pl > 0 && a.p_vp > 0);

    w('');
    w('  [DEEP VALUE Graham — só STOCK]');
    w(`  Total STOCK: ${stocks.length}   PL > 0: ${stocks.filter(a => a.pl > 0).length}   P/VP > 0: ${stocks.filter(a => a.p_vp > 0).length}   Ambos: ${stocksFull.length}`);

    let dvCount = 0;
    const dvSamples = [];
    for (const a of stocksFull) {
        if (!a.lastPrice || a.lastPrice <= 0) continue;
        if (!a.roe || a.roe <= 0) continue;
        const g = Math.sqrt(22.5 * (a.lastPrice / a.pl) * (a.lastPrice / a.p_vp));
        if (!isFinite(g) || isNaN(g) || g <= 0) continue;
        const d = a.lastPrice / g;
        if (d < 0.70) {
            dvCount++;
            dvSamples.push({ ticker: a.ticker, price: a.lastPrice, graham: g.toFixed(2), pct: (d * 100).toFixed(1), roe: a.roe?.toFixed(1) });
        }
    }

    w(`  Candidatos GOLD (desconto < 70% + ROE > 0): ${dvCount}`);
    if (dvSamples.length > 0) {
        for (const s of dvSamples.slice(0, 20)) {
            w(`    ${pad(s.ticker, 8, true)}  Preço: R$ ${Number(s.price).toFixed(2)}  Graham: R$ ${s.graham}  Desconto: ${s.pct}%  ROE: ${s.roe}%`);
        }
    } else {
        w('  ⚠️  Nenhum STOCK com desconto < 70% do Graham + ROE > 0.');
    }

    // DIAGNÓSTICO STOCK_US
    w('');
    w(hr());
    w('  DIAGNÓSTICO — STOCK_US');
    w(hr());

    const usAssets = await MarketAsset.find({
        isActive: true, isIgnored: false, isBlacklisted: false, type: 'STOCK_US',
        $or: [{ liquidity: { $gt: 500000 } }, { avgLiquidity: { $gt: 500000 } }]
    }).lean();

    const usHist = await AssetHistory.find(
        { ticker: { $in: usAssets.map(a => a.ticker) } },
        { ticker: 1, history: { $slice: -60 } }
    ).lean();
    const usWithHist = usHist.filter(h => h.history && h.history.length > 15);

    let usBelow30 = 0;
    for (const h of usWithHist) {
        const closes = h.history.sort((a, b) => new Date(b.date) - new Date(a.date)).map(x => x.adjClose || x.close).filter(v => v > 0);
        const rsi = calculateRSI(closes, 14);
        if (rsi !== null && rsi < 30) usBelow30++;
    }

    w(`  Elegíveis: ${usAssets.length}   Com histórico: ${usWithHist.length}   RSI < 30 (GOLD): ${usBelow30}`);
    w('');
    const usActive = active.filter(s => s.assetType === 'STOCK_US');
    if (usActive.length === 0) {
        w('  (nenhum sinal ativo)');
    }
    for (const s of usActive) {
        w(`    ${pad(s.ticker, 10, true)} [${s.urgencyLevel}]  RSI: ${s.value?.toFixed(1)}  ${s.message}`);
    }

    // RODAPÉ
    w('');
    w(hr());
    w(`  Relatório gerado em ${now.toLocaleString('pt-BR')}`);
    w(hr());

    const reportPath = path.resolve(__dirname, '../../reports/radar_latest.txt');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
    console.log(`info: 📄 Relatório salvo em reports/radar_latest.txt`);
}

// ── execução direta (`npm run radar:report`) ───────────────────────────────

if (process.argv[1] === __filename) {
    process.env.NODE_ENV = 'local_sync';
    if (!process.env.MONGO_URI) { console.error('MONGO_URI não definida.'); process.exit(1); }
    mongoose.connect(process.env.MONGO_URI)
        .then(() => generateRadarReport())
        .then(() => process.exit(0))
        .catch(err => { console.error(err.message); process.exit(1); });
}
