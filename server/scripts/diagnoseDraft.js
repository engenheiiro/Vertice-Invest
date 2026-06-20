/**
 * Diagnóstico do draft competitivo (instrumentação).
 *
 * Replica EXATAMENTE o caminho de aiResearchService.calculateRanking até o draft
 * (getMarketData → scoringEngine.processAsset → performCompetitiveDraft), ligando o
 * `trace` opcional do portfolioEngine para enxergar, por perfil, quais ativos foram
 * SELECTED vs BLOCKED_SECTOR_CAP e por qual balde de concentração.
 *
 * Objetivo: confirmar (1) o velho efeito do colapso de macro-setor em FIIs — por que
 * VISC11 (D=85) ficava de fora e HSRE11 entrava exibindo 80 (penalidade pós-draft);
 * e (2) que a taxonomia fina por segmento agora diversifica corretamente.
 *
 * Uso: node server/scripts/diagnoseDraft.js [FII|STOCK|STOCK_US|CRYPTO]
 * Read-only: não grava nada.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ASSET_CLASS = (process.argv[2] || 'FII').toUpperCase();
const WATCH = (process.argv[3] || 'VISC11,HSRE11,HGLG11,KNRI11,GGRC11,TRXF11,BTLG11,HGRU11')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const { marketDataService } = await import('../services/marketDataService.js');
const { scoringEngine } = await import('../services/engines/scoringEngine.js');
const { portfolioEngine } = await import('../services/engines/portfolioEngine.js');
const { getMacroSector, getFiiSegment, getConcentrationKey } = await import('../config/sectorTaxonomy.js');
const SystemConfig = (await import('../models/SystemConfig.js')).default;
const { DEFAULT_SELIC_FALLBACK } = await import('../config/financialConstants.js');

const pad = (s, n) => String(s ?? '').padEnd(n);
const padL = (s, n) => String(s ?? '').padStart(n);

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`📡 Conectado. Classe: ${ASSET_CLASS}\n`);

    const rawData = await marketDataService.getMarketData(ASSET_CLASS);
    console.log(`📥 ${rawData.length} ativos ativos carregados.\n`);

    const macroConfig = await SystemConfig.findOne({ key: 'MACRO_INDICATORS' });
    const context = {
        MACRO: macroConfig ? {
            SELIC: macroConfig.selic, IPCA: macroConfig.ipca,
            RISK_FREE: macroConfig.riskFree, NTNB_LONG: macroConfig.ntnbLong,
        } : { SELIC: DEFAULT_SELIC_FALLBACK, IPCA: 4.5, RISK_FREE: DEFAULT_SELIC_FALLBACK, NTNB_LONG: 6.3 },
    };

    const processed = [];
    rawData.forEach(a => {
        const r = scoringEngine.processAsset(a, context);
        if (r && !r._discarded) processed.push(r);
    });
    console.log(`🧮 ${processed.length} ativos pontuados (pós-descarte).\n`);

    // 1) Distribuição de baldes: macro (antigo) x segmento fino (novo)
    const macroBuckets = {};
    const fineBuckets = {};
    processed.forEach(a => {
        const m = getMacroSector(a.sector);
        const f = getConcentrationKey(a);
        macroBuckets[m] = (macroBuckets[m] || 0) + 1;
        fineBuckets[f] = (fineBuckets[f] || 0) + 1;
    });
    console.log('── Baldes de concentração ───────────────────────────────');
    console.log(`ANTIGO (macro-setor): ${Object.keys(macroBuckets).length} baldes`);
    Object.entries(macroBuckets).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${pad(k, 16)} ${v}`));
    console.log(`NOVO (segmento fino): ${Object.keys(fineBuckets).length} baldes`);
    Object.entries(fineBuckets).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${pad(k, 22)} ${v}`));
    console.log('');

    // 2) Watchlist: score bruto DEFENSIVE (pré-penalidade) + setor + baldes
    console.log('── Watchlist (score DEFENSIVE BRUTO, pré-penalidade) ────');
    console.log(`${pad('TICKER', 9)}${padL('D', 5)}${padL('M', 5)}${padL('B', 5)}  ${pad('SETOR', 18)}${pad('MACRO(antigo)', 16)}SEGMENTO(novo)`);
    WATCH.forEach(t => {
        const a = processed.find(x => x.ticker?.toUpperCase() === t);
        if (!a) { console.log(`${pad(t, 9)}  (não está no universo pontuado)`); return; }
        console.log(
            `${pad(a.ticker, 9)}${padL(a.scores.DEFENSIVE, 5)}${padL(a.scores.MODERATE, 5)}${padL(a.scores.BOLD, 5)}  ` +
            `${pad(a.sector, 18)}${pad(getMacroSector(a.sector), 16)}${getConcentrationKey(a)}`
        );
    });
    console.log('');

    // 3) Draft real com trace
    const trace = [];
    let ranking = portfolioEngine.performCompetitiveDraft(processed, { trace });
    const draftScoreByTicker = new Map(ranking.map(r => [r.ticker, r.score]));
    ranking = portfolioEngine.applyConcentrationPenalty(ranking);
    const finalByTicker = new Map(ranking.map(r => [r.ticker, r]));

    console.log('── Selecionados por perfil (draft → pós-penalidade) ─────');
    for (const profile of ['DEFENSIVE', 'MODERATE', 'BOLD']) {
        const picks = ranking.filter(r => r.riskProfile === profile);
        console.log(`\n${profile} — ${picks.length} ativos`);
        picks.forEach(r => {
            const draftScore = draftScoreByTicker.get(r.ticker);
            const penalty = draftScore - r.score;
            const seg = getConcentrationKey(r);
            console.log(
                `   ${pad(r.ticker, 9)} draft=${padL(draftScore, 4)} → final=${padL(r.score, 4)}` +
                `${penalty > 0 ? ` (pen -${penalty})` : ''}  ${pad(r.action, 5)} ${pad(seg, 22)} ${r.sector}`
            );
        });
    }
    console.log(`\n   TOTAL selecionados: ${ranking.length}`);

    // 4) Trace do watchlist: o que aconteceu com cada um no draft
    console.log('\n── Trace do draft p/ watchlist ──────────────────────────');
    WATCH.forEach(t => {
        const evts = trace.filter(e => e.ticker?.toUpperCase() === t);
        if (evts.length === 0) {
            const inUniverse = processed.find(x => x.ticker?.toUpperCase() === t);
            console.log(`${pad(t, 9)} — ${inUniverse ? 'nunca avaliado (target já cheio antes de chegar nele)' : 'fora do universo'}`);
            return;
        }
        evts.forEach(e => {
            console.log(`${pad(e.ticker, 9)} ${pad(e.profile, 10)} ${pad(e.tier, 7)} score=${padL(e.score, 4)} comp=${padL(e.composite, 6)} ${pad(e.key, 22)} → ${e.outcome}`);
        });
    });

    await mongoose.disconnect();
    console.log('\n✅ Fim.');
};

run().catch(e => { console.error('❌', e); process.exit(1); });
