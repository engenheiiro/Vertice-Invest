/**
 * Inspeção read-only do ranking SALVO (MarketAnalysis) — valida o output do sync:prod.
 * Imprime o top 10 por classe + sinais dos refinamentos da Fase 1:
 *   D  → FIIs de papel presentes no DEFENSIVE (não vetados)
 *   F  → ETFs com "liquidez não reportada" (sem penalidade) vs liquidez baixa real
 *   G  → ativos com "SMA200 indisponível" (guarda inativa registrada)
 *   I  → ativos com "Macro Defasados" (só dispara se ratesStale nesta run)
 * Uso: node server/scripts/inspectRanking.js
 * NÃO grava nada.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MarketAnalysis = (await import('../models/MarketAnalysis.js')).default;
const SystemConfig = (await import('../models/SystemConfig.js')).default;

const CLASSES = ['BRASIL_10', 'STOCK', 'FII', 'ETF', 'STOCK_US', 'REIT', 'CRYPTO'];
const pad = (s, n) => String(s ?? '').padEnd(n);
const padL = (s, n) => String(s ?? '').padStart(n);

const hasFactor = (item, needle) =>
    (item.auditLog || []).some(a => (a.factor || '').includes(needle));

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const macro = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`MACRO: SELIC ${macro?.selic}% · IPCA ${macro?.ipca}% · NTN-B ${macro?.ntnbLong}% · ratesStale=${!!macro?.ratesStale}`);
    if (macro?.ratesSources) console.log(`       ratesSources: ${JSON.stringify(macro.ratesSources)}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    const signals = { paperInDef: [], etfNoLiq: [], etfLowLiq: [], smaAbsent: [], macroStale: [] };

    for (const cls of CLASSES) {
        const doc = await MarketAnalysis.findOne({ assetClass: cls }).sort({ createdAt: -1 }).lean();
        if (!doc) { console.log(`### ${cls}: (nenhuma análise salva)\n`); continue; }
        const rk = doc.content?.ranking || [];
        const age = Math.round((Date.now() - new Date(doc.createdAt).getTime()) / 1000);
        console.log(`### ${cls}  —  gerado há ${age}s · ${rk.length} no ranking · publicado=${doc.isRankingPublished}`);
        console.log(`${pad('#', 3)} ${pad('TICKER', 9)} ${padL('SCORE', 6)} ${pad('AÇÃO', 6)} ${pad('PERFIL', 10)} ${pad('SETOR', 24)} D/M/R(struct)`);
        rk.slice(0, 10).forEach(r => {
            const s = r.metrics?.structural || {};
            console.log(
                `${pad(r.position, 3)} ${pad(r.ticker, 9)} ${padL(r.score, 6)} ${pad(r.action, 6)} ${pad(r.riskProfile, 10)} ${pad(r.sector, 24)} ${s.quality}/${s.valuation}/${s.risk}`
            );
        });
        console.log('');

        // Coleta de sinais da Fase 1 em TODO o ranking da classe
        rk.forEach(r => {
            if (r.type === 'FII' && r.riskProfile === 'DEFENSIVE') {
                const seg = (r.sector || '').toLowerCase();
                const isPaper = seg.includes('papel') || seg.includes('receb');
                if (isPaper) signals.paperInDef.push(`${r.ticker} (${r.sector}, D=${r.score})`);
            }
            if (r.type === 'ETF') {
                if (hasFactor(r, 'não reportada')) signals.etfNoLiq.push(`${r.ticker} (liq=${r.metrics?.avgLiquidity})`);
                if (hasFactor(r, 'Liquidez Baixa')) signals.etfLowLiq.push(`${r.ticker} (liq=${r.metrics?.avgLiquidity})`);
            }
            if (hasFactor(r, 'SMA200) indisponível')) signals.smaAbsent.push(`${cls}:${r.ticker}`);
            if (hasFactor(r, 'Macro Defasados')) signals.macroStale.push(`${cls}:${r.ticker}`);
        });
    }

    console.log('═══════════════════════ SINAIS DA FASE 1 ═══════════════════════');
    console.log(`D · FIIs de papel no DEFENSIVE (${signals.paperInDef.length}): ${signals.paperInDef.slice(0, 12).join(', ') || '—'}`);
    console.log(`F · ETFs com liquidez NÃO reportada/sem penalidade (${signals.etfNoLiq.length}): ${signals.etfNoLiq.slice(0, 12).join(', ') || '—'}`);
    console.log(`F · ETFs com liquidez baixa REAL/penalizados (${signals.etfLowLiq.length}): ${signals.etfLowLiq.slice(0, 12).join(', ') || '—'}`);
    console.log(`G · Ativos com SMA200 indisponível (${signals.smaAbsent.length}): ${signals.smaAbsent.slice(0, 15).join(', ') || '—'}`);
    console.log(`I · Ativos com nota "Macro Defasados" (${signals.macroStale.length}): ${signals.macroStale.slice(0, 15).join(', ') || '—'}`);
    console.log('════════════════════════════════════════════════════════════════');

    await mongoose.disconnect();
};

run().catch(e => { console.error('❌', e); process.exit(1); });
