/**
 * REGISTRO DE FONTES EXTERNAS.
 *
 * Existe porque, em 04/09/2026, uma pergunta simples não tinha resposta na tela:
 * "de onde a gente puxa dado, e o que está funcionando agora?". O câmbio ficou um
 * dia congelado e depois, já consertado, passou a ser sustentado por duas fontes
 * de reserva — sem que nada no painel dissesse isso. Pior: o Yahoo respondia
 * normalmente para cotações e índices e falhava SÓ na chamada de câmbio, no mesmo
 * processo e no mesmo minuto. Diferenciar as duas coisas era impossível de fora.
 *
 * O que este módulo NÃO é: um substituto do frescor do dado. Saber que a fonte
 * respondeu não prova que o dado chegou ao banco; por isso o painel cruza estes
 * contadores com as datas persistidas (câmbio, taxas, PU do Tesouro). Aqui mora
 * só a pergunta de conectividade: "a chamada foi e voltou?".
 *
 * Memória do PROCESSO, não do banco: zera a cada reinício, de propósito. Gravar
 * cada tentativa custaria escrita em disco a cada cotação, e a pergunta que ele
 * responde ("está entregando agora?") não precisa de histórico longo. Reinício
 * recente aparece como `UNKNOWN`, nunca como falha.
 */

/**
 * Catálogo das fontes. `feeds` é escrito para quem NÃO conhece o sistema — é o
 * texto que vai para a tela, e a régua é: se o dono do produto não entender a
 * frase, ela está errada.
 *
 * `critical: true` = sem ela, alguma parte do produto para ou serve número velho.
 * `optional: true` = a ausência de chamadas é normal (roda uma vez por dia, ou só
 * sob demanda), então silêncio não vira alarme.
 */
export const SOURCE_CATALOG = {
    'yahoo.quotes': {
        label: 'Yahoo Finance — cotações',
        feeds: 'Preço de ações, FIIs, ETFs e cripto na carteira e no ranking',
        critical: true,
    },
    'yahoo.indices': {
        label: 'Yahoo Finance — índices',
        feeds: 'Ibovespa e S&P 500 na barra do topo',
        critical: true,
    },
    'yahoo.history': {
        label: 'Yahoo Finance — histórico',
        feeds: 'Série de fechamentos que alimenta gráficos e rentabilidade',
        critical: true,
    },
    'yahoo.currencies': {
        label: 'Yahoo Finance — câmbio',
        feeds: 'Dólar e Bitcoin (1ª fonte)',
        critical: false,
    },
    awesomeapi: {
        label: 'AwesomeAPI',
        feeds: 'Dólar e Bitcoin (2ª fonte)',
        critical: false,
    },
    coinbase: {
        label: 'Coinbase',
        feeds: 'Bitcoin (3ª fonte)',
        critical: false,
    },
    ptax: {
        label: 'PTAX — Banco Central',
        feeds: 'Dólar oficial (4ª fonte)',
        critical: false,
    },
    'bcb.series': {
        label: 'Banco Central — séries',
        feeds: 'Selic e IPCA, que definem a taxa livre de risco de todo o ranking',
        critical: true,
    },
    brasilapi: {
        label: 'BrasilAPI',
        feeds: 'Selic e IPCA quando o Banco Central não responde',
        critical: false,
    },
    ibge: {
        label: 'IBGE',
        feeds: 'IPCA quando as duas fontes acima falham',
        critical: false,
    },
    tesouro: {
        label: 'Tesouro Transparente',
        feeds: 'Preço diário dos títulos públicos (marcação a mercado da renda fixa)',
        critical: true,
    },
    b3: {
        label: 'B3 — arquivo diário',
        feeds: 'Fechamento oficial do pregão, quando o Yahoo publica com buraco',
        critical: false,
        optional: true,
    },
    fundamentus: {
        label: 'Fundamentus',
        feeds: 'Indicadores fundamentalistas das empresas brasileiras',
        critical: true,
        optional: true,
    },
    brapi: {
        label: 'Brapi',
        feeds: 'Cotação de ativos brasileiros quando o Yahoo falha',
        critical: false,
    },
    'google.finance': {
        label: 'Google Finance',
        feeds: 'Último recurso de cotação, ativo por ativo',
        critical: false,
    },
};

const stats = new Map();

const blank = () => ({ ok: 0, fail: 0, empty: 0, lastOkAt: null, lastFailAt: null, lastError: null });

const entry = (id) => {
    if (!stats.has(id)) stats.set(id, blank());
    return stats.get(id);
};

/**
 * Envolve uma chamada externa e registra o desfecho.
 *
 * Três desfechos, não dois — e a distinção importa. Muita integração nossa
 * captura o próprio erro e devolve `null`/`{}` para o chamador seguir com o
 * fallback (é o padrão certo). Se `trackSource` só olhasse exceção, essas fontes
 * apareceriam como 100% saudáveis justamente quando não estão entregando nada.
 * `isEmpty` é o que separa "respondeu com dado" de "respondeu vazio".
 *
 * @param {string} id chave do SOURCE_CATALOG
 * @param {Function} fn chamada a executar
 * @param {{isEmpty?: (result: any) => boolean}} [opts]
 */
export const trackSource = async (id, fn, { isEmpty } = {}) => {
    const stat = entry(id);
    try {
        const result = await fn();
        const vazio = typeof isEmpty === 'function' && isEmpty(result);
        if (vazio) {
            stat.empty += 1;
            stat.lastFailAt = new Date();
            stat.lastError = 'respondeu sem dado utilizável';
        } else {
            stat.ok += 1;
            stat.lastOkAt = new Date();
        }
        return result;
    } catch (error) {
        stat.fail += 1;
        stat.lastFailAt = new Date();
        // Mensagem enxuta: a tela mostra isto, e stack trace é ruído ali.
        stat.lastError = String(error?.message || error).slice(0, 200);
        throw error;
    }
};

/** Fotografia do registro, com o catálogo já aplicado. Ordem estável (a do catálogo). */
export const getSourceStats = () => Object.entries(SOURCE_CATALOG).map(([id, meta]) => {
    const stat = stats.get(id) || blank();
    const attempts = stat.ok + stat.fail + stat.empty;
    return {
        id,
        label: meta.label,
        feeds: meta.feeds,
        critical: !!meta.critical,
        optional: !!meta.optional,
        attempts,
        ok: stat.ok,
        failures: stat.fail + stat.empty,
        failureRate: attempts > 0 ? (stat.fail + stat.empty) / attempts : null,
        lastOkAt: stat.lastOkAt,
        lastFailAt: stat.lastFailAt,
        lastError: stat.lastError,
    };
});

/** Só para teste — o registro é global ao processo. */
export const resetSourceStats = () => stats.clear();
