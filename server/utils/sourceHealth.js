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
    'yahoo.chart': {
        label: 'Yahoo Finance — candle',
        short: 'Yahoo candle',
        role: 'Último fechamento',
        group: 'quotes',
        // Escrito para quem lê o painel: o valor é de FECHAMENTO, não do minuto —
        // e essa diferença é a razão de ele vir depois da cotação, nunca antes.
        feeds: 'Último fechamento do ativo, quando a cotação ao vivo do Yahoo vem vazia',
        schedule: { kind: 'onFailure' },
        chain: 'quotes',
        critical: false,
    },
    'google.finance': {
        label: 'Google Finance',
        short: 'Google',
        role: 'Um ativo por vez',
        group: 'quotes',
        feeds: 'Cotação buscada ativo por ativo, quando o Yahoo não traz nem cotação nem candle',
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
    //
    // A AwesomeAPI saiu em 05/09/2026 por não atender a partir do host de
    // produção — respondia da máquina do desenvolvedor e nunca de lá. Um card que
    // fica amarelo para sempre não avisa nada; ensina a ignorar a cor. No mesmo
    // dia entrou a Coinbase de taxas, que cobre a única janela sem ninguém: o
    // dólar da manhã, antes de a PTAX do dia ser publicada.
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
    coinbase: {
        label: 'Coinbase',
        short: 'Coinbase',
        role: 'Só Bitcoin',
        group: 'fx',
        feeds: 'Bitcoin, quando o Yahoo não responde',
        schedule: { kind: 'onFailure' },
        chain: 'fx',
        critical: false,
    },
    ptax: {
        label: 'PTAX — Banco Central',
        short: 'PTAX',
        role: 'Só dólar (oficial)',
        group: 'fx',
        feeds: 'Dólar oficial, quando o Yahoo não responde — e só depois das 13h, quando o Banco Central publica a fixação do dia',
        schedule: { kind: 'onFailure' },
        chain: 'fx',
        critical: false,
    },
    'coinbase.rates': {
        label: 'Coinbase — taxas de câmbio',
        short: 'Coinbase taxas',
        role: 'Dólar e Bitcoin',
        group: 'fx',
        // O card precisa dizer QUANDO ela salva o dia, senão "última da fila"
        // parece decoração: a janela é a manhã, quando a PTAX ainda não saiu.
        feeds: 'Dólar e Bitcoin quando todas as outras falham — principalmente pela manhã, antes de o Banco Central publicar a taxa do dia',
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
    /*
     * AS DUAS PRIMEIRAS NÃO DISPUTAM O MESMO POSTO, e por muito tempo o texto
     * daqui dizia que sim.
     *
     * Em cotações a cadeia é uma fila de reservas de verdade: Yahoo, Google e
     * Brapi devolvem a MESMA coisa (um preço), e a seguinte só é chamada porque a
     * anterior não trouxe. Em candle não é isso. O Yahoo entrega a SÉRIE (centenas
     * de candles, ajustados por evento corporativo, e é o único que cobre cripto e
     * ativo americano); a B3 entrega a PONTA (o fechamento oficial de UM pregão,
     * do mercado brasileiro inteiro, num arquivo só). Uma não substitui a outra: a
     * B3 estende série que já existe e não reconstrói histórico — um ano custaria
     * ~250 downloads —, e fora da B3 o Yahoo não tem quem o cubra.
     *
     * E o desencontro fica maior por causa de uma régua nossa: `isHistoryStale`
     * tolera 2 dias, e série a que só falta hoje tem 1,8 dia. De terça a sexta ela
     * passa por fresca e o Yahoo nem é consultado — quem fecha a ponta é a B3,
     * todo dia. O Yahoo volta a ser chamado na segunda, quando o fim de semana
     * finalmente envelhece a série. Enquanto o texto dizia "quando o Yahoo publica
     * o dia sem preço", a tela contava uma falha dele em cada uma dessas linhas.
     */
    'yahoo.history': {
        label: 'Yahoo Finance — histórico',
        short: 'Yahoo histórico',
        role: 'Série de fechamentos',
        group: 'series',
        feeds: 'A série inteira — gráficos, rentabilidade da carteira e as métricas do ranking',
        schedule: { kind: 'dailyTimes', at: ['18:30'] },
        chain: 'candle',
        critical: true,
    },
    b3: {
        label: 'B3 — arquivo diário',
        short: 'B3',
        role: 'Fechamento do dia da bolsa',
        group: 'series',
        feeds: 'O fechamento oficial do pregão — só ações, FIIs e ETFs da B3 — nas séries que ainda não o têm: todo dia, tenha o Yahoo sido consultado ou não',
        schedule: { kind: 'onFailure' },
        chain: 'candle',
        critical: false,
    },
    'yahoo.hourly': {
        label: 'Yahoo Finance — barras horárias',
        short: 'Yahoo horário',
        role: 'Só cripto',
        group: 'series',
        // A cripto não tem arquivo de pregão: quando o Yahoo publica a barra
        // diária vazia, a barra horária do mesmo dia é o único socorro que existe.
        feeds: 'Fechamento do dia da cripto quando a barra diária vem sem preço',
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
        chain: 'indices',
        critical: true,
    },
    // Ganhou reserva em 09/09/2026, e até ali era o único ponto único de falha
    // entre as chamadas do Yahoo que precisam de crumb: quando o 429 do crumb
    // derrubou cotação, câmbio e índices no mesmo minuto, os dois primeiros
    // tinham para onde ir e este não tinha — o macro-sync só deixava de escrever
    // `ibov`/`spx` e a barra do topo seguia exibindo o número da véspera.
    'yahoo.indices.chart': {
        label: 'Yahoo Finance — índices (candle)',
        short: 'Índice candle',
        role: 'Último fechamento',
        group: 'series',
        feeds: 'Fechamento do Ibovespa e do S&P 500 quando a cotação ao vivo do Yahoo falha',
        schedule: { kind: 'onFailure' },
        chain: 'indices',
        critical: false,
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

    // --- Calendário de pagamento de proventos ---
    //
    // Cadeia de DOIS elos que não é uma escolha, é uma restrição: o Fundamentus
    // responde 403 ao IP do Render (o mesmo bloqueio que faz o `sync:prod` ser
    // manual), então em produção só a B3 roda. O segundo elo existe para a máquina
    // do desenvolvedor, disparado à mão pelo botão do Admin — e é por isso que o
    // cinza dele em produção é o estado NORMAL, não um alarme.
    'b3.dividends': {
        label: 'B3 — calendário de proventos',
        short: 'B3 proventos',
        role: 'Últimos 12 meses',
        group: 'reference',
        feeds: 'Data em que o provento cai na conta, para ação e FII brasileiros',
        schedule: { kind: 'dailyTimes', at: ['04:00'] },
        chain: 'paymentDate',
        critical: false,
    },
    'fundamentus.dividends': {
        label: 'Fundamentus — calendário de proventos',
        short: 'Fundamentus proventos',
        role: 'Histórico antigo, só no dev',
        group: 'reference',
        feeds: 'Data de pagamento anterior ao alcance da B3; bloqueada em produção, roda no ambiente de desenvolvimento',
        schedule: { kind: 'manual' },
        chain: 'paymentDate',
        critical: false,
    },
};

const stats = new Map();

const blank = () => ({
    ok: 0, fail: 0, empty: 0, lastOkAt: null, lastFailAt: null, lastError: null,
    skipped: 0, lastSkipAt: null, lastSkipReason: null,
});

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
/**
 * A FONTE NÃO FOI CHAMADA, E ISSO FOI DECISÃO NOSSA.
 *
 * O quarto desfecho, e o único que não é sobre a fonte. Há chamada que o sistema
 * sabe, de antemão, que não pode dar certo: a PTAX é a fixação do dia e o Banco
 * Central não fixa em fim de semana nem em feriado, então em 07/09/2026 —
 * feriado da Independência — a série do Olinda simplesmente não tinha linha de
 * hoje. Perguntar assim mesmo gasta a chamada e, pior, deixa o painel com uma
 * história sem sentido: o card dizia "1 de 1 chamadas com dado" (a resposta HTTP
 * veio, com os 10 dias) ao lado de "0 moedas resolvidas por esta fonte".
 *
 * Silêncio tem duas causas muito diferentes, e o painel precisa distingui-las:
 * a reserva que não foi chamada porque a anterior deu conta (boa notícia) e a
 * fonte que não foi chamada porque hoje ela não teria o dado (informação). Sem
 * este registro, as duas ficam idênticas na tela.
 *
 * NÃO conta como tentativa: pular não é falhar, e somar isso à taxa de falha
 * pintaria de amarelo uma fonte que está funcionando perfeitamente.
 *
 * @param {string} id chave do SOURCE_CATALOG
 * @param {string} reason em português de dono — vai para a tela
 */
export const recordSourceSkip = (id, reason) => {
    const stat = entry(id);
    stat.skipped += 1;
    stat.lastSkipAt = new Date();
    stat.lastSkipReason = String(reason || '').slice(0, 200) || null;
};

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
        // Fora de `attempts` de propósito — ver recordSourceSkip.
        skipped: stat.skipped,
        lastSkipAt: stat.lastSkipAt,
        lastSkipReason: stat.lastSkipReason,
    };
});

/** Só para teste — o registro é global ao processo (contadores e ledgers). */
export const resetSourceStats = () => { stats.clear(); escalations.clear(); suspects.clear(); };

/**
 * QUEM PRECISOU DE RESERVA — o registro por ASSUNTO, não por chamada.
 *
 * Os contadores acima respondem "a fonte está entregando?" e param aí. Em
 * 04/09/2026 o painel mostrava a Brapi instável com 80 chamadas, e a pergunta
 * óbvia não tinha resposta em lugar nenhum: *quais ativos* chegaram até ela?
 * Contagem de chamadas não sabe de ticker — 24 falhas da Brapi podiam ser 24
 * ativos diferentes ou o mesmo ativo morto tentado 24 vezes, e as duas coisas
 * pedem ações opostas (investigar a fonte × aposentar o papel).
 *
 * O que se grava aqui é o CAMINHO de cada assunto dentro de uma cadeia: quem foi
 * tentado, em que ordem, e quem finalmente trouxe o dado. É o que transforma
 * "a Brapi está instável" em "PETR4 e HGLG11 vieram pela Brapi porque Yahoo e
 * Google não trouxeram, e EURP11 não veio de ninguém".
 *
 * Um registro por ASSUNTO, não por evento: a chave é `cadeia|assunto` e a
 * repetição só atualiza a última ocorrência (com um contador). Sem isso, um
 * ticker morto tentado a cada 15 minutos empurraria todo o resto para fora do
 * teto em duas horas e a lista viraria a mesma linha repetida.
 *
 * Mesma natureza dos contadores: memória do PROCESSO, some no reinício. Ledger
 * persistido significaria escrever no banco a cada cotação recuperada.
 */

/**
 * Teto de assuntos guardados POR CADEIA, e o "por cadeia" é o ponto.
 *
 * Um teto global era suficiente enquanto só as cotações escreviam aqui. Com
 * quatro cadeias no mesmo Map, um dia em que o Yahoo publica a série de 600
 * papéis sem o fechamento empurraria as duas linhas do câmbio para fora — e a
 * pergunta que o ledger do câmbio existe para responder sumiria justamente no
 * dia ruim. Cada cadeia gasta o seu teto e não invade o do vizinho.
 */
const ESCALATION_CAP = 600;

/**
 * Cadeias que têm ledger por assunto, e como cada uma se chama na tela.
 *
 * Existe para a tela não mentir por omissão. Sem esta lista, uma cadeia que
 * ninguém instrumentou apareceria com "0 ativos precisaram de reserva" — que se
 * lê como *nada escalou*, quando o verdadeiro é *não medimos*. São afirmações
 * opostas, e a segunda é a única que temos direito de fazer. Instrumentou o
 * fallback de uma cadeia nova? Acrescente o id aqui, e só então o painel passa a
 * falar por ela.
 *
 * O valor é o VOCABULÁRIO, e ele mora aqui pela mesma razão que o `feeds` do
 * catálogo: o texto da tela é decisão de quem conhece o assunto. O painel nasceu
 * medindo só cotações, então "ativo" e "preço" estavam escritos dentro do
 * componente — e a mesma frase, aplicada ao câmbio, diria "2 ativo(s) sem preço"
 * para o dólar e o Bitcoin. Cada cadeia mede coisas diferentes e precisa poder
 * dizer o nome delas: moeda e cotação, indicador e valor, ativo e fechamento.
 *
 * As quatro cadeias do catálogo estão medidas desde 06/09/2026. A quinta, se
 * vier, fica de fora até alguém chamar `recordEscalation` por ela.
 *
 * `expectedBadge`/`expectedLong` são o par que faltava: a ausência que a cadeia
 * NÃO tinha como evitar. Papel que não negociou não tem fechamento em fonte
 * nenhuma, hoje nem depois — pintar isso de vermelho ao lado de uma fonte que
 * caiu de verdade é dizer as duas coisas com a mesma palavra, e a palavra some.
 */
export const LEDGERED_CHAINS = new Map([
    ['quotes', {
        noun: 'ativo',
        none: 'Nenhum ativo',
        rescued: 'tiveram o preço trazido por esta fonte',
        allFromPrimary: 'esta fonte trouxe o preço de todos',
        missingBadge: 'sem preço',
        missingLong: 'sem preço em nenhuma',
        expectedBadge: 'não negociou',
        expectedLong: 'sem papel negociando',
        deadSubject: 'que nenhuma fonte precificou — faltou papel negociando',
    }],
    ['fx', {
        noun: 'moeda',
        none: 'Nenhuma moeda',
        rescued: 'tiveram a cotação trazida por esta fonte',
        allFromPrimary: 'esta fonte trouxe a cotação das duas',
        missingBadge: 'sem cotação',
        missingLong: 'sem cotação em nenhuma',
        expectedBadge: 'esperado',
        expectedLong: 'ausência esperada',
        deadSubject: 'que nenhuma fonte cotou',
    }],
    ['rates', {
        noun: 'indicador',
        none: 'Nenhum indicador',
        rescued: 'tiveram o valor trazido por esta fonte',
        allFromPrimary: 'esta fonte trouxe o valor de todos',
        missingBadge: 'sem valor',
        missingLong: 'sem valor em nenhuma',
        expectedBadge: 'esperado',
        expectedLong: 'ausência esperada',
        deadSubject: 'que nenhuma fonte publicou',
    }],
    ['candle', {
        noun: 'ativo',
        none: 'Nenhum ativo',
        /*
         * A ÚNICA CADEIA QUE NÃO É UMA FILA DE RESERVAS (ver a nota do catálogo,
         * em 'yahoo.history'), e por isso a única que reescreve estas frases.
         *
         * "Precisaram de reserva" afirma duas coisas: que a principal foi chamada
         * e que ela não deu conta. Nas outras três cadeias as duas são verdade. Em
         * candle, nenhuma das duas é na maior parte da semana — a série passa por
         * fresca na régua de 2 dias, o Yahoo não chega a ser consultado, e a B3
         * fecha a ponta porque é a função dela, não porque alguém falhou.
         *
         * O que a linha tem a dizer é o ESTADO, não a culpa: o fechamento do dia
         * não estava na série. Os selos ao lado é que completam a frase — quem
         * fechou, e quantos não negociaram.
         */
        escalatedLine: 'ficaram sem o fechamento do dia na série',
        escalatedNone: 'ficou sem o fechamento do dia na série',
        escalatedTitle: 'Quem ficou sem o fechamento na série',
        backupOf: 'Fecha a ponta do pregão na série de',
        rescued: 'tiveram o fechamento trazido por esta fonte',
        allFromPrimary: 'esta fonte trouxe o fechamento de todos',
        missingBadge: 'sem fechamento',
        missingLong: 'sem fechamento em nenhuma',
        expectedBadge: 'não negociou',
        expectedLong: 'sem pregão no papel',
        deadSubject: 'que nenhuma fonte fechou — faltou pregão para o papel',
    }],
    // Calendário de pagamento. "Ausência esperada" aqui tem sentido próprio e
    // frequente: o provento cuja data a fonte não publica porque o emissor ainda
    // não anunciou. Isso não é falha de ninguém — é o mundo, e o card precisa
    // dizer isso em vez de pintar de amarelo.
    ['paymentDate', {
        noun: 'ativo',
        none: 'Nenhum ativo',
        rescued: 'tiveram a data de pagamento trazida por esta fonte',
        allFromPrimary: 'esta fonte datou os proventos de todos',
        missingBadge: 'sem data',
        missingLong: 'sem data em nenhuma',
        expectedBadge: 'ainda não anunciado',
        expectedLong: 'pagamento ainda não anunciado pelo emissor',
        deadSubject: 'cujo pagamento nenhuma fonte datou — o emissor ainda não anunciou',
    }],
]);

const escalations = new Map();

/**
 * Registra que um assunto precisou percorrer a cadeia.
 *
 * @param {object} evento
 * @param {string} evento.chain cadeia do SOURCE_CATALOG (ex.: 'quotes')
 * @param {string} evento.subject o que se buscava (ticker, 'USD'…)
 * @param {string[]} evento.tried o CAMINHO, na ordem — incluindo a principal que
 *   não entregou. É ela que dá sentido ao resto: sem o primeiro elo na lista, não
 *   dá para dizer de onde o ativo veio.
 * @param {string[]} [evento.skipped] dos `tried`, quais NÃO foram consultadas —
 *   ver a nota abaixo. Elo fora desta lista é afirmação de que a fonte foi
 *   chamada e não entregou.
 * @param {string|null} evento.resolvedBy id que trouxe o dado; `null` = ninguém
 * @param {string} [evento.reason] por que escalou, em português
 * @param {boolean} [evento.expected] escalada conhecida e sem novidade (ticker
 *   que sempre falha na principal). Separar isso do resto é o que impede a lista
 *   de virar ruído permanente que se aprende a ignorar.
 * @param {string|null} [evento.session] o pregão/dia de que esta linha fala,
 *   quando a cadeia tem um. Serve para quem SOBRESCREVE a linha de outra rotina
 *   saber se as duas falam do mesmo dia (ver `getEscalation`).
 */
/*
 * A FONTE ESTAVA NA CADEIA E NÃO FOI PERGUNTADA — o `recordSourceSkip` deste
 * ledger, um degrau abaixo: lá o sujeito é a fonte, aqui é o assunto.
 *
 * Sem isto, `tried` só tem dois estados, na tela e nas contas: quem entregou e
 * quem, por eliminação, falhou. Então toda rotina que desce direto para a reserva
 * — porque a régua de staleness mandou poupar a principal, não porque a principal
 * caiu — acusava a principal de uma falha que nunca houve. Medido em 10/09/2026
 * na varredura de ponta do universo: 523 séries socorridas pela B3 pintaram o
 * Yahoo com 523 `missed` de chamadas que ele nunca recebeu, e cada linha da tela
 * exibia "Yahoo histórico" riscado.
 *
 * Pular NÃO é falhar, a mesma regra do quarto desfecho de fonte: o elo não conta
 * como alcançado nem como perdido, e na tela aparece apagado, não riscado.
 */
export const recordEscalation = ({ chain, subject, tried = [], skipped = [], resolvedBy = null, reason = null, expected = false, session = null }) => {
    if (!chain || !subject) return;
    const key = `${chain}|${subject}`;
    const anterior = escalations.get(key);
    // Reinserir joga a chave para o fim: a ordem do Map passa a ser "mais antigo
    // primeiro" e o descarte por idade sai de graça, sem varrer nada.
    escalations.delete(key);
    escalations.set(key, {
        chain,
        subject,
        tried: [...tried],
        // Só vale como "não consultada" o elo que está no caminho: `skipped` com
        // fonte fora de `tried` não teria onde aparecer na tela e viraria uma
        // contagem fantasma nas do painel.
        skipped: skipped.filter((id) => tried.includes(id)),
        resolvedBy: resolvedBy || null,
        reason: reason || null,
        expected: !!expected,
        session: session || null,
        at: new Date(),
        count: (anterior?.count || 0) + 1,
    });
    // Descarte por CADEIA: varre do mais antigo e tira só quem é da mesma fila.
    // A varredura só roda quando a cadeia estoura o teto, e nunca passa de uma
    // remoção por chamada (o Map já estava no limite antes desta inserção).
    let daCadeia = 0;
    for (const chave of escalations.keys()) {
        if (chave.startsWith(`${chain}|`)) daCadeia += 1;
    }
    if (daCadeia > ESCALATION_CAP) {
        for (const chave of escalations.keys()) {
            if (chave.startsWith(`${chain}|`)) { escalations.delete(chave); break; }
        }
    }
};

/**
 * A LINHA QUE JÁ EXISTE PARA ESTE ASSUNTO, se existe.
 *
 * Existe para uma situação só: a rotina que sobrescreve a linha de OUTRA rotina.
 * A varredura horária da ponta cura o vermelho que o run das 18:30 deixou e, ao
 * fazer isso, reescreve um caminho que não foi ela quem percorreu — se disser "o
 * Yahoo não foi consultado" (verdade dela, que só chama a B3), apaga a medição do
 * run anterior, onde o Yahoo foi chamado de verdade e não entregou.
 *
 * Devolve cópia: o ledger é do módulo, e quem lê para decidir não escreve.
 */
export const getEscalation = (chain, subject) => {
    const ev = escalations.get(`${chain}|${subject}`);
    return ev ? { ...ev, tried: [...ev.tried], skipped: [...(ev.skipped || [])] } : null;
};

/** Fotografia do ledger, do mais recente para o mais antigo. */
export const getEscalations = () => [...escalations.values()]
    .sort((a, b) => new Date(b.at) - new Date(a.at));

/**
 * O PREÇO CHEGOU, MAS ELE FAZ SENTIDO? — o terceiro registro desta casa.
 *
 * Os contadores dizem se a fonte respondeu; o ledger de escaladas diz por onde
 * cada ativo passou. Nenhum dos dois olha para o NÚMERO. E é aí que mora a falha
 * mais cara, porque ela não deixa rastro: cotação errada volta 200, datada, com
 * failCount zerado, e entra no ranking e na carteira como se fosse boa.
 *
 * O veredito é do `utils/quoteSanity.js` (puro); aqui é só a memória — mesma
 * natureza dos outros dois: um registro por ATIVO, teto de tamanho, some no
 * reinício. Persistir significaria escrever no banco a cada cotação suspeita, e
 * a pergunta que isto responde ("o que chegou torto agora?") não precisa de
 * histórico longo: o estado ACUMULADO tem dono próprio, que é a sentinela.
 */
const SUSPECT_CAP = 300;

const suspects = new Map();

/**
 * Registra uma cotação que chegou fora do esperado.
 *
 * @param {object} evento
 * @param {string} evento.subject ticker
 * @param {string} [evento.type] classe do ativo
 * @param {string} [evento.source] fonte que trouxe o número (YAHOO, BRAPI…)
 * @param {number} evento.price preço gravado
 * @param {Array<{code: string, detail: string, movePct: number|null}>} evento.findings
 *   achados de `judgeQuote`. Sem achado, nada é registrado.
 */
export const recordSuspectQuote = ({ subject, type = null, source = null, price = null, findings = [] }) => {
    if (!subject || !Array.isArray(findings) || findings.length === 0) return;
    const anterior = suspects.get(subject);
    // Mesma mecânica do ledger de escaladas: reinserir joga a chave para o fim,
    // então o descarte por idade sai de graça.
    suspects.delete(subject);
    suspects.set(subject, {
        subject,
        type,
        source,
        price,
        findings,
        at: new Date(),
        count: (anterior?.count || 0) + 1,
    });
    while (suspects.size > SUSPECT_CAP) {
        suspects.delete(suspects.keys().next().value);
    }
};

/** Fotografia das cotações suspeitas, da mais recente para a mais antiga. */
export const getSuspectQuotes = () => [...suspects.values()]
    .sort((a, b) => new Date(b.at) - new Date(a.at));
