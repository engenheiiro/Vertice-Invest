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
import { trackSource } from '../utils/sourceHealth.js';
import { isBrBusinessDay, brazilDayKey } from '../utils/walletSnapshot.js';

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

const HTML_START = /^\s*(<!doctype html|<html|<head|<body)/i;
const RATE_LIMIT_PAGE = /muitas requisi|too many requests|acesso limitado|requisi[cç][oõ]es detectadas/i;
const BOT_CHALLENGE_PAGE = /captcha|cf-chl|challenge-platform|attention required|just a moment/i;

const htmlTitle = (body) => {
    const m = /<title[^>]*>([^<]{0,120})<\/title>/i.exec(body);
    return m ? m[1].replace(/\s+/g, ' ').trim() : null;
};

/**
 * O que veio no lugar do CSV, em português de quem lê o card de erro. PURA.
 * `null` = parece um CSV (quem decide o layout é o parser).
 *
 * Existe porque toda resposta que não era o arquivo virava "nenhuma série
 * reconhecida (layout mudou?)": uma página de bloqueio de 3 KB com HTTP 200
 * passava pelo filtro de tamanho e chegava ao parser, e o diagnóstico mandava
 * olhar o layout de um arquivo que nem tinha sido baixado.
 */
export const describeTesouroDownloadProblem = ({ status = null, contentType = '', body = '', error = null } = {}) => {
    if (error) {
        const code = error.code || error.name || '';
        if (/ECONNABORTED|ETIMEDOUT|TimeoutError|AbortError|ERR_CANCELED/i.test(code)) {
            return 'tempo esgotado esperando o site do Tesouro';
        }
        return `falha de rede ao baixar o CSV: ${String(error.message || error).slice(0, 120)}`;
    }
    const text = typeof body === 'string' ? body : String(body ?? '');
    const where = `[HTTP ${status ?? '?'}, ${contentType || 'sem content-type'}, ${text.length} B]`;
    if (status === 429) return `o site do Tesouro bloqueou o download por excesso de requisições ${where}`;
    if (status === 403) return `acesso negado pelo site do Tesouro ${where}`;
    if (status === 404 || status === 410) return `o endereço do CSV não existe mais ${where}`;
    if (status >= 500) return `site do Tesouro fora do ar ${where}`;
    if (status != null && (status < 200 || status >= 300)) return `resposta inesperada do site do Tesouro ${where}`;

    const head = text.slice(0, 4000);
    if (HTML_START.test(head) || /text\/html/i.test(contentType || '')) {
        if (RATE_LIMIT_PAGE.test(head)) {
            return `o site do Tesouro devolveu a página de bloqueio "Acesso Limitado" (excesso de requisições) em vez do CSV ${where}`;
        }
        if (BOT_CHALLENGE_PAGE.test(head)) {
            return `o site do Tesouro devolveu um desafio anti-robô em vez do CSV ${where}`;
        }
        const title = htmlTitle(head);
        return `o site do Tesouro devolveu uma página HTML${title ? ` ("${title}")` : ''} em vez do CSV ${where}`;
    }
    if (text.length < 1000) return `resposta sem conteúdo útil ${where}`;
    return null;
};

/** O arquivo veio, mas o parser não achou série: aí sim é layout. PURA. */
export const describeCsvLayoutProblem = (csv) => {
    const header = String(csv || '').split(/\r?\n/, 1)[0].slice(0, 160);
    return `arquivo baixado, mas o cabeçalho não tem as colunas esperadas (layout mudou?): "${header}"`;
};

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

// ─────────────────────────────────────────────────────────────────────────────
// Reserva: JSON do Tesouro Direto (pregão corrente)
// ─────────────────────────────────────────────────────────────────────────────

const TD_TIMEOUT_MS = 30_000;
let tdMemo = { at: 0, quotes: null };

/** "IPCA + 6,84%" / "12,88%" / "SELIC + 0,1089%" → 6.84 / 12.88 / 0.1089; "SELIC" → null. */
const parseTdRate = (label) => {
    const all = [...String(label || '').matchAll(/(-?\d+(?:,\d+)?)\s*%/g)];
    if (all.length === 0) return null;
    const v = Number(all[all.length - 1][1].replace(',', '.'));
    return Number.isFinite(v) ? v : null;
};

/**
 * JSON do Tesouro Direto → pontos `{ titleKey, family, maturity, sourceLabel,
 * point: { date, pu, puBuy, rate } }`. PURA. A data é o dia de
 * `lastMarketPricingDate` (horário de Brasília, sem fuso no texto); fim de
 * semana/feriado fica de fora — é o Tesouro Reserva reprecificando no sábado,
 * não pregão. Mesma guarda de bid-ask do CSV no PU de compra.
 */
export const parseTesouroDiretoQuotes = (json, { isBusinessDay = isBrBusinessDay } = {}) => {
    const bonds = [...(json?.TesouroLegado || []), ...(json?.Tesouro24x7 || [])];
    const out = [];
    const seen = new Set();
    for (const b of bonds) {
        const family = classifyTreasuryLabel(b?.treasuryBondName);
        if (!family) continue;
        const maturity = /^\d{4}-\d{2}-\d{2}/.test(String(b?.maturityDate || '')) ? b.maturityDate.slice(0, 10) : null;
        const date = /^\d{4}-\d{2}-\d{2}/.test(String(b?.lastMarketPricingDate || '')) ? b.lastMarketPricingDate.slice(0, 10) : null;
        if (!maturity || !date || !isBusinessDay(date)) continue;
        const pu = Number(b.unitaryRedemptionValue);
        if (!(pu > 0)) continue;
        const rawBuy = Number(b.unitaryInvestmentValue);
        const puBuy = (rawBuy > 0 && rawBuy >= pu && (rawBuy / pu - 1) <= MAX_BUY_SPREAD) ? rawBuy : null;
        const titleKey = treasuryTitleKey(family, maturity);
        if (seen.has(titleKey)) continue;
        seen.add(titleKey);
        out.push({
            titleKey,
            family,
            maturity,
            sourceLabel: String(b.treasuryBondName || '').trim(),
            point: { date, pu, puBuy, rate: parseTdRate(b.redemptionProfitabilityFeeIndexerName) },
        });
    }
    return out;
};

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
export const clearTesouroDiretoMemo = () => { tdMemo = { at: 0, quotes: null }; };

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

    const written = series.size > 0 ? await writeCsvSeries(series) : { titles: 0, points: 0, suspicious: [], lastBase: null };
    let lastBase = written.lastBase;
    let source = series.size > 0 ? 'CSV' : null;

    // CSV fora ou ATRASADO (veio, mas sem o pregão esperado — em out/2026 o
    // arquivo ficou dias parado e cada rodada gravava SUCCESS sem avançar a
    // série): o JSON do Tesouro Direto completa a ponta.
    let fallback = null;
    if (!lastBase || (expected && lastBase < expected)) {
        fallback = await appendTesouroDiretoQuotes({ force });
        if (fallback.appended > 0 && (!lastBase || fallback.lastBase > lastBase)) {
            lastBase = fallback.lastBase;
            source = 'TESOURO_DIRETO';
        }
    }

    const base = { titles: written.titles, points: written.points, suspicious: written.suspicious, lastBase, source };
    const reached = expected ? Boolean(lastBase && lastBase >= expected) : Boolean(lastBase);
    if (!reached) {
        const csvPart = csvProblem
            ? `CSV oficial: ${csvProblem}`
            : `CSV oficial ainda parado em ${written.lastBase}`;
        let tdPart = 'Tesouro Direto: nada a acrescentar';
        if (fallback?.problem) tdPart = `Tesouro Direto: ${fallback.problem}`;
        else if (fallback?.lastBase) tdPart = `Tesouro Direto: só tem o pregão ${fallback.lastBase}`;
        return { ...base, ok: false, reason: `pregão ${expected || '?'} não entrou — ${csvPart}; ${tdPart}` };
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
