import FundamentalSnapshot from '../models/FundamentalSnapshot.js';
import { periodKey } from '../utils/trackRecord.js';

// Máximo de leituras guardadas por ativo (~5 anos de cadência mensal). Mantém o
// documento pequeno e barato de carregar no getMarketData.
const MAX_HISTORY = 60;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * (Fase 3) Acrescenta uma leitura mensal de fundamentos à série de cada ativo.
 * Deduplicado por período (YYYY-MM): rodar o sync várias vezes no mesmo mês apenas
 * SOBRESCREVE a leitura daquele mês — não infla a série. Idempotente dentro do mês.
 *
 * @param {Array<{ticker:string,type?:string,roe?:number,netMargin?:number,payout?:number,dy?:number,revenueGrowth?:number,pl?:number}>} records
 * @param {Date} [when]
 * @returns {Promise<{appended:number}>}
 */
export async function appendSnapshots(records, when = new Date()) {
    if (!Array.isArray(records) || records.length === 0) return { appended: 0 };

    const period = periodKey(when);
    const tickers = [...new Set(records.map(r => r.ticker).filter(Boolean))];

    // Carrega as séries existentes em um único find (mirror do padrão histByTicker).
    const existing = await FundamentalSnapshot.find({ ticker: { $in: tickers } })
        .select('ticker history').lean();
    const byTicker = new Map(existing.map(s => [s.ticker, s.history || []]));

    const ops = [];
    for (const r of records) {
        if (!r.ticker) continue;
        const entry = {
            period,
            date: when,
            roe: num(r.roe),
            netMargin: num(r.netMargin),
            payout: num(r.payout),
            dy: num(r.dy),
            revenueGrowth: num(r.revenueGrowth),
            pl: num(r.pl),
        };
        // Remove qualquer leitura do mesmo período e empilha a nova; mantém só as últimas MAX_HISTORY.
        const prior = (byTicker.get(r.ticker) || []).filter(h => h && h.period !== period);
        const history = [...prior, entry].slice(-MAX_HISTORY);

        ops.push({
            updateOne: {
                filter: { ticker: r.ticker },
                update: {
                    $set: { history, lastUpdated: when, type: r.type || null },
                },
                upsert: true,
            },
        });
    }

    if (ops.length === 0) return { appended: 0 };
    await FundamentalSnapshot.bulkWrite(ops, { ordered: false });
    return { appended: ops.length };
}
