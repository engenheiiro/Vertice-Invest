/**
 * Fonte de DATA DE PAGAMENTO de provento — quando o dinheiro cai na conta.
 *
 * Nossa fonte de proventos (Yahoo, `externalMarketService.getDividendsHistory`)
 * publica só a EX-DATE e o valor. Sem este serviço, todo caminho que precisa saber
 * quando o crédito acontece ESTIMA ex-date + 15 dias (`utils/dividendPaymentDate.js`)
 * — uma estimativa que, medida contra 443 datas reais em 09/09/2026, acerta 0,5%
 * das vezes e erra 26 dias em média. Em ação ela não é imprecisa, é estruturalmente
 * errada: a empresa aprova hoje e paga meses depois (CMIG4 fica ex em 06/2026 e
 * paga em 06/2027).
 *
 * DUAS FONTES, PAPÉIS DIFERENTES — E NÃO É PREFERÊNCIA, É RESTRIÇÃO
 *
 *  · B3 (viva, roda no servidor). API dos próprios sistemas de listados. Datou
 *    91,4% dos eventos oficiais dos últimos 12 meses e 100% dos FIIs. Guarda
 *    apenas ~12 meses: o endpoint "supplement" é uma janela móvel, não um
 *    arquivo. É a fonte do dia a dia porque é autoritativa e porque o servidor
 *    a alcança — já consumimos `arquivos.b3.com.br` de produção.
 *
 *  · Fundamentus (reserva, NÃO roda no servidor). Alcança 1995 e datou 75,6% dos
 *    eventos de 36 meses, mas o IP do Render responde 403 (ver
 *    `fundamentusService.js`) e a página de FII atrasa nos meses recentes. Serve
 *    para o histórico anterior ao alcance da B3, disparado à mão da máquina do
 *    desenvolvedor — o mesmo arranjo do `sync:prod`.
 *
 * Onde as duas dataram o mesmo evento, concordaram em 100% dos casos.
 *
 * FAIL-CLOSED É O CONTRATO
 * Nada aqui grava data deduzida. Fonte fora do ar, layout mudado, valor que não
 * bate, evento que a fonte não conhece ou pagamento ambíguo (ver
 * `utils/dividendPaymentMatch.js`) devolvem NADA para aquele evento — e o evento
 * segue com `paymentDate` nulo, caindo na estimativa que se declara estimativa na
 * tela. Errar para menos aqui custa um "~" no card; errar para mais faz o produto
 * afirmar, com selo de oficial, uma data que ele inventou.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import logger from '../config/logger.js';
import DividendEvent from '../models/DividendEvent.js';
import MarketAsset from '../models/MarketAsset.js';
import { trackSource, recordEscalation } from '../utils/sourceHealth.js';
import { matchPaymentDate, DESFECHO } from '../utils/dividendPaymentMatch.js';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    Referer: 'https://www.google.com/',
};

const TIMEOUT_MS = 25000;

/** Classes que estas fontes cobrem. Cripto, renda fixa e papel estrangeiro, não. */
export const CLASSES_SUPORTADAS = ['STOCK', 'FII'];

// ————————————————————————————————————————————————— parsing

/**
 * "dd/mm/aaaa" → meia-noite UTC do dia.
 *
 * Rejeita ano fora de [1990, 2100] de propósito: a B3 usa `31/12/9999` como
 * sentinela de "sem data com" (visto em SHUL4). Sem essa recusa, o sentinela
 * viraria uma data válida no futuro e o evento seria casado com o pagamento errado.
 */
export const parseDataBr = (str) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(str || '').trim());
    if (!m) return null;
    const [, d, mo, y] = m;
    const ano = Number(y);
    if (ano < 1990 || ano > 2100) return null;
    const dt = new Date(Date.UTC(ano, Number(mo) - 1, Number(d)));
    return Number.isNaN(dt.getTime()) ? null : dt;
};

/** "0,10000000000" / "1.234,56" → número. */
export const parseValorBr = (str) => {
    const limpo = String(str || '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '').trim();
    const n = Number.parseFloat(limpo);
    return Number.isFinite(n) ? n : null;
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

// ————————————————————————————————————————————————— B3

const B3_FUNDS = 'https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall';
const B3_COMPANIES = 'https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall';

/** FII no cadastro de fundos listados da B3. FIAGRO e outros tipos não foram medidos. */
const B3_TYPE_FUND_FII = 7;

const b3Get = async (url) => {
    const r = await axios.get(url, {
        headers: { ...HEADERS, Accept: 'application/json, text/plain, */*', Referer: 'https://www.b3.com.br/' },
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    // O proxy de fundos responde `text/plain` com JSON dentro.
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
};

/**
 * Classe do papel a partir do ISIN brasileiro: `BRITSAACNOR0` é ON, `BRITSAACNPR7`
 * é PN, `BRSANBCDAM13` é UNIT. O endpoint de empresa devolve os proventos de TODAS
 * as classes juntas; sem este filtro, ITSA3 herdaria o provento da ITSA4.
 */
export const classeDoIsin = (isin) => {
    const s = String(isin || '').toUpperCase();
    if (/ACNOR\d?$/.test(s)) return 'ON';
    if (/ACNPR\d?$/.test(s)) return 'PN';
    if (/ACNPA\d?$/.test(s)) return 'PNA';
    if (/ACNPB\d?$/.test(s)) return 'PNB';
    if (/CDAM\d*$/.test(s)) return 'UNIT';
    return null;
};

/** Sufixo do ticker → classe. 3=ON, 4=PN, 5=PNA, 6=PNB, 11=UNIT. */
export const classeDoTicker = (ticker) => {
    const m = /^[A-Z]{4}(\d{1,2})$/.exec(String(ticker || '').toUpperCase());
    if (!m) return null;
    return { 3: 'ON', 4: 'PN', 5: 'PNA', 6: 'PNB', 11: 'UNIT' }[Number(m[1])] || null;
};

export const normalizaCashDividend = (cd) => ({
    dataCom: parseDataBr(cd?.lastDatePrior),
    dataPagamento: parseDataBr(cd?.paymentDate),
    valor: parseValorBr(cd?.rate),
    rotulo: String(cd?.label || '').trim(),
    isin: cd?.isinCode || cd?.assetIssued || null,
});

const b3Fii = async (ticker) => {
    const identificador = ticker.replace(/\d+$/, '').toUpperCase();
    const d = await b3Get(`${B3_FUNDS}/GetListedSupplementFunds/${b64({ typeFund: B3_TYPE_FUND_FII, identifierFund: identificador })}`);
    return (d?.cashDividends || []).map(normalizaCashDividend);
};

const b3Acao = async (ticker) => {
    const busca = await b3Get(`${B3_COMPANIES}/GetInitialCompanies/${b64({ language: 'pt-br', pageNumber: 1, pageSize: 5, company: ticker })}`);
    const empresa = busca?.results?.[0]?.issuingCompany;
    if (!empresa) return [];

    const bruto = await b3Get(`${B3_COMPANIES}/GetListedSupplementCompany/${b64({ issuingCompany: empresa, language: 'pt-br' })}`);
    const doc = Array.isArray(bruto) ? bruto[0] : bruto;
    const todos = (doc?.cashDividends || []).map(normalizaCashDividend);

    // Sem classe reconhecida no ticker não dá para separar ON de PN. Devolver a
    // lista inteira colaria provento da classe errada; devolver nada só perde
    // cobertura. Perder cobertura é a direção segura.
    const classeAlvo = classeDoTicker(ticker);
    if (!classeAlvo) return [];
    return todos.filter((e) => classeDoIsin(e.isin) === classeAlvo);
};

// ————————————————————————————————————————————————— Fundamentus

const fundamentusHtml = async (url) => {
    const r = await axios.get(url, {
        headers: HEADERS, responseType: 'arraybuffer', timeout: TIMEOUT_MS, decompress: true, validateStatus: () => true,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return cheerio.load(iconv.decode(r.data, 'iso-8859-1'));
};

/**
 * As duas páginas do Fundamentus têm colunas DIFERENTES:
 *   FII  → Última Data Com | Tipo | Data de Pagamento | Valor
 *   Ação → Data | Valor | Tipo | Data de Pagamento | Por quantas ações
 *
 * A leitura é pelo CABEÇALHO, nunca por índice fixo — o mesmo cuidado que
 * `config/scraperSchemas.js` aplica ao resto do Fundamentus. Se o site trocar as
 * colunas de lugar, isto devolve vazio (e o evento fica sem data) em vez de gravar
 * o valor no campo da data.
 */
export const parseTabelaFundamentus = ($) => {
    const tabela = $('#resultado').first();
    if (!tabela.length) return null;

    const cabecalho = tabela.find('thead th').map((_, th) => $(th).text().trim().toLowerCase()).get();
    const acha = (...nomes) => cabecalho.findIndex((h) => nomes.some((n) => h.includes(n)));
    const iCom = acha('data com', 'última data com');
    const iPag = acha('data de pagamento');
    const iVal = acha('valor');
    const iTipo = acha('tipo');
    // Na página de ações a coluna da data-com se chama só "Data".
    const iComFinal = iCom >= 0 ? iCom : cabecalho.findIndex((h) => h === 'data');
    if (iComFinal < 0 || iPag < 0 || iVal < 0) return null;

    const eventos = [];
    tabela.find('tbody tr').each((_, tr) => {
        const tds = $(tr).find('td').map((__, td) => $(td).text().trim()).get();
        const dataCom = parseDataBr(tds[iComFinal]);
        if (!dataCom) return;
        eventos.push({
            dataCom,
            dataPagamento: parseDataBr(tds[iPag]),
            valor: parseValorBr(tds[iVal]),
            rotulo: iTipo >= 0 ? tds[iTipo] : '',
            isin: null,
        });
    });
    return eventos;
};

/**
 * "A empresa não paga provento" é uma RESPOSTA, não uma falha.
 *
 * A página serve 200 com a frase "Nenhum provento encontrado" e sem tabela
 * nenhuma. Sem distinguir isso de layout quebrado, o backfill de 09/09/2026
 * acusou 14 ativos (AZUL3, LUPA3, MWET4…) como "layout da tabela mudou" — um
 * diagnóstico falso que mandaria consertar um parser que está correto, e que
 * ainda contaria como falha da fonte no painel.
 */
const FUNDAMENTUS_SEM_PROVENTO = /nenhum\s+provento\s+encontrado/i;

const fundamentus = async (ticker, tipo) => {
    const url = tipo === 'FII'
        ? `https://www.fundamentus.com.br/fii_proventos.php?papel=${encodeURIComponent(ticker)}&tipo=2`
        : `https://www.fundamentus.com.br/proventos.php?papel=${encodeURIComponent(ticker)}&tipo=2`;
    const $ = await fundamentusHtml(url);
    const eventos = parseTabelaFundamentus($);
    if (eventos !== null) return eventos;
    if (FUNDAMENTUS_SEM_PROVENTO.test($('body').text())) return [];
    // Sem tabela E sem a frase: aí sim o layout mudou, e o certo é falhar alto em
    // vez de devolver lista vazia — vazio silencioso viraria "a fonte não conhece
    // este provento" e o defeito passaria despercebido.
    throw new Error('layout da tabela de proventos mudou');
};

// ————————————————————————————————————————————————— catálogo de fontes

export const FONTES = {
    B3: {
        id: 'B3',
        sourceId: 'b3.dividends',
        rotulo: 'B3',
        buscar: (ticker, tipo) => (tipo === 'FII' ? b3Fii(ticker) : b3Acao(ticker)),
    },
    FUNDAMENTUS: {
        id: 'FUNDAMENTUS',
        sourceId: 'fundamentus.dividends',
        rotulo: 'Fundamentus',
        buscar: fundamentus,
    },
};

/** Ordem viva: só a B3, que é a única que responde do servidor de produção. */
export const CADEIA_VIVA = [FONTES.B3];

/** Ordem do backfill manual: B3 primeiro (autoritativa), Fundamentus para o que ela não alcança. */
export const CADEIA_BACKFILL = [FONTES.B3, FONTES.FUNDAMENTUS];

// ————————————————————————————————————————————————— orquestração

/**
 * Descobre a data de pagamento dos eventos de UM ticker.
 *
 * @param {string} ticker
 * @param {'STOCK'|'FII'} tipo
 * @param {Array<{_id:any, date: Date, amount: number, source?: string}>} eventos os NOSSOS,
 *        já no banco. Só entram aqui os que ainda não têm data real.
 * @param {{cadeia?: Array<object>}} [opcoes]
 * @returns {Promise<{datas: Map<string, {dataPagamento: Date, fonte: string, evidencia: string}>,
 *                    tentadas: string[], falhas: Array<{fonte:string, motivo:string}>,
 *                    desfechos: Record<string, number>}>}
 */
export const resolvePaymentDatesForTicker = async (ticker, tipo, eventos, opcoes = {}) => {
    const cadeia = opcoes.cadeia || CADEIA_VIVA;
    const datas = new Map();
    const tentadas = [];
    const falhas = [];
    const desfechos = {};

    if (!CLASSES_SUPORTADAS.includes(tipo) || !Array.isArray(eventos) || eventos.length === 0) {
        return { datas, tentadas, falhas, desfechos };
    }

    for (const fonte of cadeia) {
        // Quem já foi datado por uma fonte anterior da cadeia não é reperguntado:
        // a primeira que responde é a mais autoritativa da ordem.
        const pendentes = eventos.filter((ev) => !datas.has(String(ev._id)));
        if (pendentes.length === 0) break;

        tentadas.push(fonte.id);
        let publicados;
        try {
            // SEM `isEmpty` de propósito, ao contrário das fontes de cotação.
            // Lista vazia aqui é resposta correta e comum: a empresa não paga
            // provento, ou o FII não está no cadastro de fundos listados. Marcar
            // isso como "respondeu sem dado utilizável" empurraria a taxa de falha
            // da fonte para cima por um comportamento que é o esperado, e o card
            // ficaria amarelo com a fonte funcionando.
            publicados = await trackSource(fonte.sourceId, () => fonte.buscar(ticker, tipo));
        } catch (error) {
            falhas.push({ fonte: fonte.id, motivo: error.message });
            logger.warn('[DataPagamento] Fonte indisponível', { ticker, fonte: fonte.id, erro: error.message });
            continue;
        }

        for (const ev of pendentes) {
            // O provento PROVISÓRIO tem o valor deduzido do gap do dia-ex, então é
            // aproximado por construção — cobrar que ele bata com o centavo da
            // fonte descartaria justamente os eventos mais recentes, que são os
            // que aparecem na tela como "a receber".
            const permitirSoData = ev.source === 'DERIVED';
            const r = matchPaymentDate(ev, publicados, { permitirSoData });
            desfechos[r.desfecho] = (desfechos[r.desfecho] || 0) + 1;
            if (r.desfecho === DESFECHO.CASADO && r.dataPagamento) {
                datas.set(String(ev._id), {
                    dataPagamento: r.dataPagamento,
                    fonte: fonte.id,
                    evidencia: r.evidencia,
                });
            }
        }
    }

    // Trilha por ASSUNTO para o painel de fontes: qual elo da cadeia resolveu este
    // ticker, e — quando ninguém resolveu — se o motivo foi a fonte ou o mundo.
    // Provento cuja data o emissor ainda não anunciou não é falha de fonte, e sem
    // esta distinção o card ficaria amarelo por um sistema funcionando.
    const sourceIdPorFonte = new Map(cadeia.map((f) => [f.id, f.sourceId]));
    const resolvedBy = [...datas.values()][0]?.fonte || null;
    const divergente = (desfechos[DESFECHO.VALOR_DIVERGENTE] || 0) > 0;
    const ambiguo = (desfechos[DESFECHO.AMBIGUO] || 0) > 0;

    const razao = () => {
        if (falhas.length) return 'fonte indisponível';
        if (divergente) return 'a fonte publica pagamento nessa data, mas com valor que não confere';
        if (ambiguo) return 'pagamento dividido em datas diferentes';
        return 'pagamento ainda não anunciado';
    };

    recordEscalation({
        chain: 'paymentDate',
        subject: ticker,
        tried: tentadas.map((id) => sourceIdPorFonte.get(id)).filter(Boolean),
        resolvedBy: resolvedBy ? sourceIdPorFonte.get(resolvedBy) || null : null,
        reason: resolvedBy ? null : razao(),
        // `expected` quer dizer "ninguém PODERIA ter resolvido", e é o que o painel
        // subtrai antes de pintar a linha de vermelho. Duas coisas não cabem aí:
        // fonte fora do ar, e valor que não confere — nesta a fonte TEM o
        // pagamento naquela data e quem não conseguiu casar fomos nós. Marcá-las
        // como esperadas esconderia justamente o buraco que dá para fechar.
        expected: !resolvedBy && falhas.length === 0 && !divergente,
    });

    return { datas, tentadas, falhas, desfechos };
};

/**
 * Preenche `paymentDate` dos eventos de UM ticker que ainda não têm data real.
 *
 * Só toca em quem está sem data: uma data já gravada por fonte não é reescrita,
 * porque a fonte mais nova não é mais autoritativa que a mais antiga — e reescrever
 * a cada sync faria o card mudar de dia sem que nada tenha mudado no mundo.
 *
 * @param {string} ticker
 * @param {'STOCK'|'FII'} tipo
 * @param {{cadeia?: Array<object>, desde?: Date}} [opcoes]
 * @returns {Promise<{preenchidos: number, tentados: number, falhas: Array}>}
 */
export const fillPaymentDatesForTicker = async (ticker, tipo, opcoes = {}) => {
    if (!CLASSES_SUPORTADAS.includes(tipo)) return { preenchidos: 0, tentados: 0, falhas: [] };

    const filtro = { ticker, paymentDate: { $in: [null, undefined] } };
    if (opcoes.desde) filtro.date = { $gte: opcoes.desde };

    const pendentes = await DividendEvent.find(filtro).select('_id date amount source').lean();
    if (pendentes.length === 0) return { preenchidos: 0, tentados: 0, falhas: [] };

    const { datas, falhas } = await resolvePaymentDatesForTicker(ticker, tipo, pendentes, opcoes);

    let preenchidos = 0;
    for (const [id, { dataPagamento, fonte }] of datas) {
        // A condição de nulo repetida na escrita não é redundância: entre a leitura
        // e este update pode ter passado outro sync. Quem já datou, datou.
        const res = await DividendEvent.updateOne(
            { _id: id, paymentDate: { $in: [null, undefined] } },
            { $set: { paymentDate: dataPagamento, paymentDateSource: fonte } },
        );
        if (res.modifiedCount > 0) preenchidos += 1;
    }

    if (preenchidos > 0) {
        logger.info('[DataPagamento] Datas reais gravadas', { ticker, preenchidos, pendentes: pendentes.length });
    }
    return { preenchidos, tentados: pendentes.length, falhas };
};

/** Respiro entre ativos. Raspagem em rajada é o jeito mais rápido de ser bloqueado. */
const PAUSA_ENTRE_ATIVOS_MS = 700;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Varre o banco preenchendo o que ainda não tem data de pagamento.
 *
 * É a rotina por trás do botão "Preencher datas de pagamento" do Admin e do
 * script de linha de comando — os dois chamam ESTA função, para não existirem duas
 * respostas diferentes para a mesma pergunta.
 *
 * SOBRE QUANDO RODAR: não tem periodicidade. A B3 roda sozinha no sync diário e
 * cobre os últimos 12 meses, então nenhum provento NOVO envelhece sem data. Este
 * backfill existe para o passivo histórico — o que ficou para trás antes de a B3
 * passar a ser consultada — e para isso uma passada resolve. Depois dela, só vale
 * rodar de novo quando o card "Data de pagamento dos proventos" do Admin acusar
 * evento antigo sem data; é o painel que avisa, não o calendário.
 *
 * @param {{cadeia?: Array<object>, limite?: number, tickers?: string[],
 *          onProgress?: (p: object) => void}} [opcoes]
 */
export const backfillPaymentDates = async (opcoes = {}) => {
    const cadeia = opcoes.cadeia || CADEIA_BACKFILL;
    const inicio = Date.now();

    // Universo: quem tem evento sem data. Perguntar por ticker que já está
    // completo gastaria uma requisição por ativo para não escrever nada.
    const pendentesPorTicker = await DividendEvent.aggregate([
        { $match: { paymentDate: { $in: [null, undefined] } } },
        { $group: { _id: '$ticker', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
    ]);

    const tipos = new Map(
        (await MarketAsset.find({ type: { $in: CLASSES_SUPORTADAS } }).select('ticker type').lean())
            .map((a) => [a.ticker.toUpperCase(), a.type]),
    );

    const alvo = opcoes.tickers?.length
        ? new Set(opcoes.tickers.map((t) => t.toUpperCase()))
        : null;

    let fila = pendentesPorTicker
        .map((r) => ({ ticker: String(r._id).toUpperCase(), pendentes: r.n }))
        .filter((r) => tipos.has(r.ticker))
        .filter((r) => !alvo || alvo.has(r.ticker));
    if (opcoes.limite > 0) fila = fila.slice(0, opcoes.limite);

    const resumo = {
        ativos: fila.length,
        preenchidos: 0,
        tentados: 0,
        porFonte: {},
        falhas: [],
        // Ativos fora do alcance das fontes (cripto, renda fixa, papel dos EUA) não
        // entram na fila e não contam como buraco: elas nunca teriam a resposta.
        foraDeEscopo: pendentesPorTicker.length - fila.length,
    };

    for (let i = 0; i < fila.length; i += 1) {
        const { ticker } = fila[i];
        const tipo = tipos.get(ticker);
        try {
            const r = await fillPaymentDatesForTicker(ticker, tipo, { cadeia });
            resumo.preenchidos += r.preenchidos;
            resumo.tentados += r.tentados;
            for (const f of r.falhas) resumo.falhas.push({ ticker, ...f });
        } catch (error) {
            resumo.falhas.push({ ticker, fonte: '?', motivo: error.message });
        }
        opcoes.onProgress?.({ i: i + 1, total: fila.length, ticker, resumo });
        if (i < fila.length - 1) await pausa(PAUSA_ENTRE_ATIVOS_MS);
    }

    // Procedência do que existe AGORA — é o número que o Admin mostra depois de
    // rodar, e responde "adiantou?" sem precisar de outra consulta.
    const porFonte = await DividendEvent.aggregate([
        { $match: { paymentDateSource: { $ne: null, $exists: true } } },
        { $group: { _id: '$paymentDateSource', n: { $sum: 1 } } },
    ]);
    for (const row of porFonte) resumo.porFonte[row._id] = row.n;
    resumo.duracaoMs = Date.now() - inicio;

    logger.info('[DataPagamento] Backfill concluído', {
        ativos: resumo.ativos,
        preenchidos: resumo.preenchidos,
        tentados: resumo.tentados,
        falhas: resumo.falhas.length,
        duracaoMs: resumo.duracaoMs,
    });
    return resumo;
};
