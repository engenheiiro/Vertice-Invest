/**
 * AUDITORIA DAS FONTES DE DATA DE PAGAMENTO DE PROVENTO — READ-ONLY.
 *
 * O PROBLEMA
 * Nossa única fonte de proventos é o Yahoo (`externalMarketService.getDividendsHistory`),
 * que publica `{date, amount}` — a EX-DATE e o valor por cota. QUANDO o dinheiro
 * cai na conta não vem. Por isso todo caminho que precisa da data de pagamento
 * ESTIMA ex-date + 15 dias corridos (`utils/dividendPaymentDate.js`), e a
 * estimativa é a REGRA, não a exceção. Caso real: GGRC11 ficou ex em 02/09/2026,
 * pagou em 09/09 e a carteira exibia 16/09 — sete dias de erro numa tela que o
 * usuário lê como calendário.
 *
 * O QUE ESTE SCRIPT FAZ
 * Não propõe fonte: MEDE as candidatas contra os eventos que já temos no banco,
 * do mesmo jeito que `auditCryptoSymbols.js` mede o símbolo do provedor antes de
 * a gente confiar nele. Para cada evento nosso, pergunta a cada fonte se ela sabe
 * datar aquele pagamento, e responde três coisas que decidem a escolha:
 *
 *  1) COBERTURA — que fração dos nossos eventos a fonte consegue datar, separada
 *     por classe (ação × FII) e por janela (12m × total). Cobertura de anedota
 *     não serve: uma fonte pode acertar GGRC11 e não conhecer metade da B3.
 *  2) ALINHAMENTO — a fonte publica "última data com", que é o dia ANTERIOR à
 *     ex-date do Yahoo. O deslocamento é medido, não assumido: o histograma de
 *     `ex-date − data-com` precisa ficar concentrado em +1 dia útil, senão o
 *     casamento entre as duas bases está errado e a data importada seria colada
 *     no evento errado.
 *  3) AMBIGUIDADE — o Yahoo agrega numa linha só o que a fonte publica em várias
 *     (PETR4 em 21/08/2026: um DIVIDENDO e dois JRS CAP PRÓPRIO, com DUAS datas
 *     de pagamento diferentes). Onde o nosso evento é uma soma, não existe "a"
 *     data de pagamento — e importar uma delas seria inventar precisão. O script
 *     conta esses casos, porque eles definem o teto real de cobertura honesta.
 *
 * De quebra mede o ERRO DA ESTIMATIVA ATUAL contra as datas reais que a fonte
 * traz: é o número que diz se os 15 dias corridos são um chute razoável ou não.
 *
 * FONTES MEDIDAS
 *  · b3          — API dos próprios sistemas da B3 que alimenta o site de listados.
 *                  FII: `fundsProxy/GetListedSupplementFunds`. Ação: resolve o
 *                  ticker em empresa (`GetInitialCompanies`) e lê
 *                  `GetListedSupplementCompany`, filtrando pela classe do papel
 *                  via ISIN (ON/PN/PNA/PNB/UNIT).
 *  · fundamentus — `fii_proventos.php` / `proventos.php`, tabela "Data de Pagamento".
 *                  Já raspamos este site em `services/fundamentusService.js`.
 *
 * Status Invest ficou de fora: responde 403 a requisição de servidor (medido em
 * 09/09/2026). Investidor10 não expõe as datas na API de gráfico e obrigaria a
 * baixar ~1,7 MB de HTML por ativo.
 *
 * USO
 *   node server/scripts/auditDividendPaymentSources.js                  # amostra padrão
 *   node server/scripts/auditDividendPaymentSources.js --limit=60
 *   node server/scripts/auditDividendPaymentSources.js --tickers=GGRC11,PETR4
 *   node server/scripts/auditDividendPaymentSources.js --sources=b3
 *   node server/scripts/auditDividendPaymentSources.js --meses=12
 *
 * NÃO ESCREVE NADA. Nenhum update, nenhum upsert, nenhum índice.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { connectScriptDb } = await import('./lib/scriptDb.js');
const DividendEvent = (await import('../models/DividendEvent.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const { addBusinessDays, toDateKey } = await import('../utils/dateUtils.js');
const { estimatedPaymentDate } = await import('../utils/dividendPaymentDate.js');

// ————————————————————————————————————————————————— argumentos

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const ALVO = arg('tickers')?.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) || null;
const LIMITE = Number(arg('limit', '40'));
const MESES = Number(arg('meses', '24'));
const FONTES = (arg('sources', 'b3,fundamentus')).split(',').map((s) => s.trim().toLowerCase());

// Casamento data-a-data: a fonte publica "última data com" e o Yahoo publica a
// ex-date, que é o pregão seguinte. Aceitamos uma folga de 3 dias corridos para
// medir o deslocamento real em vez de presumir que ele é sempre +1 dia útil.
const TOLERANCIA_DIAS = 3;
// Duas leituras do mesmo pagamento divergem no arredondamento (0,109829 × 0,109744).
// 5% separa "mesmo provento" de "provento diferente no mesmo dia".
const TOLERANCIA_VALOR = 0.05;
const DIA_MS = 86400000;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// ————————————————————————————————————————————————— parsing comum

const HEADERS_NAVEGADOR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    Referer: 'https://www.google.com/',
};

/** "dd/mm/aaaa" → meia-noite UTC do dia. Rejeita o sentinela 31/12/9999 da B3. */
const parseDataBr = (str) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(str || '').trim());
    if (!m) return null;
    const [, d, mo, y] = m;
    const ano = Number(y);
    if (ano < 1990 || ano > 2100) return null; // 31/12/9999 = "sem data com" na B3
    const dt = new Date(Date.UTC(ano, Number(mo) - 1, Number(d)));
    return Number.isNaN(dt.getTime()) ? null : dt;
};

/** "0,10000000000" / "1.234,56" → número. */
const parseValorBr = (str) => {
    const limpo = String(str || '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '').trim();
    const n = Number.parseFloat(limpo);
    return Number.isFinite(n) ? n : null;
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

// ————————————————————————————————————————————————— fonte: B3

const b3Get = async (url) => {
    const r = await axios.get(url, {
        headers: { ...HEADERS_NAVEGADOR, Accept: 'application/json, text/plain, */*', Referer: 'https://www.b3.com.br/' },
        timeout: 25000,
        validateStatus: () => true,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
};

/**
 * Classe do papel a partir do ISIN brasileiro. `BRITSAACNOR0` é ON, `BRITSAACNPR7`
 * é PN, `BRSANBCDAM13` é UNIT. O sufixo numérico do ticker diz a mesma coisa
 * (3=ON, 4=PN, 5=PNA, 6=PNB, 11=UNIT) — sem esse filtro, ITSA3 e ITSA4 herdariam
 * os proventos um do outro.
 */
const classeDoIsin = (isin) => {
    const s = String(isin || '').toUpperCase();
    if (/ACNOR\d?$/.test(s)) return 'ON';
    if (/ACNPR\d?$/.test(s)) return 'PN';
    if (/ACNPA\d?$/.test(s)) return 'PNA';
    if (/ACNPB\d?$/.test(s)) return 'PNB';
    if (/CDAM\d*$/.test(s)) return 'UNIT';
    return null;
};

const classeDoTicker = (ticker) => {
    const m = /^[A-Z]{4}(\d{1,2})$/.exec(String(ticker || '').toUpperCase());
    if (!m) return null;
    return { 3: 'ON', 4: 'PN', 5: 'PNA', 6: 'PNB', 11: 'UNIT' }[Number(m[1])] || null;
};

const normalizaB3 = (cd) => ({
    dataCom: parseDataBr(cd.lastDatePrior),
    dataPagamento: parseDataBr(cd.paymentDate),
    valor: parseValorBr(cd.rate),
    rotulo: String(cd.label || '').trim(),
    isin: cd.isinCode || cd.assetIssued || null,
});

const b3Fii = async (ticker) => {
    const identificador = ticker.replace(/\d+$/, '').toUpperCase();
    const d = await b3Get(`https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds/${b64({ typeFund: 7, identifierFund: identificador })}`);
    const cd = d?.cashDividends || [];
    return { eventos: cd.map(normalizaB3), rotulo: (d?.fund || '').trim() };
};

const b3Acao = async (ticker) => {
    const busca = await b3Get(`https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies/${b64({ language: 'pt-br', pageNumber: 1, pageSize: 5, company: ticker })}`);
    const empresa = busca?.results?.[0]?.issuingCompany;
    if (!empresa) return { eventos: [], rotulo: null, motivo: 'ticker não resolve em empresa' };

    const bruto = await b3Get(`https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/${b64({ issuingCompany: empresa, language: 'pt-br' })}`);
    const doc = Array.isArray(bruto) ? bruto[0] : bruto;
    const classeAlvo = classeDoTicker(ticker);
    const todos = (doc?.cashDividends || []).map(normalizaB3);
    // Sem classe reconhecida no ticker, é mais honesto não filtrar e marcar o caso
    // do que arriscar colar o provento da ON no papel PN.
    const eventos = classeAlvo ? todos.filter((e) => classeDoIsin(e.isin) === classeAlvo) : todos;
    return { eventos, rotulo: empresa, semFiltroDeClasse: !classeAlvo };
};

const fonteB3 = async (ticker, tipo) => (tipo === 'FII' ? b3Fii(ticker) : b3Acao(ticker));

// ————————————————————————————————————————————————— fonte: Fundamentus

const fundamentusHtml = async (url) => {
    const r = await axios.get(url, { headers: HEADERS_NAVEGADOR, responseType: 'arraybuffer', timeout: 25000, decompress: true, validateStatus: () => true });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return cheerio.load(iconv.decode(r.data, 'iso-8859-1'));
};

/**
 * As duas páginas têm colunas DIFERENTES e a ordem importa:
 *   FII  → Última Data Com | Tipo | Data de Pagamento | Valor
 *   Ação → Data | Valor | Tipo | Data de Pagamento | Por quantas ações
 * Ler pelo cabeçalho (e não por índice fixo) é o mesmo cuidado que
 * `config/scraperSchemas.js` aplica ao resto do Fundamentus: se o site trocar as
 * colunas de lugar, a leitura falha em vez de trocar valor por data.
 */
const fonteFundamentus = async (ticker, tipo) => {
    const url = tipo === 'FII'
        ? `https://www.fundamentus.com.br/fii_proventos.php?papel=${ticker}&tipo=2`
        : `https://www.fundamentus.com.br/proventos.php?papel=${ticker}&tipo=2`;
    const $ = await fundamentusHtml(url);
    const tabela = $('#resultado').first();
    if (!tabela.length) return { eventos: [], rotulo: null, motivo: 'tabela #resultado ausente' };

    const cabecalho = tabela.find('thead th').map((_, th) => $(th).text().trim().toLowerCase()).get();
    const col = (...nomes) => cabecalho.findIndex((h) => nomes.some((n) => h.includes(n)));
    const iCom = col('data com', 'última data com');
    const iPag = col('data de pagamento');
    const iVal = col('valor');
    const iTipo = col('tipo');
    // "Data" sozinha é a data-com na página de ações; só vale se não houver outra.
    const iComAcao = iCom >= 0 ? iCom : cabecalho.findIndex((h) => h === 'data');
    if (iComAcao < 0 || iPag < 0 || iVal < 0) {
        return { eventos: [], rotulo: null, motivo: `layout inesperado: [${cabecalho.join(' | ')}]` };
    }

    const eventos = [];
    tabela.find('tbody tr').each((_, tr) => {
        const tds = $(tr).find('td').map((__, td) => $(td).text().trim()).get();
        const dataCom = parseDataBr(tds[iComAcao]);
        if (!dataCom) return;
        eventos.push({
            dataCom,
            dataPagamento: parseDataBr(tds[iPag]),
            valor: parseValorBr(tds[iVal]),
            rotulo: iTipo >= 0 ? tds[iTipo] : '',
            isin: null,
        });
    });
    return { eventos, rotulo: `${eventos.length} linhas` };
};

const FONTE = {
    b3: { nome: 'B3', buscar: fonteB3, pausaMs: 350 },
    fundamentus: { nome: 'Fundamentus', buscar: fonteFundamentus, pausaMs: 700 },
};

// ————————————————————————————————————————————————— casamento

/**
 * Casa um evento nosso (ex-date do Yahoo) com o que a fonte publica (data-com).
 * Devolve o desfecho, e não só a data: a auditoria precisa distinguir "a fonte
 * não conhece este pagamento" de "a fonte conhece mas publica DUAS datas para
 * ele" — só o primeiro caso é falta de cobertura; o segundo é ambiguidade, e
 * importar qualquer uma das datas ali seria inventar precisão.
 */
const casar = (nosso, eventosFonte) => {
    const alvo = nosso.date.getTime();
    // Candidatos pela data: comparando a ex-date com data-com e com data-com + 1
    // dia útil, o que for mais perto. O histograma do deslocamento sai daqui.
    const proximos = eventosFonte.filter((e) => {
        if (!e.dataCom) return false;
        const dCom = Math.abs(alvo - e.dataCom.getTime());
        const dEx = Math.abs(alvo - addBusinessDays(e.dataCom, 1).getTime());
        return Math.min(dCom, dEx) <= TOLERANCIA_DIAS * DIA_MS;
    });
    if (proximos.length === 0) return { desfecho: 'SEM_EVENTO' };

    const bate = (v) => v != null && nosso.amount > 0 && Math.abs(v - nosso.amount) / nosso.amount <= TOLERANCIA_VALOR;

    // 1) um único pagamento com o mesmo valor — o caso limpo.
    const exatos = proximos.filter((e) => bate(e.valor));
    if (exatos.length === 1 && exatos[0].dataPagamento) {
        return { desfecho: 'CASADO', evento: exatos[0], offsetDias: Math.round((alvo - exatos[0].dataCom.getTime()) / DIA_MS) };
    }
    if (exatos.length === 1) return { desfecho: 'SEM_DATA', evento: exatos[0] };

    // 2) vários pagamentos com o mesmo valor na mesma data-com: só é ambíguo se
    //    as datas de pagamento divergirem. Iguais, a resposta é única.
    const datasExatas = new Set(exatos.map((e) => toDateKey(e.dataPagamento)).filter(Boolean));
    if (exatos.length > 1 && datasExatas.size === 1) {
        return { desfecho: 'CASADO', evento: exatos[0], offsetDias: Math.round((alvo - exatos[0].dataCom.getTime()) / DIA_MS) };
    }
    if (exatos.length > 1) return { desfecho: 'AMBIGUO', datas: [...datasExatas] };

    // 3) nenhum valor isolado bate: o Yahoo AGREGA numa linha só um SUBCONJUNTO do
    //    que a fonte publica naquela data-com. Medido em 09/09/2026: CMIG4 em
    //    26/12/2025 é a soma de 2 dos 3 JCP publicados, e SHUL4 em 29/12/2025 é a
    //    soma de 3 dos 4. Testar só a soma TOTAL classificava esses casos como
    //    "valor divergente" e cobrava da fonte um buraco que era nosso.
    //
    //    Duas travas contra achar subconjunto por acaso: tolerância apertada (1%,
    //    não os 5% do casamento simples) e unicidade — se dois subconjuntos
    //    diferentes somam o mesmo valor, o casamento não decide nada e a resposta
    //    honesta é não casar.
    const bateApertado = (v) => v != null && nosso.amount > 0 && Math.abs(v - nosso.amount) / nosso.amount <= 0.01;
    const comValor = proximos.filter((e) => e.valor > 0);
    if (comValor.length > 0 && comValor.length <= 10) {
        const achados = [];
        for (let mask = 1; mask < (1 << comValor.length); mask += 1) {
            let soma = 0;
            const membros = [];
            for (let k = 0; k < comValor.length; k += 1) {
                if (mask & (1 << k)) { soma += comValor[k].valor; membros.push(comValor[k]); }
            }
            if (bateApertado(soma)) achados.push(membros);
        }
        // Subconjuntos com o MESMO conjunto de datas de pagamento são a mesma
        // resposta: contam como um só.
        const assinatura = (m) => [...new Set(m.map((e) => toDateKey(e.dataPagamento)))].sort().join('|');
        const distintos = new Map(achados.map((m) => [assinatura(m), m]));
        if (distintos.size === 1) {
            const membros = [...distintos.values()][0];
            const datas = [...new Set(membros.map((e) => toDateKey(e.dataPagamento)).filter(Boolean))];
            if (datas.length === 1 && membros.length && membros[0].dataCom) {
                const comData = membros.find((e) => e.dataPagamento);
                return { desfecho: 'CASADO', evento: comData, agregado: membros.length > 1, offsetDias: Math.round((alvo - comData.dataCom.getTime()) / DIA_MS) };
            }
            return { desfecho: 'AMBIGUO', datas };
        }
        if (distintos.size > 1) {
            return { desfecho: 'AMBIGUO', datas: [...distintos.keys()] };
        }
    }

    return { desfecho: 'VALOR_DIVERGENTE', candidatos: proximos.map((e) => e.valor) };
};

// ————————————————————————————————————————————————— relatório

const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');

const novoPlacar = () => ({ total: 0, CASADO: 0, AMBIGUO: 0, SEM_EVENTO: 0, SEM_DATA: 0, VALOR_DIVERGENTE: 0 });

/**
 * Procedência do NOSSO evento. Ela muda o que significa "valor não bate": o
 * provento provisório (`DERIVED`) tem o valor DEDUZIDO do gap do dia-ex, então
 * é aproximado por construção e não deveria ser cobrado de bater com o centavo
 * da fonte. Sem separar os dois, uma limitação conhecida nossa é contabilizada
 * como buraco da fonte.
 */
const procedencia = (ev) => (ev.source === 'DERIVED' ? 'DERIVED' : 'PROVIDER');

const run = async () => {
    await connectScriptDb({ label: 'audit-dividend-payment-sources' });

    const desde = new Date(Date.now() - MESES * 30.44 * DIA_MS);

    // Universo: os tickers com mais eventos recentes, mais TUDO que algum usuário
    // tem em carteira — é lá que a data errada aparece na tela.
    const emCarteira = (await UserAsset.distinct('ticker')).map((t) => String(t).toUpperCase());
    const porTicker = await DividendEvent.aggregate([
        { $match: { date: { $gte: desde } } },
        { $group: { _id: '$ticker', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
    ]);

    // Classe do ativo: sem ela não dá para escolher o endpoint certo da B3, e é
    // ela que restringe o universo ao que estas fontes cobrem — ação e FII da B3.
    // Sem esse corte a amostra se enche de STOCK_US, que nenhuma delas conhece, e
    // a cobertura sai diluída por ativos que jamais estiveram em disputa.
    const ativosBr = await MarketAsset.find({ type: { $in: ['STOCK', 'FII'] } }).select('ticker type').lean();
    const tipoPorTicker = new Map(ativosBr.map((a) => [a.ticker.toUpperCase(), a.type]));

    let tickers;
    if (ALVO) {
        tickers = ALVO;
    } else {
        const candidatos = porTicker.map((t) => t._id).filter((t) => tipoPorTicker.has(t));
        const prioritarios = candidatos.filter((t) => emCarteira.includes(t));
        const resto = candidatos.filter((t) => !emCarteira.includes(t));
        tickers = [...new Set([...prioritarios, ...resto])].slice(0, LIMITE);
    }

    console.log('\n═══ AUDITORIA DE FONTES DE DATA DE PAGAMENTO ═══');
    console.log(`Janela: últimos ${MESES} meses (desde ${toDateKey(desde)})`);
    console.log(`Tickers: ${tickers.length}${ALVO ? ' (alvo explícito)' : ` (top ${LIMITE} por volume de eventos + carteira)`}`);
    console.log(`Fontes: ${FONTES.join(', ')}\n`);

    const placar = {};      // fonte -> classe -> placar
    const amostraRuim = {}; // fonte -> exemplos de VALOR_DIVERGENTE / AMBIGUO
    const offsets = {};     // fonte -> {offsetDias: n}
    const errosEstimativa = []; // dias entre a estimativa ex+15 e a data real
    const profundidade = {}; // fonte -> [{ticker, eventos, maisAntigo}]
    const falhas = {};      // fonte -> [{ticker, motivo}]
    const divergencias = []; // mesma linha datada por B3 e Fundamentus com datas diferentes
    const jaConhecido = { conferidos: 0, iguais: 0 }; // fonte × paymentDate que já temos

    for (const f of FONTES) { placar[f] = {}; offsets[f] = {}; profundidade[f] = []; falhas[f] = []; amostraRuim[f] = []; }

    let i = 0;
    for (const ticker of tickers) {
        i += 1;
        const tipo = tipoPorTicker.get(ticker) || (/\d{2}$/.test(ticker) ? 'FII' : 'STOCK');
        if (['CRYPTO', 'FIXED_INCOME', 'CASH', 'STOCK_US', 'ETF'].includes(tipo)) {
            process.stdout.write(`[${String(i).padStart(3)}/${tickers.length}] ${ticker.padEnd(8)} ${tipo} — fora do escopo BR, pulado\n`);
            continue;
        }

        const nossos = await DividendEvent.find({ ticker, date: { $gte: desde } }).sort({ date: -1 }).lean();
        if (nossos.length === 0) continue;

        const linha = [`[${String(i).padStart(3)}/${tickers.length}] ${ticker.padEnd(8)} ${String(tipo).padEnd(5)} ${String(nossos.length).padStart(3)} ev`];
        const casadosPorFonte = {};

        for (const f of FONTES) {
            const cfg = FONTE[f];
            if (!cfg) continue;
            let resultado = null;
            try {
                resultado = await cfg.buscar(ticker, tipo);
                await pausa(cfg.pausaMs);
            } catch (e) {
                falhas[f].push({ ticker, motivo: e.message });
                linha.push(`${cfg.nome}:ERRO(${e.message})`);
                continue;
            }
            if (resultado.motivo) falhas[f].push({ ticker, motivo: resultado.motivo });

            const eventosFonte = resultado.eventos || [];
            const maisAntigo = eventosFonte.reduce((min, e) => (e.dataCom && (!min || e.dataCom < min) ? e.dataCom : min), null);
            profundidade[f].push({ ticker, eventos: eventosFonte.length, maisAntigo });

            casadosPorFonte[f] = new Map();

            for (const nosso of nossos) {
                const chave = `${tipo}/${procedencia(nosso)}`;
                placar[f][chave] = placar[f][chave] || novoPlacar();
                const p = placar[f][chave];
                p.total += 1;
                const r = casar(nosso, eventosFonte);
                p[r.desfecho] += 1;
                if (r.desfecho === 'CASADO') {
                    offsets[f][r.offsetDias] = (offsets[f][r.offsetDias] || 0) + 1;
                    casadosPorFonte[f].set(String(nosso._id), r.evento.dataPagamento);
                    const estimada = estimatedPaymentDate(nosso.date);
                    errosEstimativa.push(Math.round((estimada.getTime() - r.evento.dataPagamento.getTime()) / DIA_MS));
                    if (nosso.paymentDate) {
                        jaConhecido.conferidos += 1;
                        if (toDateKey(nosso.paymentDate) === toDateKey(r.evento.dataPagamento)) jaConhecido.iguais += 1;
                    }
                } else if (r.desfecho === 'VALOR_DIVERGENTE' && amostraRuim[f].length < 12) {
                    amostraRuim[f].push(`${ticker} ex=${toDateKey(nosso.date)} nosso=${nosso.amount} fonte=[${r.candidatos.join(', ')}]`);
                } else if (r.desfecho === 'AMBIGUO' && amostraRuim[f].length < 12) {
                    amostraRuim[f].push(`${ticker} ex=${toDateKey(nosso.date)} nosso=${nosso.amount} AMBÍGUO → datas [${r.datas.join(', ')}]`);
                }
            }
            linha.push(`${cfg.nome}:${casadosPorFonte[f].size}/${nossos.length}`);
        }

        // Onde as duas fontes datam o MESMO evento, elas concordam?
        if (casadosPorFonte.b3 && casadosPorFonte.fundamentus) {
            for (const [id, dataB3] of casadosPorFonte.b3) {
                const dataFu = casadosPorFonte.fundamentus.get(id);
                if (dataFu && toDateKey(dataB3) !== toDateKey(dataFu)) {
                    divergencias.push({ ticker, b3: toDateKey(dataB3), fundamentus: toDateKey(dataFu) });
                }
            }
        }

        console.log(linha.join('  '));
    }

    // ——— cobertura
    console.log('\n───────────── COBERTURA (eventos nossos que a fonte consegue datar)');
    for (const f of FONTES) {
        console.log(`\n  ${FONTE[f]?.nome || f}`);
        const classes = Object.keys(placar[f]);
        if (!classes.length) { console.log('    (nenhum evento medido)'); continue; }
        let g = novoPlacar();
        const linhaPlacar = (rotulo, p) => `    ${rotulo.padEnd(15)} ${String(p.total).padStart(4)} eventos → datados ${String(p.CASADO).padStart(4)} (${pct(p.CASADO, p.total)})  ambíguos ${p.AMBIGUO}  fonte não tem ${p.SEM_EVENTO}  sem data ${p.SEM_DATA}  valor divergente ${p.VALOR_DIVERGENTE}`;
        for (const c of classes.sort()) {
            const p = placar[f][c];
            for (const k of Object.keys(g)) g[k] += p[k];
            console.log(linhaPlacar(c, p));
        }
        console.log(linhaPlacar('TOTAL', g));
        // O que a fonte entrega no que ELA é cobrada: só os eventos oficiais, cujo
        // valor é o da fonte de proventos e não uma dedução nossa.
        const soProvider = classes.filter((c) => c.endsWith('/PROVIDER')).reduce((acc, c) => {
            for (const k of Object.keys(acc)) acc[k] += placar[f][c][k];
            return acc;
        }, novoPlacar());
        if (soProvider.total) console.log(linhaPlacar('só PROVIDER', soProvider));
    }

    // ——— o que impede o casamento
    console.log('\n───────────── ONDE O CASAMENTO FALHA (amostra do que NÃO vira data)');
    for (const f of FONTES) {
        const ex = amostraRuim[f];
        console.log(`  ${FONTE[f]?.nome || f}:${ex.length ? '' : ' —'}`);
        for (const l of ex) console.log(`    ${l}`);
    }

    // ——— alinhamento
    console.log('\n───────────── ALINHAMENTO (ex-date do Yahoo − data-com da fonte, em dias corridos)');
    for (const f of FONTES) {
        const h = offsets[f];
        const linhas = Object.entries(h).sort((a, b) => Number(a[0]) - Number(b[0]));
        if (!linhas.length) { console.log(`  ${FONTE[f]?.nome || f}: —`); continue; }
        const tot = linhas.reduce((s, [, n]) => s + n, 0);
        console.log(`  ${FONTE[f]?.nome || f}: ${linhas.map(([d, n]) => `${d >= 0 ? '+' : ''}${d}d:${n} (${pct(n, tot)})`).join('  ')}`);
    }

    // ——— erro da estimativa atual
    if (errosEstimativa.length) {
        const ord = [...errosEstimativa].sort((a, b) => a - b);
        const p50 = ord[Math.floor(ord.length * 0.5)];
        const p90 = ord[Math.floor(ord.length * 0.9)];
        const medioAbs = (ord.reduce((s, d) => s + Math.abs(d), 0) / ord.length).toFixed(1);
        const acertos = ord.filter((d) => d === 0).length;
        const dentro3 = ord.filter((d) => Math.abs(d) <= 3).length;
        console.log('\n───────────── ERRO DA ESTIMATIVA ATUAL (ex-date + 15 dias corridos, contra a data real)');
        console.log(`  amostras ${ord.length}  ·  acerto exato ${acertos} (${pct(acertos, ord.length)})  ·  dentro de ±3 dias ${dentro3} (${pct(dentro3, ord.length)})`);
        console.log(`  erro absoluto médio ${medioAbs} dias  ·  mediana ${p50 >= 0 ? '+' : ''}${p50}d  ·  p90 ${p90 >= 0 ? '+' : ''}${p90}d  ·  pior ${ord[0]}d / ${ord[ord.length - 1]}d`);
        console.log('  (positivo = a estimativa cai DEPOIS do pagamento real: o dinheiro já caiu e a tela ainda promete)');
    }

    // ——— o que já está gravado é dado ou é chute?
    // Um paymentDate só merece o selo "Agendado" da tela se tiver vindo de fonte.
    // Data real de pagamento VARIA: FII paga 7-10 dias depois, empresa paga meses
    // depois, e o calendário desvia de feriado. Um lag CONSTANTE em toda a coleção
    // é a assinatura de uma estimativa gravada como se fosse anúncio.
    const gravados = await DividendEvent.find({ paymentDate: { $ne: null } }).select('date paymentDate').lean();
    if (gravados.length) {
        const hist = {};
        for (const e of gravados) {
            const d = Math.round((new Date(e.paymentDate).getTime() - new Date(e.date).getTime()) / DIA_MS);
            hist[d] = (hist[d] || 0) + 1;
        }
        const linhas = Object.entries(hist).sort((a, b) => b[1] - a[1]);
        const [lagDominante, freq] = linhas[0];
        console.log('\n───────────── O QUE JÁ ESTÁ GRAVADO É DADO OU É CHUTE?');
        console.log(`  ${gravados.length} eventos têm paymentDate. Distribuição de (pagamento − ex-date):`);
        console.log(`  ${linhas.slice(0, 12).map(([d, n]) => `${d >= 0 ? '+' : ''}${d}d:${n}`).join('  ')}${linhas.length > 12 ? `  … +${linhas.length - 12} valores` : ''}`);
        if (freq / gravados.length >= 0.95) {
            console.log(`  ⛔ ${pct(freq, gravados.length)} têm o MESMO lag (${lagDominante}d). Data real não se comporta assim:`);
            console.log('     isto é estimativa gravada como se fosse anúncio, e a tela a exibe com selo de oficial.');
        }
        if (jaConhecido.conferidos) {
            console.log(`  Conferência contra a fonte: ${jaConhecido.iguais}/${jaConhecido.conferidos} (${pct(jaConhecido.iguais, jaConhecido.conferidos)}) batem com a data publicada.`);
        }
    }

    // ——— divergência entre fontes
    console.log('\n───────────── DIVERGÊNCIA ENTRE B3 E FUNDAMENTUS (mesmo evento, datas diferentes)');
    console.log(divergencias.length === 0
        ? '  nenhuma — onde as duas datam o mesmo evento, elas concordam'
        : divergencias.slice(0, 20).map((d) => `  ${d.ticker}: B3 ${d.b3} × Fundamentus ${d.fundamentus}`).join('\n'));
    if (divergencias.length > 20) console.log(`  ... e mais ${divergencias.length - 20}`);

    // ——— profundidade
    console.log('\n───────────── PROFUNDIDADE DO HISTÓRICO (quanto a fonte guarda por ativo)');
    for (const f of FONTES) {
        const ps = profundidade[f].filter((p) => p.eventos > 0);
        if (!ps.length) { console.log(`  ${FONTE[f]?.nome || f}: —`); continue; }
        const med = Math.round(ps.reduce((s, p) => s + p.eventos, 0) / ps.length);
        const antigos = ps.map((p) => p.maisAntigo).filter(Boolean).sort((a, b) => a - b);
        console.log(`  ${FONTE[f]?.nome || f}: ${ps.length} ativos respondem  ·  mediana ${med} eventos/ativo  ·  evento mais antigo visto: ${antigos[0] ? toDateKey(antigos[0]) : '—'}`);
    }

    // ——— falhas
    console.log('\n───────────── FALHAS DE ACESSO');
    for (const f of FONTES) {
        const fs = falhas[f];
        if (!fs.length) { console.log(`  ${FONTE[f]?.nome || f}: nenhuma`); continue; }
        const porMotivo = {};
        for (const x of fs) porMotivo[x.motivo] = (porMotivo[x.motivo] || 0) + 1;
        console.log(`  ${FONTE[f]?.nome || f}: ${fs.length} ativo(s) — ${Object.entries(porMotivo).map(([m, n]) => `${m} (${n})`).join('; ')}`);
    }

    console.log('\nNada foi escrito no banco.\n');
    await mongoose.disconnect();
};

run().catch(async (e) => {
    console.error('Auditoria falhou:', e);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
