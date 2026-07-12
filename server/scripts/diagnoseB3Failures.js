
/**
 * Diagnóstico (READ-ONLY) de tickers B3 que falham na cotação.
 *
 * Contexto: no sync:prod alguns B3 disparam "Yahoo falhou ... Tentando Google
 * Finance Fallback" (ex.: PLTO6, PLTO5, HGPO11, SHOP11). Precisamos separar
 * DESLISTADO/cancelado (→ blacklist, estado terminal que tira do sync E do loop
 * de reativação) de VÁLIDO-porém-ilíquido (→ deixar o failCount/reativação seguir).
 *
 * Este script NÃO grava nada. Ele:
 *   1. Reporta o estado de cada ticker suspeito informado (--tickers=A,B,C ou a
 *      lista padrão do log).
 *   2. Varre TODOS os B3 (STOCK/FII) já na trilha de falha (failCount>=1 ou
 *      isActive=false) para dar o retrato completo.
 *   3. Cruza com UserAsset p/ sinalizar os que estão em carteira de algum usuário
 *      (blacklist não deve quebrar a cotação de quem detém — avaliar caso a caso).
 *
 * Uso:
 *   node server/scripts/diagnoseB3Failures.js
 *   node server/scripts/diagnoseB3Failures.js --tickers=PLTO6,PLTO5,HGPO11,SHOP11
 *
 * Requer MONGO_URI no .env.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import MarketAsset from '../models/MarketAsset.js';
import UserAsset from '../models/UserAsset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_SUSPECTS = ['PLTO6', 'PLTO5', 'HGPO11', 'SHOP11'];

const arg = process.argv.slice(2).find(a => a.startsWith('--tickers='));
const suspects = arg
    ? arg.replace('--tickers=', '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_SUSPECTS;

const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
const fmtDays = (d) => { const n = daysAgo(d); return n === null ? 'nunca' : `${n}d atrás`; };

// Heurística de recomendação a partir do estado no DB (não é veredito — o operador confirma).
function recommend(a, heldBy) {
    if (!a) return '❓ NÃO EXISTE no MarketAsset (veio de carteira/legado — investigar origem)';
    const stale = daysAgo(a.updatedAt);
    const noPrice = !a.lastPrice || a.lastPrice <= 0;
    if (a.isBlacklisted) return '⛔ já BLACKLISTED (não deveria mais entrar no sync — verificar origem do request)';
    if (heldBy > 0) return `🧷 EM CARTEIRA (${heldBy} usuário[s]) — NÃO blacklistar cegamente; validar cotação p/ o holder`;
    if (a.failCount >= 10 && noPrice) return '⛔ CANDIDATO A BLACKLIST — sem preço e failCount no teto (provável deslistado)';
    if (noPrice && stale !== null && stale >= 5) return '⚠️ suspeito de deslistado — sem preço e stale; confiar em +1-2 runs antes de blacklistar';
    if (a.liquidity > 0 && a.liquidity < 100000) return '💧 VÁLIDO porém ilíquido — manter; falha intermitente é esperada';
    return '✅ parece saudável — falha foi transitória (throttle)';
}

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`\n🔎 Diagnóstico B3 (READ-ONLY). Suspeitos: [${suspects.join(', ')}]\n`);

        // Carteiras que detêm cada ticker (blacklist tem impacto no holder).
        const heldCounts = {};
        const heldRows = await UserAsset.aggregate([
            { $match: { ticker: { $in: suspects } } },
            { $group: { _id: '$ticker', n: { $sum: 1 } } },
        ]);
        for (const r of heldRows) heldCounts[r._id] = r.n;

        // 1) Estado dos suspeitos informados.
        const docs = await MarketAsset.find({ ticker: { $in: suspects } })
            .select('ticker name type isActive isBlacklisted isIgnored failCount lastFailDate lastPrice liquidity updatedAt')
            .lean();
        const byTicker = Object.fromEntries(docs.map(d => [d.ticker, d]));

        console.log('── Suspeitos do log ─────────────────────────────────────────');
        for (const t of suspects) {
            const a = byTicker[t];
            const held = heldCounts[t] || 0;
            if (!a) {
                console.log(`\n• ${t}\n    ${recommend(null, held)}`);
                continue;
            }
            console.log(`\n• ${t} — ${a.name || 's/ nome'} [${a.type}]`);
            console.log(`    isActive=${a.isActive} | blacklist=${a.isBlacklisted} | ignored=${a.isIgnored} | failCount=${a.failCount}`);
            console.log(`    lastPrice=${a.lastPrice} | liquidez=${a.liquidity} | últ.falha=${fmtDays(a.lastFailDate)} | atualizado=${fmtDays(a.updatedAt)}`);
            if (held) console.log(`    🧷 em ${held} carteira(s)`);
            console.log(`    → ${recommend(a, held)}`);
        }

        // 2) Retrato geral: todos os B3 na trilha de falha.
        const problematic = await MarketAsset.find({
            type: { $in: ['STOCK', 'FII'] },
            $or: [{ failCount: { $gte: 1 } }, { isActive: false }],
        }).select('ticker name type isActive isBlacklisted failCount lastPrice liquidity updatedAt')
          .sort({ failCount: -1 }).lean();

        console.log(`\n\n── Panorama: ${problematic.length} B3 na trilha de falha (failCount≥1 ou inativo) ──`);
        if (problematic.length) {
            console.log('ticker'.padEnd(10), 'tipo'.padEnd(6), 'ativo'.padEnd(6), 'BL'.padEnd(4), 'fail'.padEnd(5), 'preço'.padEnd(10), 'stale');
            for (const a of problematic) {
                console.log(
                    String(a.ticker).padEnd(10),
                    String(a.type).padEnd(6),
                    String(a.isActive).padEnd(6),
                    String(a.isBlacklisted).padEnd(4),
                    String(a.failCount).padEnd(5),
                    String(a.lastPrice).padEnd(10),
                    fmtDays(a.updatedAt),
                );
            }
        }

        console.log('\n📌 Blacklist = estado terminal: tira do sync E do loop de reativação (tryReactivateAssets');
        console.log('   re-tenta TODO inativo para sempre). Aplique só nos ⛔ confirmados deslistados.');
        console.log('\n✅ Diagnóstico concluído (nada foi gravado).');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
};

run();
