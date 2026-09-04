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
 * chegou ao banco pela última vez", e é `null` quando a fonte não tem um carimbo
 * próprio (aí o veredito fica só com a conectividade).
 */
const deliveryFacts = (facts) => {
    const macro = facts.macro || {};
    const currencySources = macro.currenciesSources || {};
    const rateSources = macro.ratesSources || {};

    // Uma fonte de câmbio "entregou" se ela é a origem gravada de alguma moeda.
    const currencyDelivery = (nome) => (
        currencySources.usd === nome || currencySources.btc === nome
            ? macro.currenciesUpdatedAt || null
            : null
    );

    return {
        'yahoo.currencies': currencyDelivery('Yahoo'),
        awesomeapi: currencyDelivery('AwesomeAPI'),
        coinbase: currencyDelivery('Coinbase'),
        ptax: currencyDelivery('PTAX/BCB'),
        'bcb.series': rateSources.selic === 'BCB' || rateSources.ipca === 'BCB'
            ? macro.ratesUpdatedAt || null : null,
        brasilapi: rateSources.selic === 'BrasilAPI' || rateSources.ipca === 'BrasilAPI'
            ? macro.ratesUpdatedAt || null : null,
        ibge: rateSources.ipca === 'IBGE' ? macro.ratesUpdatedAt || null : null,
        'yahoo.indices': macro.updatedAt || null,
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
    for (const membros of porCadeia.values()) {
        // A ordem do catálogo É a ordem de tentativa — ver SOURCE_CATALOG.
        const principal = membros.find((m) => m.schedule?.kind !== 'onFailure') || membros[0];
        membros.forEach((m, i) => {
            mapa.set(m.id, {
                backups: membros.slice(i + 1).map((b) => b.label),
                covers: m.id === principal?.id ? null : (principal?.label ?? null),
            });
        });
    }
    return mapa;
};

export const buildSourceStatuses = (facts, sourceStats = []) => {
    const now = facts?.now || new Date();
    const delivery = deliveryFacts(facts || {});
    const cadeia = buildChainMap(sourceStats);

    return sourceStats.map((source) => {
        const lastDeliveryAt = delivery[source.id] || source.lastOkAt || null;
        const rate = source.failureRate;
        const julgavel = source.attempts >= MIN_ATTEMPTS && rate !== null;

        let status = SOURCE_STATUS.OK;
        let detail;

        const deReserva = source.schedule?.kind === 'onFailure';
        // A última tentativa terminou em falha? É o estado CORRENTE da fonte, e
        // vale mais que a média: uma fonte que roda duas vezes por dia levaria
        // dias para a taxa acusar algo, enquanto "a última chamada falhou" é
        // exatamente o que se quer ver no painel no momento em que acontece.
        const ultimaFalhou = !!source.lastFailAt
            && (!source.lastOkAt || new Date(source.lastFailAt) > new Date(source.lastOkAt));

        if (source.attempts === 0) {
            // Silêncio não é falha. Uma fonte que só roda no sync diário fica sem
            // chamada nenhuma por horas depois de um deploy, e marcá-la de vermelho
            // aí é o alarme falso que ensina o operador a ignorar o painel.
            status = SOURCE_STATUS.UNKNOWN;
            if (deReserva) {
                // Aqui o cinza é BOA notícia: a cadeia não precisou da reserva.
                detail = 'Nenhuma chamada porque a fonte anterior da cadeia deu conta — é o esperado';
            } else if (lastDeliveryAt) {
                // Entrega gravada ANTES do reinício. Dizer só "sem chamadas" ao lado
                // de "há 12 min" faz a linha se contradizer na tela; o que aconteceu
                // é que o dado dela está no banco e o processo atual ainda não a usou.
                detail = 'Entregou antes do último reinício; ainda sem novas chamadas neste processo';
            } else {
                detail = 'Ainda não teve a vez dela desde o reinício do servidor';
            }
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
            /** Fontes que assumem se esta falhar, na ordem de tentativa. Vazio = ponto único de falha. */
            backups: cadeia.get(source.id)?.backups ?? [],
            /** A fonte principal que esta cobre; `null` se ela própria for a principal. */
            covers: cadeia.get(source.id)?.covers ?? null,
            status,
            detail,
            lastDeliveryAt,
            lastDeliveryHours: idade === null ? null : Math.round(idade * 10) / 10,
            // Contagem aberta: a frase de `detail` resume, mas o detalhe da fonte
            // mostra os três números, que é o que permite julgar sozinho.
            attempts: source.attempts,
            ok: source.ok,
            failures: source.failures,
            failureRate: rate,
            lastError: source.lastError,
            lastOkAt: source.lastOkAt,
            lastFailAt: source.lastFailAt,
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
