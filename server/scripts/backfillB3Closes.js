/**
 * Tapa buracos de série com o fechamento OFICIAL da B3.
 *
 * O Yahoo publica, sem aviso e sem padrão, a linha do pregão com `close` nulo:
 * 7 ETFs em 27/08/2026, e 661 séries de ação/FII/ETF na sexta 28/08/2026 (as 495
 * americanas vieram normais). O buraco é DEFINITIVO — o candle não chega depois,
 * então esperar não resolve.
 *
 * O caminho da carteira já se defende sozinho (`walletDayCandleService` consulta
 * a B3 quando o Yahoo falha, antes do snapshot). Este script é a contraparte do
 * UNIVERSO DE PESQUISA, onde o dano é gradual e não pede automação: SMA200, RSI,
 * beta e volatilidade envelhecem e o ranking deriva, mas nada fica errado de
 * imediato. Roda sob supervisão, como o `sync:prod`.
 *
 * A economia é a razão de existir do formato: o arquivo da B3 traz o mercado
 * inteiro numa requisição (~8,5 MB), então tapar 661 séries custa UM download por
 * dia — não 661 chamadas por dia.
 *
 * Escopo por série: só dias ÚTEIS dentro da janela pedida, só ações/FIIs/ETFs com
 * ticker da B3, e só dias posteriores ao PRIMEIRO candle da série (preencher
 * antes disso inventaria história que nunca tivemos). Papel ausente no arquivo do
 * dia é papel que não negociou — não entra, e isso não é falha.
 *
 * Uso:
 *   node server/scripts/backfillB3Closes.js                  # dry-run, 10 dias
 *   node server/scripts/backfillB3Closes.js --days=30
 *   node server/scripts/backfillB3Closes.js --days=10 --apply
 */
import mongoose from 'mongoose';
import { connectScriptDb } from './lib/scriptDb.js';
// Forma canônica do ticker B3 — a cópia local que morava aqui divergia da do
// serviço (rejeitava B3SA3 e EQMA3B). Ver utils/tickerShape.js.
import { B3_TICKER_RE } from '../utils/tickerShape.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import AssetHistory from '../models/AssetHistory.js';
import MarketAsset from '../models/MarketAsset.js';
import { fetchB3DailyCloses } from '../services/b3DailyFileService.js';
import { historyStorageKey, mergeCandleSeries } from '../utils/assetHistory.js';
import { brazilDayKey, isBrBusinessDay } from '../utils/walletSnapshot.js';
import { ASSET_HISTORY_MAX_POINTS, HISTORY_CAP_EXEMPT_TICKERS } from '../config/financialConstants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const JANELA_DIAS = Math.min(Math.max(Number(daysArg?.split('=')[1]) || 10, 1), 90);

const B3_TYPES = new Set(['STOCK', 'FII', 'ETF']);

/** Dias úteis da janela, do mais antigo para o mais novo. */
const diasUteis = (janela) => {
    const out = [];
    const base = Date.now();
    for (let i = janela; i >= 0; i -= 1) {
        const key = brazilDayKey(new Date(base - i * 86400000));
        if (isBrBusinessDay(key)) out.push(key);
    }
    return out;
};

await connectScriptDb({ label: 'backfillB3Closes' });
try {
    console.log(`\n🇧🇷 Backfill de fechamento oficial da B3 ${APPLY ? '(APLICANDO)' : '(DRY-RUN — nada será gravado)'}`);
    console.log(`   Janela: ${JANELA_DIAS} dias corridos\n`);

    const assets = await MarketAsset.find({ isActive: true }).select('ticker type').lean();
    const alvos = assets
        .filter((a) => B3_TYPES.has(String(a.type || '').trim().toUpperCase())
            && B3_TICKER_RE.test(String(a.ticker || '').trim().toUpperCase()))
        .map((a) => ({ ticker: String(a.ticker).trim().toUpperCase(), type: a.type, key: historyStorageKey(a.ticker, a.type) }));
    console.log(`   ${alvos.length} ativos da B3 no universo ativo.`);

    const docs = await AssetHistory.find({ ticker: { $in: alvos.map((a) => a.key) } })
        .select('ticker history').lean();
    const porChave = new Map(docs.map((d) => [d.ticker, d.history || []]));

    // Um download por dia, reaproveitado por todas as séries.
    const dias = diasUteis(JANELA_DIAS);
    const faltantesPorChave = new Map();
    let diasComArquivo = 0;

    for (const dia of dias) {
        const closes = await fetchB3DailyCloses(dia);
        if (!closes) { console.log(`   ${dia}  —  sem arquivo (dia sem pregão ou ainda em apuração)`); continue; }
        diasComArquivo += 1;

        let preenchidos = 0;
        for (const alvo of alvos) {
            const serie = porChave.get(alvo.key);
            if (!serie || serie.length === 0) continue; // série inexistente é trabalho do worker, não daqui
            const primeiro = serie[0]?.date;
            if (!primeiro || dia < primeiro) continue;  // não inventar história anterior à série
            if (serie.some((c) => c?.date === dia)) continue;

            const linha = closes.get(alvo.ticker);
            if (!linha) continue; // não negociou no dia

            if (!faltantesPorChave.has(alvo.key)) faltantesPorChave.set(alvo.key, { alvo, novos: [] });
            faltantesPorChave.get(alvo.key).novos.push({ date: dia, close: linha.close, volume: linha.volume });
            preenchidos += 1;
        }
        console.log(`   ${dia}  ·  ${closes.size} papéis no arquivo  ·  ${preenchidos} lacuna(s) nossa(s)`);
    }

    const pendentes = [...faltantesPorChave.values()].sort((a, b) => b.novos.length - a.novos.length);
    const totalCandles = pendentes.reduce((s, p) => s + p.novos.length, 0);
    console.log(`\n   ${diasComArquivo} dia(s) com arquivo · ${pendentes.length} série(s) com lacuna · ${totalCandles} candle(s) a inserir\n`);

    if (pendentes.length === 0) {
        console.log('✅ Nenhuma lacuna que a B3 possa tapar na janela.\n');
    } else {
        for (const p of pendentes.slice(0, 25)) {
            console.log(`   • ${p.alvo.ticker.padEnd(8)} ${String(p.alvo.type).padEnd(6)} ${p.novos.length} dia(s): ${p.novos.map((c) => c.date).join(', ')}`);
        }
        if (pendentes.length > 25) console.log(`   ... e mais ${pendentes.length - 25} série(s).`);
        console.log('');
    }

    if (APPLY && pendentes.length > 0) {
        let gravadas = 0;
        for (const p of pendentes) {
            const guardada = porChave.get(p.alvo.key) || [];
            const merged = mergeCandleSeries(guardada, p.novos, {
                maxPoints: HISTORY_CAP_EXEMPT_TICKERS.has(p.alvo.ticker) ? Infinity : ASSET_HISTORY_MAX_POINTS,
                type: p.alvo.type,
            });
            await AssetHistory.updateOne(
                { ticker: p.alvo.key },
                // `lastCheckedAt` fica intocado: ele mede a VISITA do timeSeriesWorker,
                // e renová-lo aqui esconderia a cobertura real daquele run.
                { $set: { history: merged, lastUpdated: new Date() } },
            );
            gravadas += 1;
        }
        console.log(`✅ ${gravadas} série(s) atualizada(s) com ${totalCandles} candle(s) oficiais da B3.\n`);
    } else if (pendentes.length > 0) {
        console.log('ℹ️  DRY-RUN: rode com --apply para gravar.\n');
    }
} finally {
    await mongoose.disconnect();
}
