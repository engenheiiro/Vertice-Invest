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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { connectScriptDb } = await import('./lib/scriptDb.js');
const DividendEvent = (await import('../models/DividendEvent.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const { toDateKey } = await import('../utils/dateUtils.js');
const { estimatedPaymentDate } = await import('../utils/dividendPaymentDate.js');
const { matchPaymentDate } = await import('../utils/dividendPaymentMatch.js');
const { FONTES: CLIENTES } = await import('../services/dividendPaymentDateService.js');

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

const DIA_MS = 86400000;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Os clientes HTTP vivem no SERVIÇO, não aqui: a auditoria tem de medir o mesmo
// código que a ingestão executa. Uma cópia local do raspador mediria uma fonte
// que o produto não usa — que é o jeito mais discreto de a medição mentir.
const FONTE = {
    b3: { nome: 'B3', buscar: CLIENTES.B3.buscar, pausaMs: 350 },
    fundamentus: { nome: 'Fundamentus', buscar: CLIENTES.FUNDAMENTUS.buscar, pausaMs: 700 },
};

// ————————————————————————————————————————————————— casamento

// A regra vive em utils/dividendPaymentMatch.js, a MESMA que a ingestão usa. Ela
// nasceu aqui, mas duplicá-la faria a auditoria medir uma régua diferente da que
// o produto aplica — e o número deixaria de dizer o que promete dizer.
const casar = (nosso, eventosFonte) => matchPaymentDate(nosso, eventosFonte, {
    // Provento provisório tem o valor deduzido do gap do dia-ex: aproximado por
    // construção. Mesma exceção da ingestão.
    permitirSoData: nosso.source === 'DERIVED',
});

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
                resultado = { eventos: await cfg.buscar(ticker, tipo) };
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
                    casadosPorFonte[f].set(String(nosso._id), r.dataPagamento);
                    const estimada = estimatedPaymentDate(nosso.date);
                    errosEstimativa.push(Math.round((estimada.getTime() - r.dataPagamento.getTime()) / DIA_MS));
                    if (nosso.paymentDate) {
                        jaConhecido.conferidos += 1;
                        if (toDateKey(nosso.paymentDate) === toDateKey(r.dataPagamento)) jaConhecido.iguais += 1;
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
