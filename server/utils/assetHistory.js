/**
 * Identidade persistida de uma série histórica.
 *
 * O ticker canônico da carteira não é suficiente para identificar a série no
 * provedor: `BTC` é simultaneamente a criptomoeda Bitcoin (`BTC-USD` no Yahoo)
 * e um ativo listado nos EUA. Namespacing pelo símbolo do provedor evita que o
 * worker de uma classe sobrescreva candles de outra.
 */
export const historyStorageKey = (ticker, type = 'INDEX') => {
    const clean = String(ticker || '').trim().toUpperCase().replace(/\.SA$/, '');
    const normalizedType = String(type || 'INDEX').trim().toUpperCase();
    if (!clean) return '';

    if (normalizedType === 'CRYPTO') {
        return clean.endsWith('-USD') ? clean : `${clean}-USD`;
    }

    return clean;
};

/**
 * Máximo drawdown (%) pico→vale de uma série, medido numa JANELA COMUM.
 *
 * A janela não é detalhe de implementação: o drawdown alimenta o eixo de
 * consistência dos motores âncora, que compara ativos numa lista única. Medir
 * cada um na série inteira compara janelas de tamanhos diferentes, e o número
 * deixa de dizer "quem caiu mais" para dizer "quem tem série mais longa".
 *
 * E a desigualdade de profundidade é PERMANENTE, não uma fila que se esvazia:
 * o `timeSeriesWorker` grava `slice(-ASSET_HISTORY_MAX_POINTS)`, mas
 * `walletDayCandleService` grava `slice(-max(CAP, existente))` — uma catraca que
 * nunca encurta — porque o rebuild da carteira precisa alcançar a data da
 * primeira compra. Resultado medido em 22/08/2026: os 14 tickers de renda
 * variável em carteira têm série funda (1638–1653 candles), TODOS eles, contra
 * 400 do resto do universo. Enquanto a Itaúsa estiver na carteira do dono, a
 * série dela vai ser mais funda que a dos pares — e a janela dela alcançava o
 * crash de março/2020 que a janela dos pares nem enxergava:
 *
 *   ITSA4  série inteira 44,8%  ·  últimos 400 candles 17,7%
 *   CMIG4  série inteira 50,4%  ·  últimos 400 candles 25,1%
 *
 * Ou seja: truncar a janela na leitura é a correção definitiva, não um paliativo
 * até o banco "normalizar". Aparar as séries no banco seria a correção errada —
 * apagaria justamente a profundidade de que a carteira depende.
 *
 * Série que não cobre `drawdownMinCandles` vira AUSENTE (null), nunca nota: sem
 * esse piso, um ticker quase não observado exibiria um drawdown pequeno e a
 * ausência de dado viraria nota alta.
 *
 * @param {Array<{date?:string, close?:number, adjClose?:number}>} history série oldest→newest
 * @param {{drawdownWindowCandles:number, drawdownMinCandles:number}} options janela e piso de cobertura
 * @returns {number|null} drawdown em % com 1 casa, ou null quando não observado
 */
export const maxDrawdownPct = (history, { drawdownWindowCandles, drawdownMinCandles } = {}) => {
    const closes = (history || [])
        .slice(-drawdownWindowCandles)
        .map(point => Number(point.adjClose ?? point.close))
        .filter(Number.isFinite);
    if (!(closes.length >= drawdownMinCandles)) return null;
    let peak = closes[0];
    let worst = 0;
    for (const close of closes) {
        if (close > peak) peak = close;
        if (peak > 0) worst = Math.max(worst, (peak - close) / peak);
    }
    return Math.round(worst * 1000) / 10;
};
