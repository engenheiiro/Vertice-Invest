/**
 * Auditoria read-only das séries de `AssetHistory` que estão FORA da coorte
 * mantida — nenhum `MarketAsset` as reivindica pela chave canônica, nenhum
 * caminho de leitura as alcança, nenhum worker as atualiza.
 *
 * NÃO escreve nada. Não apaga, não move, não mescla. Existe para que a decisão
 * sobre esses documentos seja tomada com números, e não com impressão.
 *
 * POR QUE ELAS EXISTEM
 * Toda leitura e toda escrita resolvem a chave por `historyStorageKey(ticker,
 * type)`, que remove o sufixo `.SA` e namespaceia cripto como `X-USD`. Antes
 * dessa convenção, gravava-se sob o símbolo do provedor (`CPFE3.SA`). Os
 * documentos antigos deixaram de ser lidos E de ser atualizados no mesmo dia:
 * ficaram órfãos, congelados na data em que a convenção mudou.
 *
 * O QUE ELAS NÃO SÃO
 * Não são simplesmente lixo. Como o cap de candles só se aplica à chave
 * canônica, a órfã costuma ser MAIS FUNDA que a série viva — em 22/08/2026, 161
 * das 163 órfãs `.SA` começavam ANTES do primeiro candle da canônica (a maioria
 * em 2020-01-02 contra 2025-01-15), e as duas se sobrepõem, sem buraco entre
 * elas. Ou seja, são um arquivo acidental de ~5 anos a mais para 161 tickers.
 * Isso é re-obtenível do Yahoo enquanto a fonte servir — exceto onde a série
 * viva está quebrada, e aí a órfã pode ser a única cópia (ver `RESGATE`).
 *
 * POR QUE ELAS INCOMODAM
 * Poluem qualquer diagnóstico dirigido pela coleção em vez de pela coorte. Já
 * custaram um parágrafo de explicação em `dataHealthService` e mantinham o card
 * "Séries Temporais" do painel admin vermelho a 116,8h contra 13,8h reais.
 *
 * Uso:
 *   node server/scripts/auditOrphanSeries.js            # resumo
 *   node server/scripts/auditOrphanSeries.js --listar   # + uma linha por documento
 */
import mongoose from 'mongoose';
import { connectScriptDb } from './lib/scriptDb.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import AssetHistory from '../models/AssetHistory.js';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { HISTORY_CAP_EXEMPT_TICKERS } from '../config/financialConstants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const LISTAR = process.argv.includes('--listar');

const resumoSerie = (history) => {
    const candles = Array.isArray(history) ? history : [];
    let primeiro = null;
    let ultimo = null;
    for (const c of candles) {
        if (!c?.date) continue;
        if (!primeiro || c.date < primeiro) primeiro = c.date;
        if (!ultimo || c.date > ultimo) ultimo = c.date;
    }
    return { n: candles.length, primeiro, ultimo };
};

const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

await connectScriptDb({ label: 'auditOrphanSeries' });
try {
    const [assets, holdings, docs] = await Promise.all([
        MarketAsset.find({}).select('ticker type isActive').lean(),
        UserAsset.find({}).select('ticker type').lean(),
        AssetHistory.find({}).select('ticker history lastUpdated').lean(),
    ]);

    // Coorte = quem tem dono. MarketAsset (ativo ou não — inativo ainda é
    // reivindicado por alguém) + isentos de cap + tickers em carteira.
    const donoPorChave = new Map();
    for (const a of assets) {
        const key = historyStorageKey(a.ticker, a.type);
        if (key) donoPorChave.set(key, a);
    }
    const carteira = new Set(holdings.map(h => historyStorageKey(h.ticker, h.type)).filter(Boolean));

    const info = new Map(docs.map(d => [d.ticker, { ...resumoSerie(d.history), lastUpdated: d.lastUpdated }]));
    const orfas = docs.filter(d => !donoPorChave.has(d.ticker)
        && !HISTORY_CAP_EXEMPT_TICKERS.has(d.ticker)
        && !carteira.has(d.ticker));

    // Chave canônica que a órfã "deveria" ser, quando dá para deduzir.
    const canonicaDe = (ticker) => {
        if (/\.SA$/i.test(ticker)) return ticker.replace(/\.SA$/i, '').toUpperCase();
        const cripto = historyStorageKey(ticker, 'CRYPTO');
        return donoPorChave.has(cripto) && cripto !== ticker ? cripto : null;
    };

    const grupos = { legadoSA: [], criptoNu: [], semDono: [] };
    for (const d of orfas) {
        if (/\.SA$/i.test(d.ticker)) grupos.legadoSA.push(d);
        else if (canonicaDe(d.ticker)) grupos.criptoNu.push(d);
        else grupos.semDono.push(d);
    }

    const candles = arr => arr.reduce((s, d) => s + (d.history?.length || 0), 0);
    const bytes = arr => arr.reduce((s, d) => s + JSON.stringify(d.history || []).length, 0);

    console.log(`\n📚 AssetHistory: ${docs.length} documentos · ${donoPorChave.size} chaves canônicas de MarketAsset`);
    console.log(`🧭 Fora da coorte: ${orfas.length} documentos · ${candles(orfas).toLocaleString('pt-BR')} candles · ~${(bytes(orfas) / 1048576).toFixed(1)} MB\n`);
    console.log(`   convenção legada .SA : ${String(grupos.legadoSA.length).padStart(4)} docs · ${candles(grupos.legadoSA).toLocaleString('pt-BR').padStart(9)} candles`);
    console.log(`   cripto sob ticker nu : ${String(grupos.criptoNu.length).padStart(4)} docs · ${candles(grupos.criptoNu).toLocaleString('pt-BR').padStart(9)} candles`);
    console.log(`   sem dono nenhum      : ${String(grupos.semDono.length).padStart(4)} docs · ${candles(grupos.semDono).toLocaleString('pt-BR').padStart(9)} candles`);

    // O corte que importa antes de qualquer decisão: a órfã carrega algo que a
    // série viva NÃO tem? Duas formas de carregar.
    const resgate = [];   // canônica ausente ou pior — órfã pode ser a única cópia
    const profunda = [];  // canônica saudável, mas a órfã cobre período anterior
    const redundante = [];

    for (const d of [...grupos.legadoSA, ...grupos.criptoNu]) {
        const canonKey = canonicaDe(d.ticker);
        const o = info.get(d.ticker);
        const c = canonKey ? info.get(canonKey) : null;
        if (!c) { resgate.push({ d, canonKey, o, c, motivo: 'série canônica NÃO existe' }); continue; }
        if (!c.ultimo || !o.ultimo || c.ultimo < o.ultimo) {
            resgate.push({ d, canonKey, o, c, motivo: `canônica mais atrasada (${c.ultimo ?? '—'} < ${o.ultimo})` });
            continue;
        }
        if (o.primeiro && c.primeiro && o.primeiro < c.primeiro) {
            profunda.push({ d, canonKey, o, c });
            continue;
        }
        redundante.push({ d, canonKey, o, c });
    }

    console.log(`\n🚑 RESGATE — a viva não existe ou está pior que a órfã: ${resgate.length}`);
    for (const { d, canonKey, o, c, motivo } of resgate) {
        console.log(`   • ${d.ticker.padEnd(13)} órfã ${String(o.n).padStart(5)} candles ${dia(o.primeiro)}→${dia(o.ultimo)}`
            + ` | ${String(canonKey ?? '—').padEnd(10)} ${c ? `${c.n} candles até ${c.ultimo}` : 'inexistente'} — ${motivo}`);
    }

    console.log(`\n📦 PROFUNDIDADE — a viva está em dia, mas a órfã cobre período anterior: ${profunda.length}`);
    if (profunda.length) {
        const maisAntiga = profunda.reduce((min, x) => (x.o.primeiro < min ? x.o.primeiro : min), profunda[0].o.primeiro);
        console.log(`   candle mais antigo guardado nas órfãs: ${maisAntiga}`);
        console.log(`   ${candles(profunda.map(x => x.d)).toLocaleString('pt-BR')} candles, ~${(bytes(profunda.map(x => x.d)) / 1048576).toFixed(1)} MB`);
    }

    console.log(`\n🗑️ REDUNDANTE — a viva cobre tudo que a órfã tem: ${redundante.length}`);

    if (grupos.semDono.length) {
        console.log('\n❓ SEM DONO — nenhum MarketAsset, nem canônica dedutível:');
        for (const d of grupos.semDono) {
            const o = info.get(d.ticker);
            console.log(`   • ${d.ticker.padEnd(13)} ${String(o.n).padStart(5)} candles ${dia(o.primeiro)}→${dia(o.ultimo)} · lastUpdated ${dia(o.lastUpdated)}`);
        }
    }

    // Independente das órfãs: séries VIVAS rasas demais para os consumidores que
    // exigem janela (o piso de drawdown dos motores âncora é 250 candles).
    const rasas = [];
    for (const [key, a] of donoPorChave) {
        const i = info.get(key);
        if (i && i.n < 250) rasas.push({ key, tipo: a.type, ativo: a.isActive, ...i });
    }
    rasas.sort((x, y) => x.n - y.n);
    const rasasAtivas = rasas.filter(r => r.ativo);
    console.log(`\n⚠️ Séries VIVAS abaixo de 250 candles: ${rasas.length} (${rasasAtivas.length} em ativos ativos)`);
    console.log(`   com 1 único candle e ativo: ${rasasAtivas.filter(r => r.n === 1).map(r => r.key).join(', ') || 'nenhum'}`);

    if (LISTAR) {
        console.log('\n— listagem completa das órfãs —');
        for (const d of orfas.sort((a, b) => a.ticker.localeCompare(b.ticker))) {
            const o = info.get(d.ticker);
            console.log(`   ${d.ticker.padEnd(13)} ${String(o.n).padStart(5)} candles ${dia(o.primeiro)}→${dia(o.ultimo)} · lastUpdated ${dia(o.lastUpdated)}`);
        }
    }

    console.log('\n✅ Auditoria read-only concluída — nada foi gravado.\n');
} finally {
    await mongoose.disconnect();
}
