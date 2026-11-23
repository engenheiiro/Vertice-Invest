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
import { resolveTreasuryTitleKey } from '../utils/treasuryTitle.js';
import { trackSource } from '../utils/sourceHealth.js';
import { isBrBusinessDay, brazilDayKey } from '../utils/walletSnapshot.js';
import { describeTesouroDownloadProblem, describeCsvLayoutProblem } from './treasury/downloadDiagnosis.js';
import { MAX_BUY_SPREAD, parseTreasuryPriceCsv, parseTesouroDiretoQuotes } from './treasury/treasuryQuoteParsers.js';

export { describeTesouroDownloadProblem, describeCsvLayoutProblem, MAX_BUY_SPREAD, parseTreasuryPriceCsv, parseTesouroDiretoQuotes };

export const TESOURO_CSV_URL = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv';

/**
 * Reserva OFICIAL do CSV: o JSON que a própria tela de "Investir" do Tesouro
 * Direto consome. Traz só o pregão CORRENTE (sem histórico) e só os títulos à
 * venda (~35, contra ~80 do CSV), mas com o mesmo par de preços — PU de resgate
 * (= "PU Venda" do CSV, o que o investidor recebe) e PU de investimento
 * (= "PU Compra"). Existe porque em out/2026 o CSV parou de ser republicado
 * (`last_modified` do recurso no CKAN travado em 16/10) e, de 21/10 em diante,
 * o download passou a voltar em ~0,3 s sem o arquivo — a série de PU parou em
 * 15/10 com o job acusando "layout mudou?".
 */
export const TESOURO_DIRETO_QUOTES_URL = 'https://www.tesourodireto.com.br/o/rentabilidade/investir';

/**
 * Profundidade da série guardada. O arquivo cobre desde 2002, mas o que o app
 * precisa é (a) marcar posições vivas e (b) reconstruir o histórico da carteira
 * desde a primeira compra. 8 anos cobre com folga qualquer carteira do sistema e
 * mantém a coleção na casa de poucos MB (~80k linhas → ~90 títulos × ~2.000 dias).
 */
export const HISTORY_YEARS = 8;

/** Salto diário a partir do qual o ponto é reportado (não descartado). */
const SUSPICIOUS_DAILY_MOVE = 0.20;

const tesouroAgent = new https.Agent({ rejectUnauthorized: true, keepAlive: true, minVersion: 'TLSv1.2' });

// Medido em 16/10/2026, com o servidor degradado: 42–70 s até o primeiro byte
// (até num 304 sem corpo) e de 86 a 148 s no download inteiro, que vem sem
// compressão. O teto antigo de 45 s ficava abaixo do tempo real e derrubava ~12%
// das chamadas. O `timeout` do axios no Node é de INATIVIDADE do socket, não de
// duração — um download que pinga devagar nunca o dispararia — por isso o teto
// total vem à parte, pelo AbortSignal. Somado ao pior caso do macro-sync (209 s),
// ainda cabe nos 10 min do job.
const CSV_IDLE_TIMEOUT_MS = 90_000;
const CSV_TOTAL_TIMEOUT_MS = 300_000;

// Memo do download bruto. TTL curto: serve para que macro sync e ingestão de PU,
// que rodam no mesmo job, dividam UM download — não para servir dado velho.
const CSV_MEMO_TTL_MS = 15 * 60 * 1000;
let csvMemo = { at: 0, csv: null };

/**
 * Baixa o CSV oficial (memoizado por 15 min). Devolve `{ csv, problem }`: `csv`
 * nulo sempre vem com o motivo legível, que também vai para o registro de saúde
 * da fonte (painel de Fontes) em vez de "respondeu sem dado utilizável".
 */
export const downloadTesouroCsv = async ({ force = false } = {}) => {
    if (!force && csvMemo.csv && (Date.now() - csvMemo.at) < CSV_MEMO_TTL_MS) return { csv: csvMemo.csv, problem: null };
    let problem = null;
    try {
        const res = await trackSource('tesouro', async () => {
            let response;
            try {
                response = await axios.get(TESOURO_CSV_URL, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'text/csv, text/plain, */*',
                        'Accept-Encoding': 'gzip',
                    },
                    httpsAgent: tesouroAgent,
                    timeout: CSV_IDLE_TIMEOUT_MS,
                    signal: AbortSignal.timeout(CSV_TOTAL_TIMEOUT_MS),
                    responseType: 'text',
                    transformResponse: [(d) => d], // não deixa o axios tentar parsear como JSON
                    maxContentLength: 64 * 1024 * 1024,
                    maxBodyLength: 64 * 1024 * 1024,
                    // Status não-2xx é lido aqui, não lançado: o diagnóstico precisa do corpo.
                    validateStatus: () => true,
                });
            } catch (error) {
                problem = describeTesouroDownloadProblem({ error });
                throw new Error(problem);
            }
            problem = describeTesouroDownloadProblem({
                status: response.status,
                contentType: response.headers?.['content-type'],
                body: response.data,
            });
            if (problem) throw new Error(problem);
            return response;
        });
        const csv = typeof res.data === 'string' ? res.data : String(res.data ?? '');
        csvMemo = { at: Date.now(), csv };
        return { csv, problem: null };
    } catch (error) {
        problem = problem || describeTesouroDownloadProblem({ error });
        logger.warn(`[Tesouro PU] Download do CSV oficial falhou: ${problem}`);
        return { csv: null, problem };
    }
};

/** Baixa o CSV oficial (memoizado por 15 min). `null` se a fonte falhar. */
export const fetchTesouroCsv = async (opts = {}) => (await downloadTesouroCsv(opts)).csv;

/** Descarta o memo (usado nos testes e no sync forçado). */
export const clearCsvMemo = () => { csvMemo = { at: 0, csv: null }; };

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

// ─────────────────────────────────────────────────────────────────────────────
// Reserva: JSON do Tesouro Direto (pregão corrente)
// ─────────────────────────────────────────────────────────────────────────────

const TD_TIMEOUT_MS = 30_000;
let tdMemo = { at: 0, quotes: null };

/** Baixa e parseia o JSON (memo de 15 min). `{ quotes, problem }`. */
export const fetchTesouroDiretoQuotes = async ({ force = false } = {}) => {
    if (!force && tdMemo.quotes && (Date.now() - tdMemo.at) < CSV_MEMO_TTL_MS) return { quotes: tdMemo.quotes, problem: null };
    let problem = null;
    try {
        const quotes = await trackSource('tesouro.direto', async () => {
            let res;
            try {
                res = await axios.get(TESOURO_DIRETO_QUOTES_URL, {
                    headers: { 'Accept': 'application/json' },
                    httpsAgent: tesouroAgent,
                    timeout: TD_TIMEOUT_MS,
                    signal: AbortSignal.timeout(TD_TIMEOUT_MS),
                    validateStatus: () => true,
                });
            } catch (error) {
                problem = describeTesouroDownloadProblem({ error }).replace(/o CSV/g, 'o JSON');
                throw new Error(problem);
            }
            const isJson = res.data && typeof res.data === 'object';
            if (res.status < 200 || res.status >= 300 || !isJson) {
                problem = (describeTesouroDownloadProblem({
                    status: res.status,
                    contentType: res.headers?.['content-type'],
                    body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? ''),
                }) || `resposta não é JSON [HTTP ${res.status}]`).replace(/o CSV/g, 'o JSON');
                throw new Error(problem);
            }
            const parsed = parseTesouroDiretoQuotes(res.data);
            if (parsed.length === 0) {
                problem = 'JSON do Tesouro Direto sem nenhum título reconhecido (formato mudou?)';
                throw new Error(problem);
            }
            return parsed;
        });
        tdMemo = { at: Date.now(), quotes };
        return { quotes, problem: null };
    } catch (error) {
        problem = problem || String(error?.message || error);
        logger.warn(`[Tesouro PU] Reserva Tesouro Direto falhou: ${problem}`);
        return { quotes: null, problem };
    }
};

/** Descarta o memo do JSON (testes). */
export const _clearTesouroDiretoMemo = () => { tdMemo = { at: 0, quotes: null }; };

/**
 * Quais pontos do JSON entram: só títulos que JÁ têm série (o CSV é quem cria
 * a série, com rótulo e cupom resolvidos) e só datas POSTERIORES ao último ponto
 * gravado — a reserva completa a ponta, nunca reescreve o que o CSV publicou.
 * PURA. `lastByKey`: Map<titleKey, última data gravada>.
 */
export const selectAppendableQuotes = (quotes, lastByKey) => (quotes || []).filter((q) => {
    if (!lastByKey.has(q.titleKey)) return false;
    const last = lastByKey.get(q.titleKey);
    return !last || q.point.date > last;
});

/**
 * Acrescenta o pregão corrente do Tesouro Direto às séries existentes.
 * O CSV, quando voltar, reescreve a série inteira e substitui estes pontos
 * pelos do arquivo — por isso a reserva só ACRESCENTA.
 *
 * Limite conhecido: o JSON só tem o pregão do momento. Num dia em que o job
 * pula (pregão esperado já gravado), aquele pregão não é capturado; a marcação
 * usa o PU anterior mais próximo (`findTreasuryPu`), como em qualquer atraso.
 *
 * @returns {{ appended: number, lastBase: string|null, problem: string|null }}
 */
export const appendTesouroDiretoQuotes = async ({ force = false } = {}) => {
    const { quotes, problem } = await fetchTesouroDiretoQuotes({ force });
    if (!quotes) return { appended: 0, lastBase: null, problem };

    const rows = await TreasuryPriceHistory.aggregate([
        { $match: { titleKey: { $in: quotes.map((q) => q.titleKey) } } },
        { $project: { titleKey: 1, last: { $max: '$history.date' } } },
    ]);
    const lastByKey = new Map(rows.map((r) => [r.titleKey, r.last || null]));
    const toAppend = selectAppendableQuotes(quotes, lastByKey);
    const quoteDate = quotes.map((q) => q.point.date).sort().pop() || null;

    if (toAppend.length > 0) {
        const now = new Date();
        await TreasuryPriceHistory.bulkWrite(toAppend.map((q) => ({
            updateOne: {
                filter: { titleKey: q.titleKey },
                update: { $push: { history: q.point }, $set: { lastUpdated: now } },
            },
        })));
        logger.info(`[Tesouro PU] Reserva Tesouro Direto: pregão ${quoteDate} acrescentado em ${toAppend.length} título(s)`);
    }
    return { appended: toAppend.length, lastBase: quoteDate, problem: null };
};

/**
 * Data Base que o arquivo já deveria trazer no dia `todayKey`: o dia útil
 * ANTERIOR (a fonte publica D-1 na manhã de D). PURA — `isBusinessDay` é
 * injetável para teste.
 */
export const expectedTreasuryDataBase = (todayKey, isBusinessDay = isBrBusinessDay) => {
    const d = new Date(`${todayKey}T12:00:00.000Z`);
    // 10 dias cobre qualquer emenda de feriado com fim de semana.
    for (let i = 0; i < 10; i++) {
        d.setUTCDate(d.getUTCDate() - 1);
        const key = d.toISOString().slice(0, 10);
        if (isBusinessDay(key)) return key;
    }
    return null;
};

/** Data Base mais recente gravada em qualquer título (`null` com a coleção vazia). */
export const latestStoredTreasuryDate = async () => {
    const [row] = await TreasuryPriceHistory.aggregate([
        { $project: { last: { $max: '$history.date' } } },
        { $group: { _id: null, max: { $max: '$last' } } },
    ]);
    return row?.max || null;
};

const cutoffIso = (years = HISTORY_YEARS) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.toISOString().slice(0, 10);
};

/** Baixa e parseia o CSV; o problema (download ou layout) é registrado aqui. */
const loadCsvSeries = async ({ years, force }) => {
    const { csv, problem: downloadProblem } = await downloadTesouroCsv({ force });
    let csvProblem = downloadProblem;
    let series = new Map();
    if (csv) {
        series = parseTreasuryPriceCsv(csv, { sinceIso: cutoffIso(years) });
        if (series.size === 0) csvProblem = describeCsvLayoutProblem(csv);
    }
    if (csvProblem) {
        logger.error(`❌ [Tesouro PU] CSV oficial: ${csvProblem}`);
        Sentry.captureMessage(`[Tesouro PU] CSV oficial: ${csvProblem}`, 'error');
    }
    return { series, csvProblem };
};

/**
 * CSV fora ou ATRASADO (veio, mas sem o pregão esperado — em out/2026 o
 * arquivo ficou dias parado e cada rodada gravava SUCCESS sem avançar a
 * série): o JSON do Tesouro Direto completa a ponta.
 */
const completeWithTesouroDireto = async ({ lastBase, source, expected, force }) => {
    if (lastBase && !(expected && lastBase < expected)) return { lastBase, source, fallback: null };
    const fallback = await appendTesouroDiretoQuotes({ force });
    if (fallback.appended > 0 && (!lastBase || fallback.lastBase > lastBase)) {
        return { lastBase: fallback.lastBase, source: 'TESOURO_DIRETO', fallback };
    }
    return { lastBase, source, fallback };
};

const sessionReached = (lastBase, expected) => (expected ? Boolean(lastBase && lastBase >= expected) : Boolean(lastBase));

const describeMissedSession = ({ expected, csvProblem, csvLastBase, fallback }) => {
    const csvPart = csvProblem
        ? `CSV oficial: ${csvProblem}`
        : `CSV oficial ainda parado em ${csvLastBase}`;
    let tdPart = 'Tesouro Direto: nada a acrescentar';
    if (fallback?.problem) tdPart = `Tesouro Direto: ${fallback.problem}`;
    else if (fallback?.lastBase) tdPart = `Tesouro Direto: só tem o pregão ${fallback.lastBase}`;
    return `pregão ${expected || '?'} não entrou — ${csvPart}; ${tdPart}`;
};

/**
 * Baixa, parseia e persiste as séries. A série de cada título é REESCRITA
 * inteira: o arquivo é a fonte da verdade e reescrever é idempotente — um
 * merge incremental herdaria para sempre qualquer ponto ruim já gravado.
 *
 * `ok` só é verdadeiro quando a série chegou ao pregão ESPERADO
 * (`expectedTreasuryDataBase`), venha ele do CSV ou da reserva do Tesouro
 * Direto. CSV baixado mas parado num dia antigo é falha, com o motivo dito.
 *
 * @returns {{ ok: boolean, titles: number, points: number, suspicious: Array,
 *   lastBase: string|null, source: 'CSV'|'TESOURO_DIRETO'|null, reason?: string, csvProblem?: string|null }}
 */
export const ingestTreasuryPrices = async ({ years = HISTORY_YEARS, force = false, todayKey = brazilDayKey(new Date()) } = {}) => {
    const expected = expectedTreasuryDataBase(todayKey);
    const { series, csvProblem } = await loadCsvSeries({ years, force });
    const hasSeries = series.size > 0;
    const written = hasSeries ? await writeCsvSeries(series) : { titles: 0, points: 0, suspicious: [], lastBase: null };
    const tip = await completeWithTesouroDireto({ lastBase: written.lastBase, source: hasSeries ? 'CSV' : null, expected, force });

    const base = { titles: written.titles, points: written.points, suspicious: written.suspicious, lastBase: tip.lastBase, source: tip.source };
    if (!sessionReached(tip.lastBase, expected)) {
        const reason = describeMissedSession({ expected, csvProblem, csvLastBase: written.lastBase, fallback: tip.fallback });
        return { ...base, ok: false, reason };
    }
    return { ...base, ok: true, csvProblem: csvProblem || null };
};

/** Persiste as séries do CSV (reescrita idempotente da série inteira). */
const writeCsvSeries = async (series) => {
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

    return { titles: series.size, points, suspicious, lastBase };
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
    TESOURO_DIRETO_QUOTES_URL,
    fetchTesouroCsv,
    downloadTesouroCsv,
    fetchTesouroDiretoQuotes,
    appendTesouroDiretoQuotes,
    expectedTreasuryDataBase,
    latestStoredTreasuryDate,
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
