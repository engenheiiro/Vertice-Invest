// NTN-B longa: faixa de plausibilidade e leitura do CSV oficial.
//
// Taxa REAL da NTN-B longa (Tesouro IPCA+, venc. >= 2035) na Data Base mais
// recente do CSV oficial "Preços e Taxas do Tesouro Direto". Pura (sem rede).
// Robusta a reordenação de colunas: resolve índices pelo cabeçalho.
import logger from '../../config/logger.js';

// --- Plausibilidade da taxa REAL da NTN-B (Tesouro IPCA+) longa ---
// Yields reais brasileiros de longo prazo historicamente vivem em ~2%–9%.
// Um valor bem acima disso (ex.: ~12%) quase sempre é contaminação da fonte:
// o retorno NOMINAL projetado = taxa real ⊕ IPCA (7,3% ⊕ 4,7% ≈ 12,4%), e não
// a taxa real de referência. Esta faixa rejeita leituras corrompidas antes que
// cheguem ao scoring (Bazin/spread vs Tesouro em ações e FIIs).
export const NTNB_REAL_MIN = 2.0;
export const NTNB_REAL_MAX = 9.5;
export const isPlausibleNtnbRate = (rate) =>
    Number.isFinite(rate) && rate >= NTNB_REAL_MIN && rate <= NTNB_REAL_MAX;

const NTNB_LADDER = [2035, 2040, 2045, 2050, 2055, 2060];

const resolveColumns = (headerLine) => {
    const header = headerLine.split(';').map(h => h.trim().toLowerCase());
    const col = (name) => header.indexOf(name.toLowerCase());
    const cols = {
        tipo: col('Tipo Titulo'),
        venc: col('Data Vencimento'),
        base: col('Data Base'),
        venda: col('Taxa Venda Manha'),
        compra: col('Taxa Compra Manha'),
    };
    if (cols.tipo < 0 || cols.venc < 0 || cols.base < 0 || (cols.venda < 0 && cols.compra < 0)) return null;
    return cols;
};

const toTs = (s) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : NaN;
};

const toNum = (s) => {
    const v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(v) ? v : NaN;
};

// Uma linha do CSV → { baseTs, vencYear, rate } quando é IPCA+ longo (nunca
// Educa+/Renda+) com Data Base e taxa legíveis; senão null.
const parseRow = (line, cols) => {
    const c = line.split(';');
    const tipo = (c[cols.tipo] || '').trim();
    if (!/IPCA\+/i.test(tipo) || /Educa|Renda/i.test(tipo)) return null;
    const vencTs = toTs(c[cols.venc]);
    const vencYear = Number.isFinite(vencTs) ? new Date(vencTs).getUTCFullYear() : 0;
    if (vencYear < 2035) return null; // NTN-B longa de referência
    const baseTs = toTs(c[cols.base]);
    if (!Number.isFinite(baseTs)) return null;
    // Taxa Venda Manhã: o que o investidor paga — mais conservador para benchmark.
    const rate = toNum(cols.venda >= 0 ? c[cols.venda] : c[cols.compra]);
    if (!Number.isFinite(rate)) return null;
    return { baseTs, vencYear, rate };
};

// Passo 1: coleta os IPCA+ longos e acha a Data Base máxima.
const collectRows = (lines, cols) => {
    let maxBaseTs = -Infinity;
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i] ? parseRow(lines[i], cols) : null;
        if (!row) continue;
        rows.push(row);
        if (row.baseTs > maxBaseTs) maxBaseTs = row.baseTs;
    }
    return { rows, maxBaseTs };
};

// Passo 2: entre os títulos da Data Base mais recente, a escada de vencimentos
// do benchmark; senão qualquer plausível (vencimento mais longo primeiro).
const pickFromLatest = (latest) => {
    for (const year of NTNB_LADDER) {
        const hit = latest.find(r => r.vencYear === year && isPlausibleNtnbRate(r.rate));
        if (hit) {
            logger.debug(`🏛️ [NTN-B] Fonte oficial (Tesouro Transparente CSV): ${hit.rate}% a.a. (IPCA+ ${year})`);
            return hit.rate;
        }
    }
    const anyPlausible = latest
        .filter(r => isPlausibleNtnbRate(r.rate))
        .sort((a, b) => b.vencYear - a.vencYear)[0];
    if (anyPlausible) {
        logger.debug(`🏛️ [NTN-B] Fonte oficial (CSV): ${anyPlausible.rate}% a.a. (IPCA+ ${anyPlausible.vencYear})`);
        return anyPlausible.rate;
    }
    return null;
};

export const parseNtnbFromCsv = (csv) => {
    if (!csv || typeof csv !== 'string') return null;
    const lines = csv.split(/\r?\n/);
    if (lines.length < 2) return null;
    const cols = resolveColumns(lines[0]);
    if (!cols) return null;
    const { rows, maxBaseTs } = collectRows(lines, cols);
    if (!rows.length || maxBaseTs < 0) return null;
    return pickFromLatest(rows.filter(r => r.baseTs === maxBaseTs));
};
