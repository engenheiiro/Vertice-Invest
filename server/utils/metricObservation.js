/**
 * Mecanismo compartilhado de "métrica inaplicável = AUSENTE".
 *
 * O defeito que este módulo existe para impedir aparece sempre da mesma forma:
 * um campo que a fonte não publica chega como `0` (ou `NaN`, ou `undefined`) e o
 * scorer o lê como se fosse uma MEDIÇÃO. Numa escala `lowerBetter` isso vira nota
 * máxima ("dívida zero!"); numa `higherBetter`, nota zero ou penalidade. Os dois
 * casos já foram pagos em produção:
 *
 *  - FII (1c0c739): campo ausente virando nota máxima numa escala `lowerBetter`;
 *  - BANCO (este módulo): `debtToEquity = 0` — alavancagem que o banco simplesmente
 *    NÃO publica — valendo "Estrutura de Capital Excelente" no caminho cru, e a
 *    penalidade de "Alavancagem Elevada" no caminho preparado, onde o mesmo campo
 *    chega como `NaN`. O mesmo ticker tirava notas diferentes nos dois caminhos.
 *
 * A regra é única: ausente não é 0 nem 100 — é ausente. O peso da métrica ausente
 * é REDISTRIBUÍDO entre as que foram efetivamente observadas, e o ativo é julgado
 * pelo que dá para medir nele.
 *
 * Funções puras, sem dependência de classe de ativo: o caso dos FIIs (vacância
 * suja do Fundamentus) pode reusar `observedWeightedAverage` sem alteração.
 */

/**
 * Média ponderada apenas sobre as partes OBSERVADAS. O peso das ausentes é
 * redistribuído proporcionalmente entre as observadas.
 *
 * @param {Array<{metric: string, value: number|null|undefined, weight: number}>} parts
 * @returns {{score: number, observed: boolean, observedWeight: number, components: Array}}
 *   `observed: false` quando NADA foi medido (score 0 é então "sem informação",
 *   não "nota zero" — quem consome deve tratar o eixo inteiro como ausente).
 */
export const observedWeightedAverage = (parts) => {
    const observed = (parts || []).filter(p => Number.isFinite(p?.value) && Number(p.weight) > 0);
    const weight = observed.reduce((total, p) => total + Number(p.weight), 0);
    if (weight === 0) return { score: 0, observed: false, observedWeight: 0, components: [] };
    const totalWeight = (parts || []).reduce((total, p) => total + (Number(p?.weight) || 0), 0);
    return {
        score: observed.reduce((total, p) => total + p.value * Number(p.weight), 0) / weight,
        observed: true,
        observedWeight: totalWeight > 0 ? weight / totalWeight : 0,
        components: observed.map(p => ({
            metric: p.metric,
            value: p.value,
            effectiveWeight: Number((Number(p.weight) / weight).toFixed(3)),
        })),
    };
};

/** Açúcar sintático para montar as partes de `observedWeightedAverage`. */
export const observedPart = (metric, value, weight) => ({ metric, value, weight });

/**
 * Normaliza para `null` (AUSENTE) o que não é uma medição utilizável.
 * `NaN` entra aqui porque `applyArchetypeApplicability` usa NaN como marcador
 * transitório de N/A antes do scorer.
 */
export const asObservedNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};
