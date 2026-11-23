/**
 * Diagnóstico do download do Tesouro (PURO): diz em português o que veio no
 * lugar do arquivo, para o card de erro e o painel de Fontes não mandarem olhar
 * o layout de um arquivo que nem foi baixado.
 */

const HTML_START = /^\s*(<!doctype html|<html|<head|<body)/i;
const RATE_LIMIT_PAGE = /muitas requisi|too many requests|acesso limitado|requisi[cç][oõ]es detectadas/i;
const BOT_CHALLENGE_PAGE = /captcha|cf-chl|challenge-platform|attention required|just a moment/i;
const TIMEOUT_CODES = /ECONNABORTED|ETIMEDOUT|TimeoutError|AbortError|ERR_CANCELED/i;

const htmlTitle = (body) => {
    const m = /<title[^>]*>([^<]{0,120})<\/title>/i.exec(body);
    return m ? m[1].replace(/\s+/g, ' ').trim() : null;
};

const describeNetworkError = (error) => {
    const code = error.code || error.name || '';
    if (TIMEOUT_CODES.test(code)) return 'tempo esgotado esperando o site do Tesouro';
    return `falha de rede ao baixar o CSV: ${String(error.message || error).slice(0, 120)}`;
};

const describeHttpStatus = (status, where) => {
    if (status === 429) return `o site do Tesouro bloqueou o download por excesso de requisições ${where}`;
    if (status === 403) return `acesso negado pelo site do Tesouro ${where}`;
    if (status === 404 || status === 410) return `o endereço do CSV não existe mais ${where}`;
    if (status >= 500) return `site do Tesouro fora do ar ${where}`;
    if (status != null && (status < 200 || status >= 300)) return `resposta inesperada do site do Tesouro ${where}`;
    return null;
};

const looksLikeHtml = (head, contentType) => HTML_START.test(head) || /text\/html/i.test(contentType || '');

const describeHtmlPage = (head, where) => {
    if (RATE_LIMIT_PAGE.test(head)) {
        return `o site do Tesouro devolveu a página de bloqueio "Acesso Limitado" (excesso de requisições) em vez do CSV ${where}`;
    }
    if (BOT_CHALLENGE_PAGE.test(head)) {
        return `o site do Tesouro devolveu um desafio anti-robô em vez do CSV ${where}`;
    }
    const title = htmlTitle(head);
    return `o site do Tesouro devolveu uma página HTML${title ? ` ("${title}")` : ''} em vez do CSV ${where}`;
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
    if (error) return describeNetworkError(error);
    const text = typeof body === 'string' ? body : String(body ?? '');
    const where = `[HTTP ${status ?? '?'}, ${contentType || 'sem content-type'}, ${text.length} B]`;
    const byStatus = describeHttpStatus(status, where);
    if (byStatus) return byStatus;

    const head = text.slice(0, 4000);
    if (looksLikeHtml(head, contentType)) return describeHtmlPage(head, where);
    if (text.length < 1000) return `resposta sem conteúdo útil ${where}`;
    return null;
};

/** O arquivo veio, mas o parser não achou série: aí sim é layout. PURA. */
export const describeCsvLayoutProblem = (csv) => {
    const header = String(csv || '').split(/\r?\n/, 1)[0].slice(0, 160);
    return `arquivo baixado, mas o cabeçalho não tem as colunas esperadas (layout mudou?): "${header}"`;
};
