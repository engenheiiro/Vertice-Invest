import { fetchB3DailyCloses } from './b3DailyFileService.js';
import { isBrBusinessDay } from '../utils/walletSnapshot.js';

/**
 * A B3 COMO SEGUNDA FONTE DA SÉRIE DIÁRIA.
 *
 * O arquivo consolidado da B3 já cobria o candle do dia dos ativos EM CARTEIRA
 * (`walletDayCandleService`), acionado pelo snapshot das 23:59 e pela reconciliação
 * horária. O universo de pesquisa — as ~1.300 séries que alimentam SMA, RSI, beta,
 * volatilidade e o backtest — continuava com fonte única: se o Yahoo não entregasse,
 * a série simplesmente parava.
 *
 * Este módulo é a parte compartilhada dos dois caminhos. Existe como módulo, e não
 * copiado no worker, porque os dois escrevem na MESMA coleção com as mesmas regras
 * de dia útil e de cobertura — e duas cópias divergem: foi assim que a janela de
 * drawdown do motor âncora ficou com um defeito corrigido só num dos lados.
 *
 * O QUE ELE NÃO FAZ, e é o limite honesto do reforço: não reconstrói histórico. O
 * arquivo é por pregão, ~8,5 MB cada, então recuperar um ano custaria ~250 downloads.
 * A B3 estende a PONTA de uma série que já existe; série vazia continua dependendo
 * do Yahoo, e é o que a tela precisa dizer para não prometer cobertura que não há.
 */

/** Classes cujo fechamento está no arquivo do à vista. */
export const B3_FALLBACK_TYPES = new Set(['STOCK', 'FII', 'ETF']);

/** ITSA4, BOVA11, KNSC11 — exclui VOO, QQQ, AAPL e BTC-USD. */
export const B3_TICKER_RE = /^[A-Z]{4}\d{1,2}$/;

/**
 * Teto de dias buscados por alvo num run. O arquivo existe para qualquer pregão
 * passado, então sem teto uma série parada há meses pediria dezenas de downloads
 * de uma vez. Rombo grande é assunto do `scripts/backfillB3Closes.js`, que roda
 * sob supervisão; aqui só se fecha a lacuna da ponta.
 */
export const MAX_B3_FALLBACK_DAYS = 5;

/** O ativo tem fechamento no arquivo da B3? */
export const isB3Coverable = (ticker, type) => B3_FALLBACK_TYPES.has(String(type || '').trim().toUpperCase())
    && B3_TICKER_RE.test(String(ticker || '').trim().toUpperCase());

/**
 * Dias ÚTEIS sem candle entre o último guardado e `throughDay` (inclusive).
 *
 * Preencher só o último dia seria pior que não preencher: empurrar o candle de hoje
 * numa série parada há três dias deixa o buraco no meio E faz `isHistoryStale` ver a
 * série como fresca — o worker nunca mais voltaria lá. Foi o defeito que congelou 21
 * séries em 30/08/2026.
 */
export const missingBusinessDays = (lastCandleDate, throughDay, maxDays = MAX_B3_FALLBACK_DAYS) => {
    if (!throughDay || !isBrBusinessDay(throughDay)) return [];
    if (!lastCandleDate || lastCandleDate >= throughDay) {
        return lastCandleDate === throughDay ? [] : [throughDay];
    }
    const dias = [];
    const cursor = new Date(`${throughDay}T12:00:00.000Z`);
    while (dias.length < maxDays) {
        const key = cursor.toISOString().slice(0, 10);
        if (key <= lastCandleDate) break;
        if (isBrBusinessDay(key)) dias.push(key);
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return dias.reverse();
};

/** Último dia útil da B3 até `dayStr`, inclusive. Sábado e domingo olham a sexta. */
export const lastBusinessDayUpTo = (dayStr) => {
    let key = dayStr;
    for (let i = 0; i < 10; i += 1) {
        if (isBrBusinessDay(key)) return key;
        const cursor = new Date(`${key}T12:00:00.000Z`);
        cursor.setUTCDate(cursor.getUTCDate() - 1);
        key = cursor.toISOString().slice(0, 10);
    }
    return null;
};

/**
 * Busca na B3 os candles que faltam na ponta de cada alvo.
 *
 * Não grava nada. Os dois chamadores mesclam com regras próprias — o worker aplica
 * o teto de pontos da série e a guarda de dia sem pregão, o caminho da carteira não
 * —, e devolver candle cru é o que permite compartilhar a busca sem unificar a
 * gravação, que é onde as regras legitimamente divergem.
 *
 * Um download por DIA, nunca por ticker: as lacunas viram uma união de dias, e o
 * memo (mais a deduplicação de chamadas em voo) de `b3DailyFileService` garante que
 * cada pregão desça uma vez só, mesmo com o worker pedindo em paralelo.
 *
 * @param {Array<{key:string, ticker:string, type:string, lastCandleDate:string|null}>} alvos
 * @param {string} throughDay último dia desejado (YYYY-MM-DD)
 * @param {{maxDays?: number}} [opts]
 * @returns {Promise<Map<string, Array<{date:string, close:number, volume:number}>>>} candles novos por `key`
 */
export const collectB3Candles = async (alvos = [], throughDay, { maxDays = MAX_B3_FALLBACK_DAYS } = {}) => {
    const saida = new Map();
    if (!throughDay || alvos.length === 0) return saida;

    const cobertos = alvos.filter((a) => isB3Coverable(a?.ticker, a?.type));
    if (cobertos.length === 0) return saida;

    const diasPorAlvo = new Map();
    const todosOsDias = new Set();
    for (const alvo of cobertos) {
        const dias = missingBusinessDays(alvo.lastCandleDate, throughDay, maxDays);
        if (dias.length === 0) continue;
        diasPorAlvo.set(alvo.key, dias);
        for (const dia of dias) todosOsDias.add(dia);
    }
    if (todosOsDias.size === 0) return saida;

    const porDia = new Map();
    for (const dia of [...todosOsDias].sort()) porDia.set(dia, await fetchB3DailyCloses(dia));

    for (const alvo of cobertos) {
        const dias = diasPorAlvo.get(alvo.key);
        if (!dias) continue;
        const ticker = String(alvo.ticker).trim().toUpperCase();
        const novos = [];
        for (const dia of dias) {
            const linha = porDia.get(dia)?.get(ticker);
            // Ausente no arquivo = o papel não negociou naquele dia. Não é falha:
            // dia sem negócio não tem fechamento, e inventar um seria pior.
            if (linha) novos.push({ date: dia, close: linha.close, volume: linha.volume });
        }
        if (novos.length > 0) saida.set(alvo.key, novos);
    }
    return saida;
};
