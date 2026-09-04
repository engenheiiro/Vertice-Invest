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
 * Blocos do painel, na ordem em que aparecem.
 *
 * Agrupar por FUNÇÃO, e não por estado, é decisão de leitura: numa grade de 15
 * cards a cor já faz a triagem, então reordenar por gravidade só custaria a
 * memória de posição — o card que muda de lugar a cada carregamento não se acha
 * de olho. Fixo, aprende-se onde cada coisa fica e o olho vai direto na cor.
 *
 * A ordem dos blocos segue o quanto o dado toca o que o usuário vê: preço da
 * carteira primeiro, dado de apoio por último.
 */
export const SOURCE_GROUPS = [
    { id: 'quotes', label: 'Cotações de ativos', hint: 'Preço da carteira e do ranking' },
    { id: 'fx', label: 'Câmbio e cripto', hint: 'Converte patrimônio em dólar para reais' },
    { id: 'rates', label: 'Indicadores econômicos', hint: 'Selic e IPCA, base de todo o ranking' },
    { id: 'series', label: 'Histórico e índices', hint: 'Gráficos, rentabilidade e barra do topo' },
    { id: 'reference', label: 'Renda fixa e fundamentos', hint: 'Tesouro Direto e dados das empresas' },
];

/**
 * Catálogo das fontes. `feeds` é escrito para quem NÃO conhece o sistema — é o
 * texto que vai para a tela, e a régua é: se o dono do produto não entender a
 * frase, ela está errada.
 *
 * Dentro de cada bloco a ordem é a da CADEIA (principal → reservas), porque essa
 * ordem carrega informação: ver a 3ª fonte acesa enquanto a 1ª está vermelha diz,
 * de relance, que a reserva está segurando o sistema.
 *
 * `role` descreve a COBERTURA, não a posição — a posição é `chainPosition`, que a
 * tela desenha como "1ª → 2ª → 3ª". Escrever "3ª fonte" aqui duplicaria o número
 * e desperdiçaria a única linha do card que pode contar o que de fato varia entre
 * os elos: a Coinbase só traz Bitcoin, o IBGE só traz IPCA, a Brapi só cobre
 * ativos brasileiros. Cair para a reserva quase nunca é cair para um substituto
 * completo, e é isso que precisa estar visível.
 *
 * `critical: true` = sem ela, alguma parte do produto para ou serve número velho.
 *
 * `schedule` diz QUANDO ela roda, e é o que separa dois cinzas muito diferentes:
 * o da fonte agendada que ainda não teve a vez ("volta em 7 min") e o da fonte de
 * reserva, que só é chamada quando a anterior falha — nesta, cinza é boa notícia.
 * Os horários espelham `schedulerService.js`; mudar o cron lá pede mudar aqui.
 *
 * `chain` marca as fontes que REALMENTE se cobrem, e não coincide com `group`:
 * 'reference' agrupa responsabilidades independentes (o Fundamentus não substitui
 * o Tesouro), e em 'series' só o candle diário tem reserva — os índices, não.
 * Fonte sem `chain` é ponto único de falha, e dizer isso na tela é metade do valor
 * do painel.
 *
 * A ordem de cada cadeia é a do CÓDIGO, não a que soaria razoável. Em cotações o
 * Google vem antes da Brapi (`recoverQuote` em externalMarketService), e o catálogo
 * afirmava o contrário — o painel dizia, com todas as letras, que a Brapi era
 * tentada primeiro. Mudar a ordem de tentativa lá obriga a mudar aqui.
 */
export const SOURCE_CATALOG = {
    // --- Cotações de ativos: a cadeia que precifica a carteira ---
    'yahoo.quotes': {
        label: 'Yahoo Finance — cotações',
        short: 'Yahoo',
        role: 'Todos os mercados',
        group: 'quotes',
        feeds: 'Preço de ações, FIIs, ETFs e cripto na carteira e no ranking',
        schedule: { kind: 'minutes', at: [0, 15, 30, 45] },
        chain: 'quotes',
        critical: true,
    },
    'google.finance': {
        label: 'Google Finance',
        short: 'Google',
        role: 'Um ativo por vez',
        group: 'quotes',
        feeds: 'Cotação buscada ativo por ativo, quando o Yahoo não traz o preço',
        schedule: { kind: 'onFailure' },
        chain: 'quotes',
        critical: false,
    },
    brapi: {
        label: 'Brapi',
        short: 'Brapi',
        role: 'Só ativos brasileiros',
        group: 'quotes',
        feeds: 'Cotação de ativo brasileiro quando nem o Yahoo nem o Google trazem',
        schedule: { kind: 'onFailure' },
        chain: 'quotes',
        critical: false,
    },

    // --- Câmbio e cripto: cadeia de 4 elos, cada um cobrindo o que faltou ---
    'yahoo.currencies': {
        label: 'Yahoo Finance — câmbio',
        short: 'Yahoo',
        role: 'Dólar e Bitcoin',
        group: 'fx',
        feeds: 'Dólar e Bitcoin',
        schedule: { kind: 'minutes', at: [5, 20, 35, 50] },
        chain: 'fx',
        critical: false,
    },
    awesomeapi: {
        label: 'AwesomeAPI',
        short: 'AwesomeAPI',
        role: 'Dólar e Bitcoin',
        group: 'fx',
        feeds: 'Dólar e Bitcoin, quando o Yahoo não responde',
        schedule: { kind: 'onFailure' },
        chain: 'fx',
        critical: false,
    },
    coinbase: {
        label: 'Coinbase',
        short: 'Coinbase',
        role: 'Só Bitcoin',
        group: 'fx',
        feeds: 'Bitcoin, quando as duas primeiras falham',
        schedule: { kind: 'onFailure' },
        chain: 'fx',
        critical: false,
    },
    ptax: {
        label: 'PTAX — Banco Central',
        short: 'PTAX',
        role: 'Só dólar (oficial)',
        group: 'fx',
        feeds: 'Dólar oficial, quando as duas primeiras falham',
        schedule: { kind: 'onFailure' },
        chain: 'fx',
        critical: false,
    },

    // --- Indicadores econômicos ---
    'bcb.series': {
        label: 'Banco Central — séries',
        short: 'Banco Central',
        role: 'Selic e IPCA',
        group: 'rates',
        feeds: 'Selic e IPCA, que definem a taxa livre de risco de todo o ranking',
        schedule: { kind: 'minutes', at: [5, 20, 35, 50] },
        chain: 'rates',
        critical: true,
    },
    brasilapi: {
        label: 'BrasilAPI',
        short: 'BrasilAPI',
        role: 'Selic e IPCA',
        group: 'rates',
        feeds: 'Selic e IPCA quando o Banco Central não responde',
        schedule: { kind: 'onFailure' },
        chain: 'rates',
        critical: false,
    },
    ibge: {
        label: 'IBGE',
        short: 'IBGE',
        role: 'Só IPCA',
        group: 'rates',
        feeds: 'IPCA quando as duas fontes acima falham',
        schedule: { kind: 'onFailure' },
        chain: 'rates',
        critical: false,
    },

    // --- Histórico e índices ---
    'yahoo.history': {
        label: 'Yahoo Finance — histórico',
        short: 'Yahoo histórico',
        role: 'Série de fechamentos',
        group: 'series',
        feeds: 'Gráficos e cálculo de rentabilidade da carteira',
        schedule: { kind: 'dailyTimes', at: ['18:30'] },
        chain: 'candle',
        critical: true,
    },
    b3: {
        label: 'B3 — arquivo diário',
        short: 'B3',
        role: 'Só ações, FIIs e ETFs da B3',
        group: 'series',
        // O que ela faz é ESTENDER a ponta de uma série que já existe — o arquivo é
        // por pregão, então reconstruir histórico custaria centenas de downloads.
        feeds: 'Fechamento oficial do pregão quando o Yahoo publica o dia sem preço',
        schedule: { kind: 'onFailure' },
        chain: 'candle',
        critical: false,
    },
    'yahoo.indices': {
        label: 'Yahoo Finance — índices',
        short: 'Yahoo índices',
        role: 'Ibovespa e S&P 500',
        group: 'series',
        feeds: 'A barra de indicadores do topo do site',
        schedule: { kind: 'minutes', at: [5, 20, 35, 50] },
        critical: true,
    },

    // --- Renda fixa e fundamentos ---
    tesouro: {
        label: 'Tesouro Transparente',
        short: 'Tesouro',
        role: 'Preço diário oficial',
        group: 'reference',
        feeds: 'Marcação a mercado dos títulos públicos na carteira',
        schedule: { kind: 'minutes', at: [5, 20, 35, 50] },
        critical: true,
    },
    fundamentus: {
        label: 'Fundamentus',
        short: 'Fundamentus',
        role: 'Raspagem diária',
        group: 'reference',
        feeds: 'Indicadores fundamentalistas das empresas brasileiras',
        schedule: { kind: 'dailyTimes', at: ['09:00', '18:30'] },
        critical: true,
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
        short: meta.short,
        role: meta.role,
        group: meta.group,
        feeds: meta.feeds,
        schedule: meta.schedule || null,
        chain: meta.chain || null,
        critical: !!meta.critical,
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
