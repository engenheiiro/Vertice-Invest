/**
 * O PREÇO QUE CHEGOU É CRÍVEL?
 *
 * A cadeia de cotação já sabe responder "chegou preço?" (ledger de escaladas em
 * `sourceHealth.js`). O que ela nunca respondeu é a pergunta seguinte, e mais
 * cara: *o número que chegou faz sentido?* Fonte que não responde deixa rastro —
 * o failCount sobe, o ativo envelhece, o painel fica vermelho. Fonte que responde
 * o número ERRADO não deixa rastro nenhum: o preço entra no ranking e na carteira
 * com carimbo de sucesso.
 *
 * Já aconteceu das duas maneiras possíveis:
 *   - **Ativo trocado** — `STX` é Stacks na cripto e Seagate na NASDAQ, e a
 *     Seagate passou meses cotada a US$ 0,0028 em vez de US$ 849,28. Resposta
 *     200, com data de sessão, sobre outro ativo (ver `_providerSymbol`).
 *   - **Payload que se contradiz** — em 05/09/2026 o banco tinha XPIN11 com
 *     preço 62,04 contra `previousClose` 29,82 (+108% num FII) e NAUI11 com
 *     preço idêntico ao fechamento anterior declarando `change` de 4,02%.
 *
 * Nenhum dos dois é captado pelas defesas existentes: `price > 0` passa,
 * `isEchoQuote` passa (o número MUDOU), `isStaleSessionQuote` passa (a sessão é
 * recente). Aquelas são checagens de PRESENÇA e de IDADE; aqui mora a de
 * MAGNITUDE.
 *
 * ── Por que isto só SINALIZA, e nunca barra ──────────────────────────────────
 *
 * Grupamento e desdobramento produzem exatamente a mesma assinatura de um preço
 * errado: o provedor remarca a série e o salto é real. Barrar por magnitude
 * congelaria o ativo no preço pré-evento — e para sempre, porque cada cotação
 * nova seguiria distante do valor velho que ficou gravado. Seria trocar um
 * defeito raro e visível por um defeito permanente e silencioso.
 *
 * Então a régua aqui é de ATENÇÃO, não de veto: o preço é gravado e o ativo
 * aparece nomeado no painel de Saúde para alguém olhar. Quem decide se foi
 * corporate action ou erro de fonte é o dono, não o limiar.
 */

/**
 * Salto diário a partir do qual o preço merece o olho, por classe (%).
 *
 * Calibrado pelo que cada mercado consegue fazer num dia sem que nada esteja
 * errado, e não por um número redondo único:
 *   - FII e ETF andam em centavos; dois dígitos altos ali é sempre evento.
 *   - Ação brasileira dispara com fato relevante (OPA, recuperação judicial) —
 *     30% deixa a notícia real passar e ainda pega troca de símbolo.
 *   - Ação americana não tem o freio do índice e reage a resultado no mesmo dia.
 *   - Cripto negocia 24h e faz 40% num domingo sem novidade nenhuma.
 */
export const MOVE_LIMIT_PCT = {
    FII: 20,
    ETF: 20,
    STOCK: 30,
    STOCK_US: 35,
    CRYPTO: 50,
};

/** Classe desconhecida cai na régua de ação BR — a mais comum na base. */
export const DEFAULT_MOVE_LIMIT_PCT = 30;

/**
 * ── O TIQUE, QUANDO ELE VALE MAIS QUE A RÉGUA ────────────────────────────────
 *
 * Percentual não é medida de risco em papel de centavos. PMAM3 subiu de 0,23
 * para 0,32 em 04/09/2026 e disparou o alarme com 39,13% — mas o passo mínimo
 * da B3 ali é R$ 0,01, que sobre 0,23 já vale 4,3%: nove tiques estouram
 * qualquer régua de 30%. A série mostrava 0,13 → 0,14 → 0,15 → 0,16 → 0,17 →
 * 0,19 → 0,23 → 0,32, todos em dois decimais — uma alta real, contada em tiques
 * miúdos.
 *
 * A correção não é afrouxar a régua para todo mundo: é reconhecer que abaixo de
 * R$ 1,00 o denominador é pequeno demais para o percentual significar o que ele
 * significa em PETR4. O limite efetivo passa a ser o MAIOR entre a régua da
 * classe e o que `PENNY_TICK_COUNT` tiques valem naquele preço — e como o
 * segundo encolhe conforme o preço sobe, a regra desaparece sozinha ao chegar
 * em R$ 1,00 (10 tiques sobre 0,90 são 11%, abaixo dos 30% da ação). Nada muda
 * para o resto da base.
 *
 * O teto existe porque o alívio não pode ser infinito: um papel de R$ 0,02
 * teria limite de 500%, e dobrar de preço num dia merece o olho de qualquer
 * jeito.
 *
 * Vale só nas classes de tique de um centavo (B3). Ação americana negocia em
 * frações de centavo e cripto não tem tique — ali o denominador pequeno não
 * produz o mesmo artefato.
 */
export const PENNY_TICK = 0.01;
export const PENNY_TICK_COUNT = 10;
export const PENNY_PRICE_CEILING = 1;
export const PENNY_MAX_LIMIT_PCT = 100;
const PENNY_TICK_TYPES = new Set(['STOCK', 'FII', 'ETF']);

/**
 * Régua de magnitude para esta classe NESTE preço.
 *
 * @param {string} type classe do ativo
 * @param {number} [basePrice] preço que serve de denominador ao salto
 * @returns {number} limite em %
 */
export const effectiveMoveLimit = (type, basePrice = null) => {
    const t = String(type || '').toUpperCase();
    const limite = MOVE_LIMIT_PCT[t] ?? DEFAULT_MOVE_LIMIT_PCT;
    const base = Number(basePrice);
    if (!PENNY_TICK_TYPES.has(t) || !(base > 0) || base >= PENNY_PRICE_CEILING) return limite;
    const tiquesPct = ((PENNY_TICK * PENNY_TICK_COUNT) / base) * 100;
    return Math.min(PENNY_MAX_LIMIT_PCT, Math.max(limite, tiquesPct));
};

/**
 * Distância tolerada entre a variação DECLARADA pela fonte e a que os próprios
 * preços dela implicam (em pontos percentuais).
 *
 * Não é zero por arredondamento: o provedor publica `previousClose` já ajustado
 * por provento enquanto o `change` sai do fechamento bruto, e a diferença
 * legítima disso é fração de ponto. Um ponto e meio separa arredondamento de
 * contradição — NAUI11 declarava 4,02% com preço idêntico ao anterior.
 */
export const CHANGE_MISMATCH_PP = 1.5;

/**
 * Idade máxima do preço guardado para ele servir de régua (dias corridos).
 *
 * Comparar contra um preço de três meses atrás acusaria variação normal de
 * trimestre como salto do dia. Acima disso a comparação é omitida — e omitir é
 * a resposta certa: não temos base para julgar.
 */
export const STORED_PRICE_MAX_AGE_DAYS = 5;

const movePct = (novo, base) => ((novo - base) / base) * 100;

const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2));

const diasDesde = (dataKey, now) => {
    if (!dataKey) return null;
    const t = new Date(`${dataKey}T12:00:00.000Z`).getTime();
    if (Number.isNaN(t)) return null;
    return (now.getTime() - t) / 86400000;
};

/**
 * Julga UMA cotação recém-chegada. Puro: recebe os números, devolve o veredito.
 *
 * @param {object} entrada
 * @param {string} entrada.type classe do ativo (STOCK|FII|ETF|STOCK_US|CRYPTO)
 * @param {number} entrada.price preço que a fonte trouxe
 * @param {number} [entrada.previousClose] fechamento anterior, MESMA resposta
 * @param {number} [entrada.change] variação declarada pela fonte (%)
 * @param {number} [entrada.storedPrice] `lastPrice` que já está no banco
 * @param {string} [entrada.storedPriceDate] `priceDate` do preço guardado ('YYYY-MM-DD')
 * @param {string} [entrada.storedPriceSource] quem escreveu o `lastPrice` guardado
 * @param {Date} [entrada.now]
 * @returns {Array<{code: string, detail: string, movePct: number|null}>} achados,
 *   do mais forte para o mais fraco. Lista vazia = nada a dizer.
 */
export const judgeQuote = ({
    type,
    price,
    previousClose = null,
    change = null,
    storedPrice = null,
    storedPriceDate = null,
    storedPriceSource = null,
    now = new Date(),
} = {}) => {
    const achados = [];
    const p = Number(price);
    if (!(p > 0)) return achados; // preço ausente é outro assunto, e já tem dono

    const pc = Number(previousClose);
    const guardado = Number(storedPrice);
    // A régua é do DENOMINADOR de cada comparação, não do ativo: em papel de
    // centavos o mesmo ticker pode ter limites diferentes contra o fechamento da
    // fonte e contra o preço guardado, porque as duas bases são preços distintos.
    const limite = effectiveMoveLimit(type, pc > 0 ? pc : guardado);

    // 1. SALTO CONTRA O PRÓPRIO FECHAMENTO ANTERIOR DA FONTE.
    //    A comparação mais forte que existe: os dois números saíram da MESMA
    //    resposta, então nem defasagem nossa nem cache explicam a distância.
    if (pc > 0) {
        const delta = movePct(p, pc);
        if (Math.abs(delta) > limite) {
            achados.push({
                code: 'SALTO_NA_FONTE',
                detail: `${fmt(delta)}% contra o fechamento anterior da própria fonte `
                    + `(${fmt(pc)} → ${fmt(p)}), acima dos ${fmt(limite)}% previstos para ${type || 'a classe'}`,
                movePct: delta,
            });
        }
    }

    // 2. SALTO CONTRA O PREÇO QUE JÁ ESTAVA NO BANCO.
    //    É o que pega a troca de ativo: o provedor responde 200, datado, coerente
    //    consigo mesmo — e sobre outro papel. Só vale com preço guardado RECENTE;
    //    sem isso a régua vira "variação do trimestre" e acusa o que é normal.
    const idade = diasDesde(storedPriceDate, now);
    if (guardado > 0 && idade !== null && idade <= STORED_PRICE_MAX_AGE_DAYS) {
        const limiteBanco = effectiveMoveLimit(type, guardado);
        const delta = movePct(p, guardado);
        if (Math.abs(delta) > limiteBanco) {
            // A PROCEDÊNCIA DO PREÇO GUARDADO ENTRA NA FRASE.
            //
            // `lastPrice` tem cinco escritores e nem todos gravam `priceDate`
            // junto: o caminho de fundamentos (Fundamentus) escreve o preço e
            // deixa a data do último quote no lugar. Quando isso acontece, a
            // régua desta comparação é um Frankenstein — preço de uma fonte com
            // data de outra —, e quem lê o painel precisa saber disso antes de
            // acusar o preço novo. `priceSource` no MarketAsset existe por causa
            // do RBRL11 de 07/09/2026, que passou o fim de semana valendo 58,45
            // (o preço do RBHG11) sem que nada soubesse dizer quem escreveu.
            const proveniencia = storedPriceSource ? ` [guardado via ${storedPriceSource}]` : '';
            achados.push({
                code: 'SALTO_VS_BANCO',
                detail: `${fmt(delta)}% contra o preço que tínhamos de ${storedPriceDate} `
                    + `(${fmt(guardado)} → ${fmt(p)})${proveniencia}`,
                movePct: delta,
            });
        }
    }

    // 3. A FONTE SE CONTRADIZ.
    //    Cripto fica de fora: ali o `change` do Yahoo são 24h CORRIDAS (janela
    //    deslizante) enquanto o `previousClose` é do fechamento — os dois campos
    //    divergirem é o comportamento correto deles, não defeito.
    if (pc > 0 && change !== null && String(type).toUpperCase() !== 'CRYPTO') {
        const declarado = Number(change);
        const implicito = movePct(p, pc);
        if (Number.isFinite(declarado) && Math.abs(declarado - implicito) > CHANGE_MISMATCH_PP) {
            achados.push({
                code: 'VARIACAO_INCOERENTE',
                detail: `a fonte declara ${fmt(declarado)}% mas os preços dela implicam `
                    + `${fmt(implicito)}% (${fmt(pc)} → ${fmt(p)})`,
                movePct: implicito,
            });
        }
    }

    return achados;
};

/**
 * Achados que contestam a VARIAÇÃO, e não só o preço.
 *
 * `SALTO_VS_BANCO` fica de fora de propósito: ali quem está sob suspeita é o
 * preço novo, e o `previousClose` da fonte continua sendo o melhor palpite de
 * fechamento anterior que existe. Os outros dois dizem, cada um à sua maneira,
 * que o par (variação, fechamento anterior) daquela resposta não fecha conta.
 */
const CONTESTED_CHANGE_CODES = new Set(['SALTO_NA_FONTE', 'VARIACAO_INCOERENTE']);

/** A fonte se contradisse sobre a variação deste ativo? */
export const contestsChange = (findings = []) => findings.some((f) => CONTESTED_CHANGE_CODES.has(f.code));

/** Este julgamento precisa do nosso candle para ser concluído? */
export const needsOwnAnchor = (findings = []) =>
    contestsChange(findings) || findings.some((f) => f.code === 'SALTO_VS_BANCO');

/**
 * ── QUEM ESTÁ ERRADO: O PREÇO NOVO OU O GUARDADO? ───────────────────────────
 *
 * `SALTO_VS_BANCO` compara dois números e escreve a frase como se o NOVO fosse o
 * suspeito. Em 07/09/2026, nos dois casos que a lista trouxe, era o contrário:
 *
 *   - **RBRL11** — acusado de +26,45% saindo de 58,45. Os 400 candles nossos vão
 *     de 60,59 (mínimo histórico, fev/2025) a 73,91, e 58,45 não aparece em
 *     nenhum deles: é o preço do RBHG11, outro FII. O 58,45 é que era o intruso.
 *   - **STX** — acusado de +306.168% saindo de 0,28. O 0,28 era o Stacks; a série
 *     sempre foi da Seagate (798,61 · 808,53 · 849,28).
 *
 * Nos dois o alarme apontou para o número certo e deixou o errado passar como
 * régua. E o árbitro estava em casa o tempo todo: a NOSSA série de candles, que
 * é a mesma fonte que o snapshot diário usa para marcar patrimônio
 * (`utils/dayCloses.js`). Se ela endossa o preço novo e repudia o guardado, o
 * caso está resolvido — não é um preço a investigar, é um preço a corrigir, e
 * ele já vai ser corrigido pela própria gravação.
 *
 * Inconclusivo quando os dois estão perto (não havia salto de verdade) ou os
 * dois estão longe (o candle também é velho, e aí não há árbitro). Nesses casos
 * devolve `null` e o achado segue como estava: acusar sem prova é o que se está
 * tentando evitar, e isso vale para os dois lados.
 *
 * @param {object} entrada
 * @param {string} entrada.type classe do ativo
 * @param {number} entrada.price preço que acabou de chegar
 * @param {number} entrada.storedPrice `lastPrice` que estava no banco
 * @param {number|null} [entrada.ownClose] nosso fechamento ANTES desta sessão
 * @returns {'NOVO_CONFIRMADO'|'GUARDADO_CONFIRMADO'|null}
 */
export const arbitrateStoredJump = ({ type, price, storedPrice, ownClose = null } = {}) => {
    const base = Number(ownClose);
    const novo = Number(price);
    const guardado = Number(storedPrice);
    if (!(base > 0) || !(novo > 0) || !(guardado > 0)) return null;

    // Cada distância é medida com a régua do SEU denominador — o candle é a base
    // comum, então as duas usam o mesmo limite; explicitar evita que uma mudança
    // futura em `effectiveMoveLimit` desalinhe os dois lados da comparação.
    const limite = effectiveMoveLimit(type, base);
    const pertoDoNovo = Math.abs(movePct(novo, base)) <= limite;
    const pertoDoGuardado = Math.abs(movePct(guardado, base)) <= limite;

    if (pertoDoNovo && !pertoDoGuardado) return 'NOVO_CONFIRMADO';
    if (pertoDoGuardado && !pertoDoNovo) return 'GUARDADO_CONFIRMADO';
    return null;
};

/**
 * Reescreve o achado de salto contra o banco à luz do veredito da nossa série.
 *
 * Devolve uma LISTA NOVA (a original é do juiz puro e não se altera). O achado
 * ganha `arbitration` — que a tela usa para decidir se aquilo ainda é pergunta
 * aberta — e um `detail` que diz o que a série provou, em vez de só apontar a
 * distância entre dois números.
 *
 * @param {Array} findings achados de `judgeQuote`
 * @param {object} entrada
 * @param {'NOVO_CONFIRMADO'|'GUARDADO_CONFIRMADO'|null} entrada.verdict
 * @param {number|null} [entrada.ownClose] fechamento nosso que serviu de árbitro
 * @param {string|null} [entrada.ownCloseDate] data desse fechamento
 * @returns {Array} achados, com o de banco anotado quando houve veredito
 */
export const applyStoredJumpArbitration = (findings = [], { verdict, ownClose = null, ownCloseDate = null } = {}) => {
    if (!verdict) return findings;
    return findings.map((f) => {
        if (f.code !== 'SALTO_VS_BANCO') return f;
        const ancora = `nosso fechamento de ${ownCloseDate || 'antes da sessão'} (${fmt(Number(ownClose))})`;
        return {
            ...f,
            arbitration: verdict,
            detail: verdict === 'NOVO_CONFIRMADO'
                ? `${f.detail} — ${ancora} confirma o preço NOVO: quem estava errado era o guardado`
                : `${f.detail} — ${ancora} confirma o preço GUARDADO: o número novo é que destoa`,
        };
    });
};

/**
 * O julgamento ainda é uma pergunta em aberto para o dono?
 *
 * `NOVO_CONFIRMADO` não é: o preço bom acabou de entrar e a própria gravação
 * fecha o caso. Fica de fora da contagem do painel para a lista não acumular
 * incidentes já resolvidos — que é como um alarme perde a credibilidade.
 */
export const isSettledFinding = (finding) => finding?.arbitration === 'NOVO_CONFIRMADO';

/**
 * A VARIAÇÃO QUANDO A FONTE NÃO MERECE FÉ.
 *
 * Medido em 05/09/2026: XPIN11 estava gravado com `change` de +108% e
 * `previousClose` de 29,82 enquanto a NOSSA série de candles mostrava 62,04
 * parado havia semanas. O preço estava certo (bate com o fechamento oficial da
 * B3 dentro de 1%); o par variação/fechamento-anterior é que era lixo. Servido
 * assim, ele vira "variação de hoje" na carteira e no ranking.
 *
 * A âncora honesta nesse caso é o nosso próprio fechamento gravado, e não a
 * memória do provedor — é a MESMA fonte que o snapshot diário usa para marcar
 * patrimônio (`utils/dayCloses.js`), então usar outra aqui seria reintroduzir a
 * divergência que aquele módulo existe para fechar.
 *
 * Sem candle nosso, a resposta é ZERO — e zero aqui significa "não temos
 * variação corroborada", que é o que o resto do sistema já entende por variação
 * ausente (o fallback de candle do Yahoo faz o mesmo quando só há uma barra na
 * janela). Repetir o número da fonte seria afirmar o que acabamos de contestar.
 *
 * @param {object} entrada
 * @param {number} entrada.price preço que será gravado
 * @param {number|null} [entrada.ownClose] nosso último fechamento ANTES da sessão
 * @returns {{change: number, previousClose: number}} o par a gravar
 */
export const resolveContestedChange = ({ price, ownClose = null }) => {
    const base = Number(ownClose);
    const p = Number(price);
    if (!(base > 0) || !(p > 0)) return { change: 0, previousClose: 0 };
    const pct = movePct(p, base);
    // Ruído de ponto flutuante vira ZERO, e não um zero com sinal. O candle é
    // gravado com a precisão que o provedor manda (62,040000915527344 para um
    // preço de 62,04), então preço parado dá -0,0000015% — que a tela arredonda
    // para "-0,00%". O sinal de menos sugere uma queda que não houve, e é a
    // primeira coisa que alguém pergunta ao ler o painel. Abaixo da casa que o
    // produto exibe não há variação a afirmar.
    return { change: Math.abs(pct) < 0.005 ? 0 : pct, previousClose: base };
};

/** Rótulos de tela, em português de dono. A tela não conhece os códigos. */
export const SUSPECT_LABEL = {
    SALTO_NA_FONTE: 'Salto fora do normal',
    SALTO_VS_BANCO: 'Preço distante do que tínhamos',
    VARIACAO_INCOERENTE: 'Variação não bate com o preço',
};

/** Rótulos do veredito da nossa série, quando ela conseguiu desempatar. */
export const ARBITRATION_LABEL = {
    NOVO_CONFIRMADO: 'Corrigido — o errado era o preço guardado',
    GUARDADO_CONFIRMADO: 'Nossa série não confirma o preço novo',
};
