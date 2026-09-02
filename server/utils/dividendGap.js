/**
 * Detecção de provento pelo GAP do dia-ex — a ponte sobre a defasagem da fonte.
 *
 * O provedor (Yahoo) publica o evento em `chart.events.dividends` de 1 a 3 dias
 * DEPOIS da data-ex (medido em 01/09/2026: TRXF11 ex=03/08 gravado 05/08; cinco
 * FIIs ex=03/08 gravados 06/08; em julho, ex=01/07 gravados só em 30/07). Nesse
 * intervalo a carteira registra a QUEDA de preço do dia-ex sem o crédito que a
 * compensa: em 01/09/2026 foram R$ 5,30 de renda invisível numa carteira de
 * R$ 22 mil — o dia aparecia como +R$ 0,83 quando fora ~+R$ 6,1.
 *
 * O sinal para fechar esse vão já chega na mesma resposta, e chega NO DIA:
 *
 *   - `AssetHistory.close`      → fechamento BRUTO, como negociado. O provedor
 *                                 nunca o reajusta retroativamente (verificado:
 *                                 31/07/2026 seguia 91,10 depois do ex de 03/08).
 *   - `quote.previousClose`     → o MESMO fechamento, já AJUSTADO pelo provento.
 *
 * bruto − ajustado = provento por cota, disponível na sessão do próprio dia-ex.
 * Medido contra os proventos reais de agosto/2026: TRXF11 0,9300 (real 0,93),
 * KNCR11 1,2500 (real 1,25) — exato, não aproximado.
 *
 * Por que não usar `adjclose` do chart: ele carrega a MESMA defasagem dos
 * eventos (em 01/09 marcava delta 0,0000 sobre 31/08). Só a cotação está fresca.
 *
 * O evento derivado é PROVISÓRIO (`source: 'DERIVED'`). Quando o provedor
 * publica o oficial, o índice único {ticker, date, type} faz os dois colapsarem
 * no mesmo documento e o valor autoritativo prevalece — ver
 * `financialService.syncDividends`, que também remove o provisório caso a
 * data-ex oficial saia deslocada da que derivamos.
 */

/** Classes que pagam provento em dinheiro. Cripto/RF/caixa nunca entram. */
const DERIVABLE_TYPES = new Set(['STOCK', 'FII', 'ETF', 'STOCK_US', 'REIT']);

/** Abaixo de um centavo por cota é ruído de arredondamento, não provento. */
const MIN_GAP = 0.01;

/**
 * Teto de 10% do preço. O gap do `previousClose` também aparece em SPLIT e
 * BONIFICAÇÃO — que mudam a quantidade, não geram renda, e viriam aqui como um
 * "provento" gigante. Desdobramentos ficam muito acima de 10%; proventos de
 * verdade, muito abaixo (FII mensal ~0,5–1,5%; PETR4 em 24/08/2026 pagou 3,0%).
 * Fail-closed de propósito: barrar um provento legítimo apenas adia o crédito
 * até o provedor publicar — que é exatamente o comportamento de hoje. Deixar
 * passar um split inventa renda que nunca existiu.
 */
const MAX_GAP_RATIO = 0.10;

/** Um provento fora dessa faixa em torno da mediana histórica não é crível. */
const PLAUSIBILITY_MAX_MULTIPLE = 4;
const PLAUSIBILITY_MIN_DIVISOR = 10;

/**
 * 4 casas. O fechamento vem do provedor em float32 (18,69 chega como
 * 18.690000534057617) e a subtração herda esse resíduo — sem o corte, um
 * provento de R$ 1,00 seria gravado como 1.000003. Quatro casas absorvem o erro
 * do float32 e ainda guardam mais precisão do que qualquer provento por cota
 * exige; o valor oficial substitui este assim que a fonte publica.
 */
const roundGap = (n) => Math.round(Number(n) * 1e4) / 1e4;

const median = (values) => {
    const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/**
 * Deriva o provento por cota do gap do dia-ex, ou `null` quando qualquer trava
 * não fecha. Função pura — toda a I/O fica no chamador.
 *
 * @param {object}   p
 * @param {string}   p.type              classe do ativo (STOCK/FII/ETF/…)
 * @param {number}   p.rawPrevClose      fechamento BRUTO da sessão anterior (nosso candle)
 * @param {number}   p.adjustedPrevClose `previousClose` da cotação (ajustado pelo provedor)
 * @param {string}   p.priceDate         dia BR da sessão da cotação (YYYY-MM-DD) → vira a data-ex
 * @param {string}   p.rawPrevCloseDate  dia do candle bruto (YYYY-MM-DD)
 * @param {number[]} [p.knownAmounts]    proventos por cota já conhecidos do ticker
 * @returns {{amount: number, exDate: string, ratio: number} | null}
 */
export const deriveDividendFromGap = ({
    type,
    rawPrevClose,
    adjustedPrevClose,
    priceDate,
    rawPrevCloseDate,
    knownAmounts = [],
}) => {
    if (!DERIVABLE_TYPES.has(String(type || '').toUpperCase())) return null;

    const raw = Number(rawPrevClose);
    const adjusted = Number(adjustedPrevClose);
    if (!Number.isFinite(raw) || !Number.isFinite(adjusted) || raw <= 0 || adjusted <= 0) return null;

    // O candle precisa ser de uma sessão ANTERIOR à da cotação. Comparar o
    // fechamento bruto de hoje com o previousClose de hoje mede coisa nenhuma.
    if (!priceDate || !rawPrevCloseDate || !(rawPrevCloseDate < priceDate)) return null;

    const gap = roundGap(raw - adjusted);
    if (!(gap >= MIN_GAP)) return null;

    const ratio = gap / raw;
    if (!(ratio <= MAX_GAP_RATIO)) return null;

    // Plausibilidade contra o histórico do próprio ticker. Com menos de 3
    // pagamentos conhecidos não há mediana confiável e o teto de 10% responde
    // sozinho — é o caso de um pagador estreante, que não deve ficar de fora.
    const reference = knownAmounts.length >= 3 ? median(knownAmounts) : null;
    if (reference !== null) {
        if (gap > reference * PLAUSIBILITY_MAX_MULTIPLE) return null;
        if (gap < reference / PLAUSIBILITY_MIN_DIVISOR) return null;
    }

    return { amount: gap, exDate: priceDate, ratio };
};

export const DIVIDEND_GAP_LIMITS = {
    MIN_GAP,
    MAX_GAP_RATIO,
    PLAUSIBILITY_MAX_MULTIPLE,
    PLAUSIBILITY_MIN_DIVISOR,
};

/**
 * Janela em que um provento provisório e um oficial são considerados o MESMO
 * pagamento. A data-ex derivada é o dia em que o gap apareceu; a fonte às vezes
 * publica o oficial com 1-2 dias de deslocamento. Sem essa tolerância os dois
 * documentos coexistiriam e o pagamento seria contado duas vezes.
 */
export const DERIVED_RECONCILE_WINDOW_MS = 4 * 86400000;
