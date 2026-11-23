/**
 * Parsers das duas fontes de PU do Tesouro (PUROS, sem rede/banco): o CSV
 * oficial do Tesouro Transparente (série inteira) e o JSON da tela "Investir"
 * do Tesouro Direto (só o pregão corrente).
 */
import { classifyTreasuryLabel, treasuryTitleKey, familyHasCoupon } from '../../utils/treasuryTitle.js';
import { isBrBusinessDay } from '../../utils/walletSnapshot.js';

/**
 * Spread de compra/venda máximo aceito como plausível (8%).
 *
 * O PU de compra é usado só para ancorar o custo do lote, e a fonte às vezes
 * publica lixo nessa coluna: em 14/08/2026 o IPCA+ com Juros Semestrais 2050 veio
 * com PU Compra 3.963,80 (vizinhos em ~4.098) sem qualquer mudança de taxa —
 * abaixo do próprio PU de venda, o que seria arbitragem. A guarda é dupla:
 * compra >= venda (bid-ask não se inverte) e prêmio dentro da faixa. Fora disso,
 * o PU de compra é descartado e o de venda ancora os dois lados.
 */
export const MAX_BUY_SPREAD = 0.08;

/** Bid-ask não se inverte e não é gigante: fora disso a coluna está corrompida. */
const plausibleBuyPu = (rawBuy, pu) => ((rawBuy > 0 && rawBuy >= pu && (rawBuy / pu - 1) <= MAX_BUY_SPREAD) ? rawBuy : null);

// Dia/mês inexistente (32/13, 30/02) não vira data: a linha é descartada.
const toIso = (s) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
    if (!m) return null;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().startsWith(iso) ? iso : null;
};

// Formato brasileiro: milhar com ponto, decimal com vírgula.
const toNum = (s) => {
    const v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(v) ? v : NaN;
};

const CSV_COLUMNS = {
    tipo: 'Tipo Titulo',
    venc: 'Data Vencimento',
    base: 'Data Base',
    taxaVenda: 'Taxa Venda Manha',
    puCompra: 'PU Compra Manha',
    puVenda: 'PU Venda Manha',
    puBase: 'PU Base Manha',
};

// Índices resolvidos pelo cabeçalho: o arquivo já reordenou colunas no passado.
const resolveCsvColumns = (headerLine) => {
    const header = headerLine.split(';').map((h) => h.trim().toLowerCase());
    const idx = {};
    for (const [key, name] of Object.entries(CSV_COLUMNS)) idx[key] = header.indexOf(name.toLowerCase());
    const ok = idx.tipo >= 0 && idx.venc >= 0 && idx.base >= 0 && (idx.puVenda >= 0 || idx.puBase >= 0);
    return ok ? idx : null;
};

const cellNum = (cells, i) => (i >= 0 ? toNum(cells[i]) : NaN);

/** Uma linha do CSV → `{ family, maturity, label, point }`, ou `null` se não serve. */
const parseCsvRow = (line, idx, sinceIso) => {
    if (!line) return null;
    const c = line.split(';');
    if (c.length <= idx.base) return null;

    const base = toIso(c[idx.base]);
    if (!base || (sinceIso && base < sinceIso)) return null;
    const family = classifyTreasuryLabel(c[idx.tipo]);
    if (!family) return null;
    const maturity = toIso(c[idx.venc]);
    if (!maturity) return null;

    const puVenda = cellNum(c, idx.puVenda);
    const puBase = cellNum(c, idx.puBase);
    const pu = puVenda > 0 ? puVenda : puBase;
    if (!(pu > 0)) return null;

    const puBuy = plausibleBuyPu(cellNum(c, idx.puCompra), pu);
    const rate = cellNum(c, idx.taxaVenda);
    return { family, maturity, label: c[idx.tipo], point: { date: base, pu, puBuy, rate: Number.isFinite(rate) ? rate : null } };
};

const addCsvPoint = (out, { family, maturity, label, point }) => {
    const titleKey = treasuryTitleKey(family, maturity);
    let entry = out.get(titleKey);
    if (!entry) {
        entry = {
            titleKey,
            family,
            maturity,
            sourceLabel: String(label || '').trim(),
            hasCoupon: familyHasCoupon(family),
            history: [],
        };
        out.set(titleKey, entry);
    }
    entry.history.push(point);
};

// O arquivo não vem ordenado por data — a busca de PU depende de ASC. Uma Data
// Base pode repetir (republicação); o último registro vence.
const sortAndDedupHistory = (history) => {
    history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const dedup = [];
    for (const point of history) {
        if (dedup.length > 0 && dedup[dedup.length - 1].date === point.date) dedup[dedup.length - 1] = point;
        else dedup.push(point);
    }
    return dedup;
};

/**
 * CSV → séries por título (PURO, sem rede/banco).
 *
 * Preço de marcação = **PU de VENDA** (o que o investidor RECEBE ao vender de
 * volta ao Tesouro), com fallback no PU Base. Nunca o PU de compra: além de ser
 * o lado errado da marcação, é a coluna que a fonte corrompe.
 *
 * @param {string} csv conteúdo bruto do arquivo
 * @param {{ sinceIso?: string }} opts corte inferior de Data Base (inclusive)
 * @returns {Map<string, {titleKey, family, maturity, sourceLabel, hasCoupon, history: Array}>}
 */
export const parseTreasuryPriceCsv = (csv, { sinceIso = null } = {}) => {
    const out = new Map();
    if (!csv || typeof csv !== 'string') return out;

    const lines = csv.split(/\r?\n/);
    if (lines.length < 2) return out;
    const idx = resolveCsvColumns(lines[0]);
    if (!idx) return out;

    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvRow(lines[i], idx, sinceIso);
        if (row) addCsvPoint(out, row);
    }
    for (const entry of out.values()) entry.history = sortAndDedupHistory(entry.history);
    return out;
};

/** "IPCA + 6,84%" / "12,88%" / "SELIC + 0,1089%" → 6.84 / 12.88 / 0.1089; "SELIC" → null. */
const parseTdRate = (label) => {
    const all = [...String(label || '').matchAll(/(-?\d+(?:,\d+)?)\s*%/g)];
    if (all.length === 0) return null;
    const v = Number(all[all.length - 1][1].replace(',', '.'));
    return Number.isFinite(v) ? v : null;
};

const isoDayPrefix = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? value.slice(0, 10) : null);

/** Um título do JSON → cotação, ou `null` se não serve. */
const parseTdBond = (b, isBusinessDay) => {
    const family = classifyTreasuryLabel(b?.treasuryBondName);
    if (!family) return null;
    const maturity = isoDayPrefix(b?.maturityDate);
    const date = isoDayPrefix(b?.lastMarketPricingDate);
    if (!maturity || !date || !isBusinessDay(date)) return null;
    const pu = Number(b.unitaryRedemptionValue);
    if (!(pu > 0)) return null;
    const puBuy = plausibleBuyPu(Number(b.unitaryInvestmentValue), pu);
    return {
        titleKey: treasuryTitleKey(family, maturity),
        family,
        maturity,
        sourceLabel: String(b.treasuryBondName || '').trim(),
        point: { date, pu, puBuy, rate: parseTdRate(b.redemptionProfitabilityFeeIndexerName) },
    };
};

/**
 * JSON do Tesouro Direto → pontos `{ titleKey, family, maturity, sourceLabel,
 * point: { date, pu, puBuy, rate } }`. PURA. A data é o dia de
 * `lastMarketPricingDate` (horário de Brasília, sem fuso no texto); fim de
 * semana/feriado fica de fora — é o Tesouro Reserva reprecificando no sábado,
 * não pregão. Mesma guarda de bid-ask do CSV no PU de compra. Título repetido:
 * o primeiro vence.
 */
export const parseTesouroDiretoQuotes = (json, { isBusinessDay = isBrBusinessDay } = {}) => {
    const bonds = [...(json?.TesouroLegado || []), ...(json?.Tesouro24x7 || [])];
    const out = [];
    const seen = new Set();
    for (const b of bonds) {
        const quote = parseTdBond(b, isBusinessDay);
        if (!quote || seen.has(quote.titleKey)) continue;
        seen.add(quote.titleKey);
        out.push(quote);
    }
    return out;
};
