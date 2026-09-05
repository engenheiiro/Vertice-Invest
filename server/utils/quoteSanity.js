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

const limitFor = (type) => MOVE_LIMIT_PCT[String(type || '').toUpperCase()] ?? DEFAULT_MOVE_LIMIT_PCT;

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
    now = new Date(),
} = {}) => {
    const achados = [];
    const p = Number(price);
    if (!(p > 0)) return achados; // preço ausente é outro assunto, e já tem dono

    const limite = limitFor(type);
    const pc = Number(previousClose);
    const guardado = Number(storedPrice);

    // 1. SALTO CONTRA O PRÓPRIO FECHAMENTO ANTERIOR DA FONTE.
    //    A comparação mais forte que existe: os dois números saíram da MESMA
    //    resposta, então nem defasagem nossa nem cache explicam a distância.
    if (pc > 0) {
        const delta = movePct(p, pc);
        if (Math.abs(delta) > limite) {
            achados.push({
                code: 'SALTO_NA_FONTE',
                detail: `${fmt(delta)}% contra o fechamento anterior da própria fonte `
                    + `(${fmt(pc)} → ${fmt(p)}), acima dos ${limite}% previstos para ${type || 'a classe'}`,
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
        const delta = movePct(p, guardado);
        if (Math.abs(delta) > limite) {
            achados.push({
                code: 'SALTO_VS_BANCO',
                detail: `${fmt(delta)}% contra o preço que tínhamos de ${storedPriceDate} `
                    + `(${fmt(guardado)} → ${fmt(p)})`,
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
    return { change: movePct(p, base), previousClose: base };
};

/** Rótulos de tela, em português de dono. A tela não conhece os códigos. */
export const SUSPECT_LABEL = {
    SALTO_NA_FONTE: 'Salto fora do normal',
    SALTO_VS_BANCO: 'Preço distante do que tínhamos',
    VARIACAO_INCOERENTE: 'Variação não bate com o preço',
};
