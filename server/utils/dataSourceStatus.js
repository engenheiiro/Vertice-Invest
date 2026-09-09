/**
 * VEREDITO POR FONTE — "de onde vem o dado e está chegando?".
 *
 * Junta duas evidências que, sozinhas, mentem em direções opostas:
 *
 *  1. **Conectividade** (`utils/sourceHealth.js`): a chamada foi e voltou? Vive na
 *     memória do processo, então zera a cada reinício e não sabe nada de ontem.
 *  2. **Frescor do dado** (fatos persistidos: `currenciesUpdatedAt`,
 *     `ratesUpdatedAt`, data do último PU do Tesouro…): o dado chegou ao banco?
 *     Sobrevive a reinício, mas não distingue "a fonte respondeu" de "a reserva
 *     cobriu por ela".
 *
 * Precisa das duas. Em 04/09/2026 o Yahoo respondia normalmente para cotações e
 * índices e falhava SÓ no câmbio, no mesmo processo e no mesmo minuto: só a
 * evidência 1 separa isso. E no mesmo dia o câmbio ficou 24h congelado com o cron
 * reportando sucesso: só a evidência 2 pega aquilo.
 *
 * Regra de precedência: **falha observada vence silêncio**. Uma fonte que
 * respondeu errado agora é pior notícia que uma que ninguém chamou ainda.
 */

import { cadenceLabel, nextRunLabel } from './sourceSchedule.js';
import { LEDGERED_CHAINS } from './sourceHealth.js';

export const SOURCE_STATUS = { OK: 'OK', WARN: 'WARN', CRITICAL: 'CRITICAL', UNKNOWN: 'UNKNOWN' };

/**
 * Fração de falhas a partir da qual a fonte deixa de ser confiável.
 *
 * Não é zero de propósito: toda integração de rede erra de vez em quando, e um
 * painel que fica amarelo por uma falha isolada em cem chamadas é um painel que
 * se aprende a ignorar. Metade das chamadas falhando é degradação real; um terço
 * já merece o olho.
 */
export const FAILURE_RATE = { warn: 0.34, critical: 0.5 };

/** Mínimo de tentativas antes de julgar taxa — 1 falha em 1 chamada não é tendência. */
const MIN_ATTEMPTS = 3;

const hoursSince = (date, now) => {
    if (!date) return null;
    const ms = new Date(now).getTime() - new Date(date).getTime();
    return Number.isFinite(ms) ? ms / 3600000 : null;
};

const pct = (value) => `${Math.round(value * 100)}%`;

/**
 * Frescor persistido por fonte. Cada entrada responde "quando o DADO desta fonte
 * chegou ao banco pela última vez".
 *
 * ── A CHAVE PRESENTE COM VALOR `null` É UMA AFIRMAÇÃO ───────────────────────
 *
 * Ela diz: *esta fonte tem carimbo de entrega, e hoje ela não é a origem do que
 * está gravado*. Não é o mesmo que a chave AUSENTE, que diz: *não sabemos medir
 * a entrega desta fonte* — o Yahoo de cotações não deixa carimbo por fonte no
 * `MarketAsset`, então dele só temos conectividade.
 *
 * A distinção existe porque as duas viravam a mesma coisa na tela. O card da
 * PTAX em 07/09/2026 anunciava "ÚLTIMA ENTREGA 12:20" logo abaixo de "0 moedas
 * resolvidas por esta fonte": aquele 12:20 era o `lastOkAt` — a última chamada
 * que voltou —, usado como substituto quando não havia carimbo de entrega. O
 * painel creditava à fonte uma entrega que não houve, que é o oposto do que ele
 * existe para fazer.
 */
const deliveryFacts = (facts) => {
    const macro = facts.macro || {};
    const currencySources = macro.currenciesSources || {};
    const rateSources = macro.ratesSources || {};
    const indexSources = macro.indicesSources || {};
    const price = facts.priceDelivery || {};

    // Uma fonte de câmbio "entregou" se ela é a origem gravada de alguma moeda.
    const currencyDelivery = (nome) => (
        currencySources.usd === nome || currencySources.btc === nome
            ? macro.currenciesUpdatedAt || null
            : null
    );

    // Mesma regra para índice: entregou quem está gravado como origem do valor.
    const indexDelivery = (nome) => (
        indexSources.ibov === nome || indexSources.spx === nome
            ? macro.indicesUpdatedAt || null
            : null
    );

    // E para cotação: quem escreveu `lastPrice` em algum ativo vivo. O `priceSource`
    // do ativo é o registro, e ele sobrevive ao reinício — que é a diferença
    // inteira entre este relógio e o contador de chamadas do processo.
    const priceDelivery = (fonte) => price[fonte]?.at || null;

    return {
        // A cadeia de cotação, lida do banco. `YAHOO` é o rótulo histórico do
        // caminho principal (`quote.source || 'YAHOO'` em marketDataService).
        'yahoo.quotes': priceDelivery('YAHOO'),
        'yahoo.chart': priceDelivery('YAHOO_CHART_FALLBACK'),
        'google.finance': priceDelivery('GOOGLE_FINANCE_FALLBACK'),
        brapi: priceDelivery('BRAPI_FALLBACK'),
        'yahoo.currencies': currencyDelivery('Yahoo'),
        coinbase: currencyDelivery('Coinbase'),
        ptax: currencyDelivery('PTAX/BCB'),
        // Nome distinto do elo acima de propósito: os dois são Coinbase, e um
        // rótulo compartilhado creditaria a entrega ao card errado.
        'coinbase.rates': currencyDelivery('Coinbase (taxas)'),
        'bcb.series': rateSources.selic === 'BCB' || rateSources.ipca === 'BCB'
            ? macro.ratesUpdatedAt || null : null,
        brasilapi: rateSources.selic === 'BrasilAPI' || rateSources.ipca === 'BrasilAPI'
            ? macro.ratesUpdatedAt || null : null,
        ibge: rateSources.ipca === 'IBGE' ? macro.ratesUpdatedAt || null : null,
        // Era `macro.updatedAt`, o carimbo do DOCUMENTO inteiro: ele avança a cada
        // run do macro-sync mesmo quando o índice não veio, então o card exibia
        // "recebeu há 6 min" ao lado de "SEM RECEBER" (09/09/2026). Agora responde
        // pelo índice, e só quando o índice foi de fato gravado por esta fonte.
        'yahoo.indices': indexDelivery('Yahoo'),
        'yahoo.indices.chart': indexDelivery('Yahoo (candle)'),
        tesouro: facts.treasury?.latestDate || null,
        fundamentus: facts.fundamentals?.timestamp || null,
    };
};

/**
 * @param {object} facts fatos coletados (`collectFacts`)
 * @param {Array} sourceStats saída de `getSourceStats()`
 * @returns {Array} uma linha por fonte, pronta para a tela
 */
/**
 * Quem cobre quem, dentro de cada cadeia.
 *
 * É a informação que faltava para responder a pergunta seguinte à do painel:
 * "essa fonte caiu — e agora?". Devolve, para cada id: as fontes que entram
 * DEPOIS dela (na ordem em que serão tentadas) e a principal que ela cobre.
 *
 * Fonte sem `chain` fica com as duas listas vazias, e isso é informação de
 * primeira ordem: significa PONTO ÚNICO DE FALHA. Tesouro, Fundamentus e o
 * histórico do Yahoo estão nessa condição hoje — se caírem, não há reserva, e o
 * painel precisa dizer isso em vez de deixar o silêncio parecer cobertura.
 */
export const buildChainMap = (sourceStats = []) => {
    const porCadeia = new Map();
    for (const s of sourceStats) {
        if (!s.chain) continue;
        if (!porCadeia.has(s.chain)) porCadeia.set(s.chain, []);
        porCadeia.get(s.chain).push(s);
    }

    const mapa = new Map();
    for (const [chain, membros] of porCadeia) {
        // A ordem do catálogo É a ordem de tentativa — ver SOURCE_CATALOG.
        const principal = membros.find((m) => m.schedule?.kind !== 'onFailure') || membros[0];
        membros.forEach((m, i) => {
            mapa.set(m.id, {
                chain,
                // 1-based: a tela numera "1ª, 2ª, 3ª" a partir daqui em vez de
                // recontar a lista, que é o que fazia a ordem virar suposição.
                chainPosition: i + 1,
                chainSize: membros.length,
                backups: membros.slice(i + 1).map((b) => b.label),
                covers: m.id === principal?.id ? null : (principal?.label ?? null),
            });
        });
    }
    return mapa;
};


/**
 * Quantos assuntos a tela lista por cadeia. O RESUMO é sempre exato (contado
 * sobre o ledger inteiro); o que o teto corta é só a lista nominal — ninguém
 * varre 600 tickers na tela, e um payload que cresce sem limite é o começo de um
 * painel lento justamente no dia em que tudo está falhando.
 */
const ESCALATION_SAMPLE = 60;

/**
 * Teto da lista de cotações suspeitas. Menor que o das escaladas de propósito:
 * cada linha aqui carrega uma frase inteira ("+108% contra o fechamento anterior
 * da própria fonte…"), e sessenta delas é um paredão que ninguém lê. Se um dia
 * passar de quarenta, o problema não é de ativo — é da fonte, e a contagem total
 * já diz isso sem precisar da lista.
 */
const SUSPECT_SAMPLE = 40;

/**
 * COTAÇÕES SUSPEITAS, prontas para a tela.
 *
 * Irmã de `buildEscalationView`, para a outra pergunta: aquela responde "de onde
 * veio o preço"; esta, "o preço faz sentido?". Ficam em funções separadas porque
 * as duas listas não se cruzam — um ativo pode ter vindo pela fonte principal,
 * sem escalada nenhuma, e ainda assim trazer um número torto. É justamente esse
 * o caso perigoso: nada no caminho denuncia.
 *
 * O total é exato; a lista nominal tem teto, pela mesma razão do outro ledger.
 *
 * @param {Array} suspects saída de `getSuspectQuotes()`
 * @returns {{total: number, items: Array, truncated: number}}
 */
export const buildSuspectView = (suspects = []) => {
    const items = suspects.slice(0, SUSPECT_SAMPLE).map((s) => ({
        subject: s.subject,
        type: s.type ?? null,
        source: s.source ?? null,
        price: s.price ?? null,
        // Só os códigos e as frases: a tela não recalcula nada, e o veredito
        // continua sendo de quem julgou (utils/quoteSanity.js).
        findings: (s.findings || []).map((f) => ({
            code: f.code,
            detail: f.detail,
            movePct: f.movePct ?? null,
            /** Veredito da nossa série sobre quem estava errado; null = não desempatou. */
            arbitration: f.arbitration ?? null,
        })),
        /**
         * JÁ RESOLVIDO — e por isso não é pergunta em aberto.
         *
         * A lista misturava dois estados muito diferentes sob a mesma cor. Em
         * 07/09/2026, de sete linhas, duas (RBRL11 e STX) eram o momento em que
         * um preço ERRADO que estava guardado foi substituído pelo certo: nada a
         * investigar, o conserto já entrou na mesma gravação. Contá-las junto com
         * as outras cinco é como um alarme perde a credibilidade — o dono abre a
         * lista, vê sete, checa duas que já estavam resolvidas e para de abrir.
         */
        settled: (s.findings || []).some((f) => f.arbitration === 'NOVO_CONFIRMADO'),
        count: s.count ?? 1,
        at: s.at,
    }));
    return {
        total: suspects.length,
        // Contado sobre a AMOSTRA, que é o único conjunto de que temos os achados
        // — e a amostra é a lista inteira até 40 ativos. Acima disso a pergunta
        // deixou de ser sobre ativo e virou sobre a fonte, e o total já diz isso.
        settled: items.filter((i) => i.settled).length,
        items,
        truncated: Math.max(0, suspects.length - items.length),
    };
};

/**
 * DE ONDE CADA ATIVO VEIO — o cruzamento do ledger com as fontes.
 *
 * Duas saídas, com propósitos diferentes:
 *
 *  - `bySource`: contagem EXATA por fonte. Responde, no detalhe de cada card,
 *    "quantos ativos chegaram até aqui, quantos eu salvei, quantos passaram
 *    direto". `reached` inclui a própria principal que falhou — sem isso o card
 *    do Yahoo não teria como dizer em quantos ativos ele não entregou, que é a
 *    metade mais acionável do painel.
 *  - `chains`: o resumo da cadeia, que é o que cabe numa linha embaixo da
 *    sequência de cards: "6 ativos precisaram de reserva — 4 pelo Google, 2 pela
 *    Brapi, 1 sem preço em fonte nenhuma".
 *
 * `unresolved` é contado à parte porque é a única categoria com consequência
 * real: ativo que nenhuma fonte precificou fica com preço velho na carteira. Os
 * outros dois estados (recuperado por reserva, escalada conhecida) são o sistema
 * funcionando como projetado.
 */
export const buildEscalationView = (escalations = [], sourceStats = []) => {
    const rotulo = new Map(sourceStats.map((s) => [s.id, s.short || s.label]));
    const bySource = new Map();
    const chains = {};

    // Cadeia instrumentada começa vazia, não ausente: "nada escalou" é notícia
    // boa e precisa aparecer como tal. Cadeia sem ledger não entra de jeito
    // nenhum — ver LEDGERED_CHAINS.
    for (const [chain, vocabulario] of LEDGERED_CHAINS) {
        chains[chain] = {
            chain,
            total: 0,
            unresolved: 0,
            expected: 0,
            /**
             * Dos `unresolved`, quantos ninguém PODERIA ter resolvido.
             *
             * Papel que não negociou não tem fechamento em fonte alguma. Contado
             * junto, ele afogava o alarme: em 08/09/2026 a linha dizia "49 sem
             * fechamento em fonte nenhuma" em vermelho, e os 49 eram ilíquidos
             * num dia em que o arquivo da B3 estava publicado e perfeito. O que
             * sobra depois desta subtração é o conjunto com consequência.
             */
            unresolvedExpected: 0,
            byResolver: [],
            items: [],
            truncated: 0,
            /**
             * QUANDO foi a escalada mais recente desta cadeia.
             *
             * Sem ela a linha do painel é uma afirmação sem tempo — "43 ativos
             * precisaram de reserva" — cercada de cards que falam do agora
             * ("Recebendo · agora"). Um estouro de sete horas atrás lia-se como
             * estando acontecendo, e a única régua na tela ("desde o último
             * reinício") só aparecia no texto do estado VAZIO, que é justamente
             * o que ninguém precisa ler.
             *
             * Calculado aqui, e não pegando `items[0].at`: a lista é ordenada
             * por "sem resolver primeiro, depois mais recente", então o primeiro
             * item pode ser uma escalada antiga que ninguém resolveu.
             */
            lastAt: null,
            /**
             * O VOCABULÁRIO da cadeia — as frases prontas, escritas aqui e não na
             * tela. O painel nasceu falando só de cotações, então "ativo" e
             * "preço" estavam escritos no componente; com câmbio, indicadores e
             * fechamento medidos pelo mesmo mecanismo, a mesma frase passaria a
             * dizer "2 ativo(s) sem preço" para o dólar e o Bitcoin. Quem sabe o
             * nome das coisas é a cadeia.
             */
            vocabulary: { ...vocabulario },
        };
    }

    const porResolver = new Map();

    for (const ev of escalations) {
        const alvo = chains[ev.chain];
        if (!alvo) continue;
        alvo.total += 1;
        if (!ev.resolvedBy) alvo.unresolved += 1;
        if (ev.expected) alvo.expected += 1;
        if (!ev.resolvedBy && ev.expected) alvo.unresolvedExpected += 1;
        if (ev.at && (!alvo.lastAt || new Date(ev.at) > new Date(alvo.lastAt))) alvo.lastAt = ev.at;

        const chaveResolver = `${ev.chain}|${ev.resolvedBy || ''}`;
        porResolver.set(chaveResolver, (porResolver.get(chaveResolver) || 0) + 1);

        for (const id of ev.tried || []) {
            if (!bySource.has(id)) bySource.set(id, { reached: 0, rescued: 0, missed: 0, orphaned: 0 });
            const conta = bySource.get(id);
            conta.reached += 1;
            if (ev.resolvedBy === id) conta.rescued += 1;
            else conta.missed += 1;
            // `missed` junta duas coisas opostas: o assunto que a fonte SEGUINTE
            // salvou (aí a falha é desta fonte) e o que ninguém salvou (aí o que
            // faltou foi papel negociando). Separar é o que permite não acusar
            // uma reserva por ter sido chamada só para ticker morto.
            if (!ev.resolvedBy) conta.orphaned += 1;
        }
    }

    for (const [chave, count] of porResolver) {
        const [chain, id] = chave.split('|');
        if (!chains[chain]) continue;
        chains[chain].byResolver.push({ id: id || null, label: id ? (rotulo.get(id) || id) : null, count });
    }
    for (const chain of Object.values(chains)) {
        // Ordem da CADEIA (quem tenta primeiro aparece primeiro), com o "ninguém"
        // no fim — é a leitura natural da frase, e ordenar por contagem faria a
        // linha trocar de ordem a cada carregamento.
        const ordem = sourceStats.filter((s) => s.chain === chain.chain).map((s) => s.id);
        chain.byResolver.sort((a, b) => {
            if (!a.id) return 1;
            if (!b.id) return -1;
            return ordem.indexOf(a.id) - ordem.indexOf(b.id);
        });
    }

    // Não resolvido primeiro, depois o mais recente: o teto da lista corta o que
    // sobra, e o que sobra tem que ser o menos importante.
    //
    // Três pesos, não dois: entre "ninguém resolveu" e "a reserva resolveu" mora
    // a ausência ESPERADA, que ninguém tinha como resolver. Com dois pesos, 49
    // papéis sem pregão empurravam para fora da amostra justamente o ativo que
    // ficou sem fechamento por falha de fonte.
    const peso = (ev) => (ev.resolvedBy ? 2 : (ev.expected ? 1 : 0));
    const ordenados = [...escalations].sort((a, b) => {
        const pesoA = peso(a);
        const pesoB = peso(b);
        if (pesoA !== pesoB) return pesoA - pesoB;
        return new Date(b.at) - new Date(a.at);
    });
    for (const ev of ordenados) {
        const alvo = chains[ev.chain];
        if (!alvo) continue;
        if (alvo.items.length >= ESCALATION_SAMPLE) { alvo.truncated += 1; continue; }
        alvo.items.push({
            subject: ev.subject,
            tried: ev.tried,
            resolvedBy: ev.resolvedBy,
            reason: ev.reason,
            expected: ev.expected,
            count: ev.count,
            at: ev.at,
        });
    }

    return { bySource, chains };
};

export const buildSourceStatuses = (facts, sourceStats = [], escalations = []) => {
    const now = facts?.now || new Date();
    const delivery = deliveryFacts(facts || {});
    const cadeia = buildChainMap(sourceStats);
    const escalada = buildEscalationView(escalations, sourceStats);

    return sourceStats.map((source) => {
        // Sem substituto: entrega é entrega. Quando a fonte tem carimbo e ele veio
        // vazio, o vazio é o dado — ver deliveryFacts.
        const deliveryTracked = Object.prototype.hasOwnProperty.call(delivery, source.id);
        const lastDeliveryAt = deliveryTracked ? (delivery[source.id] || null) : null;
        const rate = source.failureRate;
        const julgavel = source.attempts >= MIN_ATTEMPTS && rate !== null;

        let status = SOURCE_STATUS.OK;
        let detail;
        /**
         * POR QUE ESTA FONTE ESTÁ QUIETA — decidido AQUI, nunca rededuzido na tela.
         *
         * O card mostrava "Sem alvo vivo" para a PTAX no feriado de 07/09/2026
         * enquanto o detalhe, no modal, dizia "não foi chamada: feriado". Duas
         * explicações para o mesmo card, porque a tela tinha uma cópia MAIS FROUXA
         * da regra do servidor: ela checava só `reached > 0`, e a regra de verdade
         * exige também que ninguém tenha resolvido aquele assunto
         * (`soAssuntoMorto`). O dólar tinha passado pela PTAX e sido resolvido pela
         * Coinbase logo depois — alvo bem vivo.
         *
         * Dois lugares decidindo o mesmo estado divergem; é a mesma lição da faixa
         * do modal, que já foi unificada com a cor do card. O servidor decide e
         * manda o código; a tela só escolhe a palavra curta do rodapé.
         */
        let idleReason = null;

        // Manual entra junto com a reserva: nenhuma das duas tem hora marcada, e
        // o silêncio de ambas é estado normal, não atraso. A diferença — "ninguém
        // precisou" contra "ninguém clicou" — está em `cadenceLabel`.
        const deReserva = source.schedule?.kind === 'onFailure' || source.schedule?.kind === 'manual';
        // A última tentativa terminou em falha? É o estado CORRENTE da fonte, e
        // vale mais que a média: uma fonte que roda duas vezes por dia levaria
        // dias para a taxa acusar algo, enquanto "a última chamada falhou" é
        // exatamente o que se quer ver no painel no momento em que acontece.
        const ultimaFalhou = !!source.lastFailAt
            && (!source.lastOkAt || new Date(source.lastFailAt) > new Date(source.lastOkAt));

        /**
         * RESERVA CHAMADA SÓ PARA ASSUNTO MORTO NÃO É RESERVA QUEBRADA.
         *
         * A taxa de falha de uma fonte `onFailure` mede a POPULAÇÃO que chega até
         * ela, não a fonte: por construção, só lhe perguntam o que a anterior já
         * não conseguiu — uma amostra enriquecida de ticker extinto. Em 05/09/2026
         * o candle do Yahoo aparecia como "INSTÁVEL · 100% das 3 chamadas
         * falharam" enquanto respondia normalmente para o resto do mercado; as
         * três chamadas tinham sido para AVB, EQR e EA, que haviam saído da bolsa
         * (fusão em VMRK e fechamento de capital). Card vermelho permanente por
         * um defeito que não era dela — o alarme falso que este módulo existe
         * para evitar.
         *
         * O ledger por assunto é quem desempata, e só ele consegue: se NENHUM dos
         * assuntos que passaram por aqui foi precificado por fonte alguma, o que
         * faltou foi papel negociando. Basta um assunto que a fonte seguinte tenha
         * salvado para a suspeita voltar a ser legítima — aí uma peça da cadeia
         * conseguiu onde esta falhou, e isso é sobre a fonte.
         */
        const led = escalada.bySource.get(source.id) || null;
        const soAssuntoMorto = deReserva
            && !!led
            && led.reached > 0
            && led.rescued === 0
            && led.orphaned === led.reached;

        if (source.attempts === 0) {
            // Silêncio não é falha. Uma fonte que só roda no sync diário fica sem
            // chamada nenhuma por horas depois de um deploy, e marcá-la de vermelho
            // aí é o alarme falso que ensina o operador a ignorar o painel.
            status = SOURCE_STATUS.UNKNOWN;
            if (source.skipped > 0 && source.lastSkipReason) {
                // ANTES do ramo de reserva, e não depois: a PTAX é `onFailure`, então
                // ela cairia em "a fonte anterior deu conta" — frase falsa num dia em
                // que o Yahoo falhou e ela deixou de ser chamada por decisão nossa.
                // Quem pulou fomos nós, e a razão é mais informativa que o silêncio.
                detail = source.lastSkipReason;
                idleReason = 'SKIPPED';
            } else if (source.schedule?.kind === 'manual') {
                // Manual entra ANTES do ramo de reserva: as duas ficam cinza pelo
                // mesmo motivo aparente, mas por causas opostas. Dizer "a fonte
                // anterior deu conta" numa fonte que só roda por clique inventaria
                // um fallback que nunca aconteceu.
                detail = 'Nenhuma chamada porque ninguém disparou — esta fonte roda por botão no Admin, não por agendamento';
                idleReason = 'STANDBY';
            } else if (deReserva) {
                // Aqui o cinza é BOA notícia: a cadeia não precisou da reserva.
                detail = 'Nenhuma chamada porque a fonte anterior da cadeia deu conta — é o esperado';
                idleReason = 'STANDBY';
            } else if (lastDeliveryAt) {
                // Entrega gravada ANTES do reinício. Dizer só "sem chamadas" ao lado
                // de "há 12 min" faz a linha se contradizer na tela; o que aconteceu
                // é que o dado dela está no banco e o processo atual ainda não a usou.
                detail = 'Entregou antes do último reinício; ainda sem novas chamadas neste processo';
                idleReason = 'DELIVERED_BEFORE_RESTART';
            } else {
                detail = 'Ainda não teve a vez dela desde o reinício do servidor';
                idleReason = 'NOT_YET';
            }
        } else if (soAssuntoMorto) {
            // Antes de qualquer régua de taxa: ela não se aplica a esta amostra.
            status = SOURCE_STATUS.UNKNOWN;
            idleReason = 'NO_LIVE_SUBJECT';
            const vocab = LEDGERED_CHAINS.get(source.chain);
            const morto = vocab?.deadSubject || 'que nenhuma fonte resolveu';
            detail = led.reached === 1
                ? `A única chamada foi para um ${vocab?.noun || 'assunto'} ${morto}, não resposta desta fonte`
                : `As ${source.attempts} chamadas foram para ${led.reached} ${vocab?.noun || 'assunto'}(s) ${morto}, não resposta desta fonte`;
        } else if (julgavel && rate >= FAILURE_RATE.critical) {
            status = source.critical ? SOURCE_STATUS.CRITICAL : SOURCE_STATUS.WARN;
            detail = `${pct(rate)} das ${source.attempts} chamadas falharam`;
        } else if (julgavel && rate >= FAILURE_RATE.warn) {
            status = SOURCE_STATUS.WARN;
            detail = `${pct(rate)} das ${source.attempts} chamadas falharam`;
        } else if (source.ok === 0) {
            // Rodou e não trouxe nada, nem uma vez. Ainda não é tendência
            // estatística, mas não há uma única entrega para chamar de saudável.
            status = source.critical ? SOURCE_STATUS.CRITICAL : SOURCE_STATUS.WARN;
            detail = source.attempts === 1
                ? 'Foi chamada uma vez e não trouxe dado'
                : `Nenhuma das ${source.attempts} chamadas trouxe dado`;
        } else if (ultimaFalhou) {
            // Já entregou antes, mas a chamada mais recente falhou. Verde aqui
            // esconderia uma fonte caindo AGORA atrás de um histórico bom.
            status = SOURCE_STATUS.WARN;
            detail = `A última chamada falhou (${source.ok} de ${source.attempts} trouxeram dado)`;
        } else {
            detail = `${source.ok} de ${source.attempts} chamadas com dado`;
        }

        const idade = hoursSince(lastDeliveryAt, now);
        const idadeResposta = hoursSince(source.lastOkAt, now);

        return {
            id: source.id,
            label: source.label,
            short: source.short,
            role: source.role,
            group: source.group,
            feeds: source.feeds,
            critical: source.critical,
            /** 'scheduled' tem hora marcada; 'onFailure' só entra se a anterior falhar. */
            trigger: deReserva ? 'onFailure' : 'scheduled',
            cadence: cadenceLabel(source.schedule),
            /** Frase do próximo disparo; `null` para fonte de reserva (não tem hora). */
            nextRun: nextRunLabel(source.schedule, now),
            /**
             * Cadeia de fallback a que pertence, e a posição nela. `null` quando a
             * fonte não tem reserva — e isso NÃO se deduz do agrupamento visual: o
             * bloco junta responsabilidades independentes (o Fundamentus não
             * substitui o Tesouro), então a tela precisa do dado explícito para não
             * desenhar uma cadeia que não existe só porque dois cards ficaram lado
             * a lado.
             */
            chain: cadeia.get(source.id)?.chain ?? null,
            chainPosition: cadeia.get(source.id)?.chainPosition ?? null,
            chainSize: cadeia.get(source.id)?.chainSize ?? null,
            /** Fontes que assumem se esta falhar, na ordem de tentativa. Vazio = ponto único de falha. */
            backups: cadeia.get(source.id)?.backups ?? [],
            /** A fonte principal que esta cobre; `null` se ela própria for a principal. */
            covers: cadeia.get(source.id)?.covers ?? null,
            status,
            detail,
            /**
             * A razão do silêncio, quando há silêncio. `null` sempre que a fonte
             * está sendo julgada pelas chamadas dela — aí o estado é `status`, e
             * não há o que explicar.
             */
            idleReason,
            lastDeliveryAt,
            lastDeliveryHours: idade === null ? null : Math.round(idade * 10) / 10,
            /**
             * Temos como medir a ENTREGA desta fonte? `false` = só conectividade,
             * e a tela precisa dizer "última resposta" em vez de "última entrega".
             */
            deliveryTracked,
            /** Última chamada que voltou COM dado. Responde por conectividade, não por entrega. */
            lastResponseAt: source.lastOkAt || null,
            lastResponseHours: idadeResposta === null ? null : Math.round(idadeResposta * 10) / 10,
            /** Chamadas que NÃO foram feitas por decisão nossa, e a razão da última. */
            skipped: source.skipped || 0,
            lastSkipAt: source.lastSkipAt || null,
            lastSkipReason: source.lastSkipReason || null,
            // Contagem aberta: a frase de `detail` resume, mas o detalhe da fonte
            // mostra os três números, que é o que permite julgar sozinho.
            attempts: source.attempts,
            ok: source.ok,
            failures: source.failures,
            failureRate: rate,
            lastError: source.lastError,
            lastOkAt: source.lastOkAt,
            lastFailAt: source.lastFailAt,
            /**
             * Quantos ATIVOS passaram por esta fonte na cadeia (ver
             * buildEscalationView). `null` quando a cadeia não tem ledger por
             * assunto — e null é diferente de zero: zero afirma que nada escalou,
             * null admite que não medimos.
             */
            escalated: LEDGERED_CHAINS.has(source.chain)
                ? (escalada.bySource.get(source.id) || { reached: 0, rescued: 0, missed: 0 })
                : null,
        };
    });
};

/**
 * Resumo de uma linha para o topo do painel: quantas fontes há, quantas estão
 * entregando, e o nome das que não estão. É o texto que responde "está tudo
 * chegando?" sem obrigar ninguém a ler a tabela inteira.
 */
export const summarizeSources = (sources = []) => {
    const degradadas = sources.filter((s) => s.status === SOURCE_STATUS.WARN || s.status === SOURCE_STATUS.CRITICAL);
    const desconhecidas = sources.filter((s) => s.status === SOURCE_STATUS.UNKNOWN);
    return {
        total: sources.length,
        ok: sources.filter((s) => s.status === SOURCE_STATUS.OK).length,
        degraded: degradadas.length,
        unknown: desconhecidas.length,
        degradedLabels: degradadas.map((s) => s.label),
        worst: degradadas.some((s) => s.status === SOURCE_STATUS.CRITICAL)
            ? SOURCE_STATUS.CRITICAL
            : (degradadas.length ? SOURCE_STATUS.WARN : SOURCE_STATUS.OK),
    };
};
