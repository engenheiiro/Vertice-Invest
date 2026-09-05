/**
 * Fecha a invariante da aposentadoria: `isBlacklisted=true` ⇒ `isActive=false`.
 *
 * Aposentadoria é estado TERMINAL — quem está na blacklist não deveria ser
 * perguntado a fonte nenhuma. Mas os dois campos nunca andaram juntos sozinhos:
 * os caminhos antigos de baixa (`blacklistDeadB3.js`, `migrateHardcodedData.js`,
 * a aposentadoria automática do `tryReactivateAssets`) marcavam o flag terminal
 * e deixavam `isActive` como estava, e o sync de fundamentos regravava
 * `isActive: true` toda vez que o Fundamentus ainda listasse o papel. Resultado:
 * aposentado que continuava na fila de cotação, descendo Yahoo → Google → Brapi
 * e falhando nos três a cada 15 minutos, para sempre — em 04/09/2026 eram 12
 * ativos assim, em 05/09/2026 já eram 23.
 *
 * As portas foram fechadas na origem (syncService, schedulerService,
 * researchController.resetAssetHealth, marketDataService.retireStaleInactiveAssets).
 * Este script existe para as linhas que já nasceram tortas — e para a sentinela
 * "Aposentado que ainda é cotado" da aba Saúde ter um conserto com nome.
 *
 * O que ele NÃO faz, de propósito:
 *   - não aposenta ninguém (não escreve `isBlacklisted`; quem decide baixa é o
 *     `retireDeadTickers.js`, com probe ao vivo e guarda de papel detido);
 *   - não inventa `retiredAt`/`retiredReason` para quem não tem — carimbar a
 *     data de hoje mentiria sobre quando o papel morreu. Ele só CONTA quantos
 *     estão sem motivo registrado.
 *
 * Segurança:
 *   - DRY-RUN por padrão; só grava com --apply.
 *   - Escrita restrita a `{ isBlacklisted: true, isActive: true }` — nenhum
 *     documento fora da invariante quebrada é tocado.
 *   - Idempotente: reexecutar não encontra mais nada.
 *   - Reversível: `retireDeadTickers.js --tickers=X --undo --apply` desfaz a
 *     baixa inteira (é o caminho certo se algum papel aqui estiver vivo).
 *
 * Uso:
 *   node server/scripts/normalizeRetiredAssets.js            # dry-run
 *   node server/scripts/normalizeRetiredAssets.js --apply    # normaliza
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';
import { connectScriptDb } from './lib/scriptDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.slice(2).includes('--apply');

const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const diasAtras = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);

const run = async () => {
    await connectScriptDb({ label: 'normalizeRetiredAssets' });

    const quebrados = await MarketAsset
        .find({ isBlacklisted: true, isActive: true })
        .select('ticker name type failCount retiredAt retiredReason successorTicker updatedAt liquidity')
        .sort({ type: 1, ticker: 1 })
        .lean();

    console.log(
        `\n🪦 Aposentado que ainda é cotado ${apply ? '(APLICANDO)' : '(DRY-RUN — nada será gravado)'}`
        + ` | ${quebrados.length} ativo(s) com isBlacklisted=true e isActive=true\n`,
    );

    if (!quebrados.length) {
        console.log('✅ Invariante fechada — nada a fazer.');
        await mongoose.disconnect();
        return;
    }

    // Detido em carteira não muda a decisão (a baixa já está feita; aqui só se
    // completa o estado), mas precisa aparecer: é a linha do dono na tela.
    const detidos = new Set(await UserAsset.distinct('ticker', { ticker: { $in: quebrados.map((a) => a.ticker) } }));
    const semMotivo = quebrados.filter((a) => !a.retiredAt && !a.retiredReason);

    for (const a of quebrados) {
        const parado = diasAtras(a.updatedAt);
        console.log(
            `   • ${a.ticker.padEnd(9)} ${String(a.type || '?').padEnd(9)}`
            + ` baixa=${dia(a.retiredAt).padEnd(10)}`
            + ` parado=${parado === null ? '—' : `${parado}d`}`.padEnd(14)
            + ` falhas=${String(a.failCount ?? 0).padEnd(4)}`
            + `${detidos.has(a.ticker) ? ' 👛 detido em carteira' : ''}`
            + `${a.successorTicker ? ` ↪ ${a.successorTicker}` : ''}`
            + `${a.retiredReason ? `  (${a.retiredReason})` : ''}`,
        );
    }

    if (semMotivo.length) {
        console.log(
            `\n🔍 ${semMotivo.length} sem retiredAt/retiredReason — baixados por caminho antigo,`
            + ' que não registrava o motivo. Não são carimbados aqui (a data de hoje não é a data da morte):'
            + ` ${semMotivo.map((a) => a.ticker).join(', ')}`,
        );
    }
    if (detidos.size) {
        console.log(
            `\n⚠️  ${detidos.size} detido(s) em carteira: ${[...detidos].join(', ')}.`
            + ' A posição e o histórico continuam intactos — aposentar só tira da fila de cotação'
            + ' e da elegibilidade de ranking. Se algum destes ainda negocia, reverta a BAIXA'
            + ' (retireDeadTickers.js --undo), não o isActive.',
        );
    }

    if (!apply) {
        console.log(`\nℹ️  DRY-RUN: rode com --apply para fechar os ${quebrados.length} acima.`);
        await mongoose.disconnect();
        return;
    }

    const res = await MarketAsset.updateMany(
        { isBlacklisted: true, isActive: true },
        { $set: { isActive: false } },
    );
    console.log(`\n✅ ${res.modifiedCount} ativo(s) normalizado(s) (isActive=false). Saem da fila de cotação no próximo ciclo.`);

    const restantes = await MarketAsset.countDocuments({ isBlacklisted: true, isActive: true });
    console.log(restantes === 0
        ? '✅ Invariante fechada: 0 aposentados ativos.'
        : `⚠️  Ainda restam ${restantes} — corrida com o sync? Rode de novo.`);

    await mongoose.disconnect();
};

run().catch((e) => {
    console.error('❌ Erro:', e.message);
    process.exit(1);
});
