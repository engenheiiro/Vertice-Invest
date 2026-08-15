/**
 * Ingestão da série diária de PU dos títulos do Tesouro Direto.
 *
 * Fonte: CSV oficial "Preços e Taxas dos Títulos Públicos" (Tesouro Transparente),
 * ~14 MB, atualizado todo dia útil, sem autenticação. É o MESMO arquivo que o
 * macroDataService baixa para extrair a taxa da NTN-B longa — por isso o download
 * mora aqui e os dois consumidores compartilham (memo curto), em vez de puxar
 * 14 MB duas vezes por dia do site do governo.
 *
 * Por que existe: até ago/2026 renda fixa era precificada só por accrual (compõe
 * a taxa contratada dia a dia), uma curva de volatilidade zero por construção.
 * Para o Tesouro Selic isso é praticamente exato (vol real ~0,1% a.a.), mas um
 * Tesouro IPCA+ 2045 tem vol de ~21% a.a. e caiu 23,7% em dois anos — tratá-lo
 * como accrual é dar à carteira um ativo de retorno positivo e risco zero, o que
 * infla o Sharpe sem limite conforme o peso cresce.
 */
import axios from 'axios';
import https from 'https';
import * as Sentry from '@sentry/node';
import logger from '../config/logger.js';
import TreasuryPriceHistory from '../models/TreasuryPriceHistory.js';
import { classifyTreasuryLabel, treasuryTitleKey, familyHasCoupon, resolveTreasuryTitleKey } from '../utils/treasuryTitle.js';

export const TESOURO_CSV_URL = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv';

/**
 * Profundidade da série guardada. O arquivo cobre desde 2002, mas o que o app
 * precisa é (a) marcar posições vivas e (b) reconstruir o histórico da carteira
 * desde a primeira compra. 8 anos cobre com folga qualquer carteira do sistema e
 * mantém a coleção na casa de poucos MB (~80k linhas → ~90 títulos × ~2.000 dias).
 */
export const HISTORY_YEARS = 8;

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

/** Salto diário a partir do qual o ponto é reportado (não descartado). */
const SUSPICIOUS_DAILY_MOVE = 0.20;

const tesouroAgent = new https.Agent({ rejectUnauthorized: true, keepAlive: true, minVersion: 'TLSv1.2' });

// Memo do download bruto. TTL curto: serve para que macro sync e ingestão de PU,
// que rodam no mesmo job, dividam UM download — não para servir dado velho.
const CSV_MEMO_TTL_MS = 15 * 60 * 1000;
let csvMemo = { at: 0, csv: null };

/** Baixa o CSV oficial (memoizado por 15 min). `null` se a fonte falhar. */
export const fetchTesouroCsv = async ({ force = false } = {}) => {
    if (!force && csvMemo.csv && (Date.now() - csvMemo.at) < CSV_MEMO_TTL_MS) return csvMemo.csv;
    try {
        const res = await axios.get(TESOURO_CSV_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/csv, text/plain, */*',
                'Accept-Encoding': 'gzip',
            },
            httpsAgent: tesouroAgent,
            timeout: 45000,
            responseType: 'text',
            transformResponse: [(d) => d], // não deixa o axios tentar parsear como JSON
            maxContentLength: 64 * 1024 * 1024,
            maxBodyLength: 64 * 1024 * 1024,
        });
        const csv = typeof res.data === 'string' ? res.data : String(res.data ?? '');
        if (!csv || csv.length < 1000) return null;
        csvMemo = { at: Date.now(), csv };
        return csv;
    } catch (error) {
        logger.warn(`[Tesouro PU] Download do CSV oficial falhou: ${error.message}`);
        return null;
    }
};

/** Descarta o memo (usado nos testes e no sync forçado). */
export const clearCsvMemo = () => { csvMemo = { at: 0, csv: null }; };

const toIso = (s) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// Formato brasileiro: milhar com ponto, decimal com vírgula.
const toNum = (s) => {
    const v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(v) ? v : NaN;
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

    // Índices resolvidos pelo cabeçalho: o arquivo já reordenou colunas no passado.
    const header = lines[0].split(';').map((h) => h.trim().toLowerCase());
    const col = (name) => header.indexOf(name.toLowerCase());
    const iTipo = col('Tipo Titulo');
    const iVenc = col('Data Vencimento');
    const iBase = col('Data Base');
    const iTaxaVenda = col('Taxa Venda Manha');
    const iPuCompra = col('PU Compra Manha');
    const iPuVenda = col('PU Venda Manha');
    const iPuBase = col('PU Base Manha');
    if (iTipo < 0 || iVenc < 0 || iBase < 0 || (iPuVenda < 0 && iPuBase < 0)) return out;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const c = line.split(';');
        if (c.length <= iBase) continue;

        const base = toIso(c[iBase]);
        if (!base || (sinceIso && base < sinceIso)) continue;

        const family = classifyTreasuryLabel(c[iTipo]);
        if (!family) continue;
        const maturity = toIso(c[iVenc]);
        if (!maturity) continue;

        const puVenda = iPuVenda >= 0 ? toNum(c[iPuVenda]) : NaN;
        const puBase = iPuBase >= 0 ? toNum(c[iPuBase]) : NaN;
        const pu = puVenda > 0 ? puVenda : puBase;
        if (!(pu > 0)) continue;

        const rawBuy = iPuCompra >= 0 ? toNum(c[iPuCompra]) : NaN;
        // Bid-ask não se inverte e não é gigante: fora disso a coluna está corrompida.
        const puBuy = (rawBuy > 0 && rawBuy >= pu && (rawBuy / pu - 1) <= MAX_BUY_SPREAD) ? rawBuy : null;

        const rate = iTaxaVenda >= 0 ? toNum(c[iTaxaVenda]) : NaN;

        const titleKey = treasuryTitleKey(family, maturity);
        let entry = out.get(titleKey);
        if (!entry) {
            entry = {
                titleKey,
                family,
                maturity,
                sourceLabel: String(c[iTipo] || '').trim(),
                hasCoupon: familyHasCoupon(family),
                history: [],
            };
            out.set(titleKey, entry);
        }
        entry.history.push({ date: base, pu, puBuy, rate: Number.isFinite(rate) ? rate : null });
    }

    // O arquivo não vem ordenado por data — a busca de PU depende de ASC.
    for (const entry of out.values()) {
        entry.history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        // Uma Data Base pode repetir (republicação); o último registro vence.
        const dedup = [];
        for (const point of entry.history) {
            if (dedup.length > 0 && dedup[dedup.length - 1].date === point.date) dedup[dedup.length - 1] = point;
            else dedup.push(point);
        }
        entry.history = dedup;
    }

    return out;
};

/** Saltos diários grandes demais para serem preço — reportados, nunca silenciados. */
export const findSuspiciousMoves = (history) => {
    const flagged = [];
    for (let i = 1; i < history.length; i++) {
        const previous = history[i - 1].pu;
        const current = history[i].pu;
        if (!(previous > 0) || !(current > 0)) continue;
        const move = current / previous - 1;
        if (Math.abs(move) > SUSPICIOUS_DAILY_MOVE) {
            flagged.push({ date: history[i].date, move: Number((move * 100).toFixed(2)) });
        }
    }
    return flagged;
};

const cutoffIso = (years = HISTORY_YEARS) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.toISOString().slice(0, 10);
};

/**
 * Baixa, parseia e persiste as séries. A série de cada título é REESCRITA
 * inteira: o arquivo é a fonte da verdade e reescrever é idempotente — um
 * merge incremental herdaria para sempre qualquer ponto ruim já gravado.
 *
 * @returns {{ ok: boolean, titles: number, points: number, suspicious: Array, reason?: string }}
 */
export const ingestTreasuryPrices = async ({ years = HISTORY_YEARS, force = false } = {}) => {
    const csv = await fetchTesouroCsv({ force });
    if (!csv) {
        const reason = 'CSV oficial indisponível';
        Sentry.captureMessage(`[Tesouro PU] Ingestão abortada: ${reason}`, 'warning');
        return { ok: false, titles: 0, points: 0, suspicious: [], reason };
    }

    const series = parseTreasuryPriceCsv(csv, { sinceIso: cutoffIso(years) });
    if (series.size === 0) {
        const reason = 'nenhuma série reconhecida no arquivo (layout mudou?)';
        logger.error(`❌ [Tesouro PU] ${reason}`);
        Sentry.captureMessage(`[Tesouro PU] ${reason}`, 'error');
        return { ok: false, titles: 0, points: 0, suspicious: [], reason };
    }

    const now = new Date();
    const suspicious = [];
    let points = 0;
    const operations = [];

    for (const entry of series.values()) {
        points += entry.history.length;
        const flagged = findSuspiciousMoves(entry.history);
        if (flagged.length > 0) suspicious.push({ titleKey: entry.titleKey, moves: flagged });

        operations.push({
            updateOne: {
                filter: { titleKey: entry.titleKey },
                update: {
                    $set: {
                        family: entry.family,
                        maturity: entry.maturity,
                        sourceLabel: entry.sourceLabel,
                        hasCoupon: entry.hasCoupon,
                        history: entry.history,
                        lastUpdated: now,
                    },
                },
                upsert: true,
            },
        });
    }

    // Lotes pequenos: cada doc carrega a série inteira (~100 KB) e um bulkWrite
    // único de 90 títulos passaria de 10 MB por comando.
    const CHUNK = 10;
    for (let i = 0; i < operations.length; i += CHUNK) {
        await TreasuryPriceHistory.bulkWrite(operations.slice(i, i + CHUNK));
    }

    const lastBase = [...series.values()]
        .map((e) => e.history[e.history.length - 1]?.date)
        .filter(Boolean)
        .sort()
        .pop() || null;

    logger.info('[Tesouro PU] Séries de PU atualizadas', {
        titles: series.size,
        points,
        lastBase,
        suspicious: suspicious.length,
    });
    if (suspicious.length > 0) {
        logger.warn(`⚠️ [Tesouro PU] ${suspicious.length} título(s) com salto diário atípico`, { suspicious });
    }

    return { ok: true, titles: series.size, points, suspicious, lastBase };
};

/**
 * Carrega as séries pedidas como Map<titleKey, history[]>. Chaves sem série
 * simplesmente não aparecem — o chamador cai no accrual (fail-closed).
 */
export const loadTreasurySeries = async (titleKeys = []) => {
    const keys = [...new Set([...titleKeys].filter(Boolean))];
    if (keys.length === 0) return new Map();
    const docs = await TreasuryPriceHistory.find({ titleKey: { $in: keys } })
        .select('titleKey history')
        .lean();
    return new Map(docs.map((d) => [d.titleKey, d.history || []]));
};

/** Catálogo (chaves disponíveis) — o matcher precisa dele para desambiguar. */
export const loadTreasuryCatalog = async () => {
    const docs = await TreasuryPriceHistory.find({}).select('titleKey').lean();
    return docs.map((d) => d.titleKey);
};

/**
 * Contexto de precificação: dado um ativo, devolve a série de PU do título
 * correspondente (ou `null`, que o valorizador lê como "usa accrual").
 *
 * Existe para que TODOS os caminhos de patrimônio — KPI ao vivo, snapshot diário,
 * rebuild de histórico e projeção de metas — resolvam o título pela mesma regra.
 * Divergir aqui reintroduziria a divergência KPI × snapshot que o app já pagou
 * caro para eliminar.
 */
export const createTreasuryPricing = ({ catalog = [], series = new Map() } = {}) => ({
    catalog,
    series,
    /** Diagnóstico: por que este ativo é (ou não é) marcável. */
    resolve: (asset) => resolveTreasuryTitleKey(asset, catalog),
    historyFor: (asset) => {
        const { key } = resolveTreasuryTitleKey(asset, catalog);
        return key ? (series.get(key) || null) : null;
    },
});

/** Contexto vazio: nada é marcável, e sem nenhuma ida ao banco. */
export const EMPTY_TREASURY_PRICING = createTreasuryPricing();

/**
 * Monta o contexto para um conjunto de posições, buscando só as séries que essas
 * posições realmente usam. Sem nenhuma renda fixa na lista, não toca no banco —
 * a rota da carteira é quente e a maioria das carteiras não tem título público.
 */
export const loadTreasuryPricing = async (assets = []) => {
    const fixedIncome = (assets || []).filter((a) => a?.type === 'FIXED_INCOME');
    if (fixedIncome.length === 0) return EMPTY_TREASURY_PRICING;

    const catalog = await loadTreasuryCatalog();
    if (catalog.length === 0) return EMPTY_TREASURY_PRICING;

    const keys = fixedIncome
        .map((a) => resolveTreasuryTitleKey(a, catalog).key)
        .filter(Boolean);
    if (keys.length === 0) return createTreasuryPricing({ catalog });

    const series = await loadTreasurySeries(keys);
    return createTreasuryPricing({ catalog, series });
};

export default {
    TESOURO_CSV_URL,
    fetchTesouroCsv,
    clearCsvMemo,
    parseTreasuryPriceCsv,
    findSuspiciousMoves,
    ingestTreasuryPrices,
    loadTreasurySeries,
    loadTreasuryCatalog,
    createTreasuryPricing,
    loadTreasuryPricing,
    EMPTY_TREASURY_PRICING,
};
