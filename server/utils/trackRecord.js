/**
 * (Fase 3 / achado B-A2) Resumo de TRACK RECORD a partir da série temporal de
 * fundamentos (FundamentalSnapshot). Função PURA — sem I/O — para ser testável e
 * para manter o scoringEngine livre de acesso a banco.
 *
 * Filosofia (anti double-count): o motor JÁ premia a qualidade do INSTANTE atual
 * (ROE corrente, payout corrente, DY corrente). Esta dimensão NÃO deve repetir isso —
 * ela mede CONTINUIDADE ao longo de períodos distintos: o ativo SUSTENTOU rentabilidade,
 * pagou dividendo e cresceu receita de forma consistente? É o que falta para um
 * Buy & Hold de décadas (ver ANALISE_RANKINGS_VERTICE_2026-06.txt §2.6 achado B).
 *
 * DORMENTE POR PADRÃO: sem histórico suficiente devolve `null` → o motor não concede
 * (nem desconta) nada. Como não existe histórico retroativo, isso garante que o ranking
 * permaneça idêntico até a série acumular profundidade — e então ative sozinho.
 */

// Piso de qualidade reutilizado dos tiers correntes do motor (ROE "Saudável" ≥12 / DY).
// Mantido conservador: a magnitude dos bônus é pequena e CALIBRÁVEL via backtest quando
// houver profundidade real de série (o roadmap marca estes números como "a calibrar").
export const TRACK_RECORD_ROE_FLOOR = 10;       // ROE mínimo p/ contar como "rentável" no período
export const TRACK_RECORD_PAYOUT_MIN = 30;      // banda de payout saudável/sustentável
export const TRACK_RECORD_PAYOUT_MAX = 85;
// Nº mínimo de leituras mensais distintas para virar "track record" (≈2 trimestres).
// Abaixo disso a série é ruído de um mesmo balanço — não é histórico.
export const TRACK_RECORD_MIN_PERIODS = 6;

/**
 * @param {Array<{period?:string, roe?:number, dy?:number, payout?:number, revenueGrowth?:number}>} history
 * @param {{minPeriods?:number}} [opts]
 * @returns {null | { periods:number, roeConsistency:number, dividendConsistency:number, payoutHealthy:number, revenuePositive:number }}
 *   Razões em [0,1] = fração de períodos que passaram em cada critério. `null` se insuficiente.
 */
export function summarizeTrackRecord(history, opts = {}) {
    const minPeriods = opts.minPeriods ?? TRACK_RECORD_MIN_PERIODS;
    if (!Array.isArray(history)) return null;

    // Considera apenas períodos distintos (defende contra duplicatas acidentais do mesmo mês).
    const seen = new Set();
    const rows = [];
    for (const h of history) {
        if (!h || typeof h !== 'object') continue;
        const key = h.period || String(h.date || '');
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        rows.push(h);
    }
    const n = rows.length;
    if (n < minPeriods) return null;

    const ratio = (pred) => rows.filter(pred).length / n;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    return {
        periods: n,
        // ROE sustentado acima do piso de qualidade ao longo do tempo.
        roeConsistency: ratio(h => num(h.roe) >= TRACK_RECORD_ROE_FLOOR),
        // Pagador recorrente de dividendos (continuidade, não nível).
        dividendConsistency: ratio(h => num(h.dy) > 0),
        // Payout dentro da banda saudável de forma consistente.
        payoutHealthy: ratio(h => num(h.payout) >= TRACK_RECORD_PAYOUT_MIN && num(h.payout) <= TRACK_RECORD_PAYOUT_MAX),
        // Receita crescente sustentada (CAGR 5a > 0 mantido ao longo das leituras).
        revenuePositive: ratio(h => num(h.revenueGrowth) > 0),
    };
}

/** Chave de período mensal 'YYYY-MM' em UTC (alinha com a convenção de datas do projeto). */
export function periodKey(date = new Date()) {
    const d = new Date(date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}
