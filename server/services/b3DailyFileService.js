import axios from 'axios';
import https from 'https';
import logger from '../config/logger.js';
import { withRetry } from '../utils/resilience.js';

/**
 * FECHAMENTO OFICIAL DO PREGÃO, DIRETO DA B3.
 *
 * Existe porque o Yahoo — fonte única de série diária até aqui — publica, sem
 * aviso e sem padrão, a linha do dia com `close` nulo. Em 27/08/2026 foram 7
 * ETFs; na sexta 28/08/2026 foram 661 séries de ação, FII e ETF, enquanto as 495
 * americanas vieram normais. O buraco é DEFINITIVO (o candle não chega depois) e
 * não segue classe nem liquidez, então não dá para prever nem esperar.
 *
 * A B3 publica o próprio arquivo do dia, de graça e sem chave: um GET pede o
 * token, outro baixa o CSV. É o resumo consolidado de negociação — a autoridade
 * sobre o fechamento, não um terceiro repassando.
 *
 * Por que ele e não uma fonte por ticker: o arquivo traz o mercado inteiro em UMA
 * requisição (~8,5 MB, ~135 mil linhas, ~1s). Consertar os 661 ativos parados
 * custa um download, não 661 chamadas.
 *
 * Convenção CONFERIDA contra o Yahoo em 27/08/2026, dia que as duas fontes têm:
 * ITSA4 12,84 · PETR4 42,70 · CMIG4 10,40 · SHUL4 4,57 · BOVA11 172,40 ·
 * IVVB11 450,00 · BTLG11 97,92 · HGCR11 92,98 — 8 de 8 idênticos. `LastPric` é o
 * mesmo número que o `close` do Yahoo, então o candle da B3 entra na série sem
 * criar degrau. (O ajuste por proventos continua vindo do Yahoo em `adjClose`.)
 *
 * Cobre SÓ a B3. Ação americana e cripto seguem no Yahoo.
 */

const REQUEST_URL = 'https://arquivos.b3.com.br/api/download/requestname';
const DOWNLOAD_URL = 'https://arquivos.b3.com.br/api/download/';
const FILE_NAME = 'TradeInformationConsolidated';

/**
 * Segmento do mercado à vista. O filtro NÃO é detalhe: das ~135 mil linhas do
 * arquivo, ~129 mil são opções (EQUITY CALL/PUT) e o resto se divide em termo,
 * fracionário e block trade. O à vista são ~1.400 linhas — e é a única fatia em
 * que `TckrSymb` significa o que a nossa série significa.
 */
const SPOT_SEGMENT = 'CASH';

const B3_AGENT = new https.Agent({ rejectUnauthorized: true, keepAlive: true, minVersion: 'TLSv1.2' });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Memo POR DIA e do resultado JÁ PARSEADO (~1.400 entradas), nunca do CSV cru:
// guardar o texto de vários dias estouraria o heap de 400 MB do processo. TTL
// longo porque o arquivo do dia é `Final` — não muda depois de publicado. Serve
// para a carteira e a varredura do universo dividirem UM download por dia.
const MEMO_TTL_MS = 6 * 60 * 60 * 1000;
const MEMO_MAX_DAYS = 8;
const memo = new Map(); // dayStr -> { at, closes }

/** Número no formato brasileiro do arquivo (`1.234,56`). NaN vira null. */
export const parseB3Number = (raw) => {
    const clean = String(raw ?? '').trim().replace(/\./g, '').replace(',', '.');
    if (!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
};

/**
 * Extrai os fechamentos do à vista de `dayStr` a partir do texto do arquivo.
 *
 * Exportada para teste — é aqui que mora todo o risco de formato.
 *
 * @param {string} text conteúdo do CSV
 * @param {string} dayStr dia pedido (YYYY-MM-DD)
 * @returns {Map<string, {close:number, volume:number, trades:number}>|null} null = arquivo não utilizável
 */
export const parseB3TradeFile = (text, dayStr) => {
    const linhas = String(text || '').split('\n');
    if (linhas.length < 3) return null;

    // A 1ª linha declara a maturidade do arquivo. Só o `Final` vale: um arquivo
    // preliminar carregaria preço sujeito a revisão, e o nosso candle é gravado
    // para não ser revisitado. Recusar aqui só desliga o reforço — o caminho
    // volta a ser o de hoje, que é o comportamento seguro.
    if (!/final/i.test(linhas[0])) {
        logger.warn(`[B3] Arquivo de ${dayStr} não está Final: "${String(linhas[0]).trim()}" — ignorado.`);
        return null;
    }

    // Cabeçalho lido por NOME: a ordem das colunas é da B3, não nossa.
    const cab = linhas[1].split(';').map((c) => c.trim());
    const iDate = cab.indexOf('RptDt');
    const iSym = cab.indexOf('TckrSymb');
    const iSeg = cab.indexOf('SgmtNm');
    const iLast = cab.indexOf('LastPric');
    const iQty = cab.indexOf('FinInstrmQty'); // quantidade negociada (mesma noção do volume do Yahoo)
    const iTrades = cab.indexOf('TradQty');   // número de negócios
    if ([iDate, iSym, iSeg, iLast].some((i) => i < 0)) {
        logger.warn(`[B3] Cabeçalho inesperado no arquivo de ${dayStr}: ${linhas[1]}`);
        return null;
    }

    const closes = new Map();
    for (let i = 2; i < linhas.length; i += 1) {
        const col = linhas[i].split(';');
        if (col.length <= iLast) continue;
        if (col[iSeg] !== SPOT_SEGMENT) continue;
        // O arquivo é do dia, mas conferir a data é barato e impede que uma
        // resposta trocada pela B3 vire candle na data errada.
        if (col[iDate] !== dayStr) continue;
        const ticker = String(col[iSym] || '').trim().toUpperCase();
        const close = parseB3Number(col[iLast]);
        if (!ticker || !(close > 0)) continue;
        closes.set(ticker, {
            close,
            volume: iQty >= 0 ? (parseB3Number(col[iQty]) || 0) : 0,
            trades: iTrades >= 0 ? (parseB3Number(col[iTrades]) || 0) : 0,
        });
    }
    return closes.size > 0 ? closes : null;
};

/**
 * Fechamentos oficiais do pregão de `dayStr`.
 *
 * `null` cobre os dois desfechos em que não há o que usar: a B3 não publicou o
 * dia (fim de semana, feriado, ou pregão ainda em apuração — o pedido do token
 * responde 400) e a falha de rede. São logados em níveis diferentes porque só o
 * segundo é defeito; o primeiro é resposta legítima e, de quebra, confirma que o
 * dia não teve pregão.
 *
 * @param {string} dayStr YYYY-MM-DD
 * @returns {Promise<Map<string, {close:number, volume:number, trades:number}>|null>}
 */
export const fetchB3DailyCloses = async (dayStr) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayStr || ''))) return null;

    const cached = memo.get(dayStr);
    if (cached && (Date.now() - cached.at) < MEMO_TTL_MS) return cached.closes;

    try {
        const closes = await withRetry(async () => {
            const req = await axios.get(REQUEST_URL, {
                params: { fileName: FILE_NAME, date: dayStr },
                headers: { 'User-Agent': UA, Accept: 'application/json, */*' },
                httpsAgent: B3_AGENT,
                timeout: 30000,
                validateStatus: (s) => s === 200 || s === 400 || s === 404,
            });
            // Dia sem arquivo: a B3 recusa o pedido do token. Não é erro nosso e
            // não deve ser re-tentado — devolvemos null e o chamador segue.
            if (req.status !== 200) return null;

            const token = String(req.data?.redirectUrl || '').split('token=')[1];
            if (!token) return null;

            const dl = await axios.get(`${DOWNLOAD_URL}?token=${token}`, {
                headers: { 'User-Agent': UA, Accept: 'text/csv, text/plain, */*', 'Accept-Encoding': 'gzip' },
                httpsAgent: B3_AGENT,
                timeout: 60000,
                responseType: 'text',
                transformResponse: [(d) => d], // o arquivo é CSV; não deixar o axios adivinhar
                maxContentLength: 64 * 1024 * 1024,
                maxBodyLength: 64 * 1024 * 1024,
            });
            return parseB3TradeFile(dl.data, dayStr);
        }, { retries: 2, baseDelayMs: 500 });

        if (closes) {
            memo.set(dayStr, { at: Date.now(), closes });
            // Poda simples: a varredura pede poucos dias por run, e segurar mais
            // que isso só ocuparia heap.
            if (memo.size > MEMO_MAX_DAYS) memo.delete(memo.keys().next().value);
            logger.debug(`[B3] Fechamento oficial de ${dayStr}: ${closes.size} papéis no à vista.`);
        } else {
            logger.debug(`[B3] Sem arquivo publicado para ${dayStr} (dia sem pregão ou ainda em apuração).`);
        }
        return closes;
    } catch (error) {
        logger.warn(`[B3] Falha ao obter o fechamento oficial de ${dayStr}: ${error.message}`);
        return null;
    }
};

/** Descarta o memo (testes e runs forçados). */
export const clearB3Memo = () => memo.clear();

export const b3DailyFileService = { fetchB3DailyCloses, parseB3TradeFile, clearB3Memo };
