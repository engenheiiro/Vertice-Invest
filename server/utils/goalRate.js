/**
 * Taxa esperada das metas — de onde sai o "% a.a." que decide a data de chegada.
 *
 * O planejador projeta a meta com juros compostos sobre o patrimônio atual
 * (goalMath.monthsRemaining). Com R$ 46,6 mil parados e R$ 500/mês de aporte,
 * MAIS DA METADE do avanço projetado vem dessa taxa — ela não é um detalhe de
 * formulário, é metade da resposta. Até 08/09/2026 ela era um número digitado à
 * mão (default "10"), congelado na criação da meta e nunca mais revisitado; o
 * atalho "Minha carteira" do formulário piorava o quadro colando a rentabilidade
 * ACUMULADA da carteira (cota−1, seja ela de 2 meses ou de 5 anos) num campo que
 * significa "ao ano".
 *
 * Este módulo resolve as três perguntas separadamente:
 *   1. Quanto a carteira DEVE render, dado o que ela tem dentro? → suggestExpectedRate
 *   2. Quanto ela REALMENTE rendeu, em termos anuais? → annualizedWalletReturn
 *   3. A premissa salva na meta envelheceu? → rateDrift
 *
 * Nada aqui muda a taxa de ninguém sozinho: a taxa é premissa do usuário, e
 * mexer nela mexeria na data prevista sem ele pedir. O sistema sugere e avisa.
 *
 * Funções puras (server/tests/goal_rate.spec.js).
 */
import { safeFloat } from './mathUtils.js';
import {
    GOAL_PREMIUM_EQUITY,
    GOAL_PREMIUM_FII,
    GOAL_RATE_DRIFT_TOLERANCE_PP,
    GOAL_RATE_MIN_HISTORY_DAYS,
    GOAL_RATE_SANITY_CAP,
    DEFAULT_SELIC_FALLBACK,
    DEFAULT_NTNB_FALLBACK,
    DEFAULT_IPCA_FALLBACK,
} from '../config/financialConstants.js';

const MS_DAY = 24 * 60 * 60 * 1000;
const round1 = (n) => Math.round(safeFloat(n) * 10) / 10;

/**
 * Normaliza o bloco macro (SystemConfig MACRO_INDICATORS) com fallbacks
 * explícitos. `cdi` ausente cai na Selic — a diferença entre as duas é de
 * décimos, e uma meta sem taxa nenhuma é pior que uma meta com a Selic.
 */
export const resolveRateInputs = (macro = {}) => {
    const cdi = safeFloat(macro?.cdi) > 0 ? safeFloat(macro.cdi)
        : safeFloat(macro?.selic) > 0 ? safeFloat(macro.selic)
            : DEFAULT_SELIC_FALLBACK;
    const ipca = safeFloat(macro?.ipca) > 0 ? safeFloat(macro.ipca) : DEFAULT_IPCA_FALLBACK;
    const ntnbLong = safeFloat(macro?.ntnbLong) > 0 ? safeFloat(macro.ntnbLong) : DEFAULT_NTNB_FALLBACK;
    return { cdi, ipca, ntnbLong };
};

/**
 * Juro NOMINAL de longo prazo: a NTN-B longa é taxa REAL (IPCA+X), então o
 * nominal comparável é (1+real)(1+inflação)−1. Base sobre a qual os prêmios de
 * risco são somados — nenhuma classe de risco deveria ser projetada ABAIXO disto.
 */
export const nominalLongRate = ({ ntnbLong, ipca }) =>
    ((1 + safeFloat(ntnbLong) / 100) * (1 + safeFloat(ipca) / 100) - 1) * 100;

/**
 * Expectativa por classe de ativo (% a.a. nominal).
 *  - CASH/FIXED_INCOME: CDI. É onde o caixa e a reserva efetivamente rendem.
 *  - FII: nominal longo + prêmio menor (parte do retorno é aluguel contratado).
 *  - STOCK/STOCK_US/ETF: nominal longo + prêmio de renda variável.
 *  - CRYPTO: nominal longo, SEM prêmio. Não temos base para projetar prêmio de
 *    cripto, e projetar um transformaria a meta numa promessa que o app não pode
 *    sustentar. Classe desconhecida cai na mesma régua conservadora.
 * Ativo em dólar usa a mesma régua nominal em BRL — a projeção é em reais e não
 * modela câmbio futuro (premissa declarada, não esquecimento).
 */
export const expectedRateForType = (type, inputs) => {
    const floor = nominalLongRate(inputs);
    switch (String(type || '').toUpperCase()) {
        case 'CASH':
        case 'FIXED_INCOME':
            return inputs.cdi;
        case 'FII':
            return floor + GOAL_PREMIUM_FII;
        case 'STOCK':
        case 'STOCK_US':
        case 'ETF':
            return floor + GOAL_PREMIUM_EQUITY;
        default:
            return floor;
    }
};

/**
 * Taxa sugerida = média das expectativas por classe PONDERADA pelo valor de
 * mercado de cada classe na carteira. Carteira 90% em caixa sugere ~CDI;
 * carteira 90% em ações sugere o nominal longo + prêmio. É a mesma conta que um
 * alocador faz na mão, só que com as fontes vivas do sistema.
 *
 * @param {Record<string, number>} composition valor de mercado por `type`
 * @param {object} macro bloco MACRO_INDICATORS (cdi, ipca, ntnbLong)
 * @returns {{ rate: number, total: number, breakdown: Array, inputs: object }}
 */
export const suggestExpectedRate = (composition = {}, macro = {}) => {
    const inputs = resolveRateInputs(macro);
    const entries = Object.entries(composition || {})
        .map(([type, value]) => [type, safeFloat(value)])
        .filter(([, value]) => value > 0);
    const total = entries.reduce((sum, [, value]) => sum + value, 0);

    // Carteira vazia (meta que não espelha carteira, ou carteira zerada): sem
    // composição para ponderar, o CDI é a âncora honesta — é onde o dinheiro
    // fica enquanto não é investido.
    if (total <= 0) return { rate: round1(inputs.cdi), total: 0, breakdown: [], inputs };

    const breakdown = entries
        .map(([type, value]) => ({
            type,
            value,
            weight: value / total,
            rate: round1(expectedRateForType(type, inputs)),
        }))
        .sort((a, b) => b.value - a.value);

    const rate = breakdown.reduce((sum, b) => sum + b.weight * expectedRateForType(b.type, inputs), 0);
    return { rate: round1(rate), total, breakdown, inputs };
};

/**
 * Rentabilidade ACUMULADA → taxa ANUAL equivalente: (1+r)^(365/dias)−1.
 *
 * Este é o defeito que o módulo existe para matar: +12% em 62 dias NÃO é 12% ao
 * ano (é ~90%), e +96% em 5 anos NÃO é 96% ao ano (é ~14,4%). Sem anualizar, o
 * atalho do formulário injetava um número que só por coincidência tinha ordem de
 * grandeza plausível.
 *
 * Duas travas antes de devolver número:
 *  - janela mínima (`minDays`): anualizar um bimestre eleva o ruído do bimestre à
 *    sexta potência. Abaixo disso devolve `enough: false` e NENHUM valor.
 *  - teto de sanidade (`cap`): um ano excepcional não vira promessa perpétua.
 *
 * @returns {{ value: number|null, days: number, totalReturnPct: number, enough: boolean, capped: boolean }}
 */
export const annualizeReturn = (totalReturnPct, days, { minDays = GOAL_RATE_MIN_HISTORY_DAYS, cap = GOAL_RATE_SANITY_CAP } = {}) => {
    const totalReturn = safeFloat(totalReturnPct);
    const elapsed = safeFloat(days);
    const base = { value: null, days: elapsed, totalReturnPct: round1(totalReturn), enough: false, capped: false };

    // Entrada inválida é medida AUSENTE, não zero: `safeFloat(NaN)` devolve 0, e
    // sem esta trava um retorno indefinido viraria uma taxa de "0% a.a." de
    // aparência legítima — fail-open numa premissa que projeta data de meta.
    const finite = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
    if (!finite(totalReturnPct) || !finite(days)) return base;
    if (elapsed <= 0) return base;
    if (elapsed < safeFloat(minDays)) return base;
    if (totalReturn <= -100) return base; // carteira zerada: não há taxa que descreva isso

    const annual = (Math.pow(1 + totalReturn / 100, 365 / elapsed) - 1) * 100;
    if (!isFinite(annual)) return base;

    const capped = annual > safeFloat(cap);
    return {
        value: round1(capped ? safeFloat(cap) : annual),
        days: elapsed,
        totalReturnPct: round1(totalReturn),
        enough: true,
        capped,
    };
};

/**
 * Rentabilidade anualizada da carteira a partir da série de cotas (`quotaPrice`,
 * base 100) dos snapshots. Imune a aportes por construção — é a mesma cota do
 * TWRR da carteira, e por isso o número certo para virar premissa de projeção.
 * Snapshots em ordem CRONOLÓGICA.
 */
export const annualizedWalletReturn = (snapshots = [], opts = {}) => {
    const series = (snapshots || []).filter((s) => safeFloat(s?.quotaPrice) > 0 && s?.date);
    if (series.length < 2) return annualizeReturn(0, 0, opts);
    const first = series[0];
    const last = series[series.length - 1];
    const totalReturnPct = (safeFloat(last.quotaPrice) / safeFloat(first.quotaPrice) - 1) * 100;
    const days = (new Date(last.date).getTime() - new Date(first.date).getTime()) / MS_DAY;
    return annualizeReturn(totalReturnPct, days, opts);
};

/**
 * A premissa salva na meta ainda descreve a carteira de hoje? Compara a taxa da
 * meta com a sugerida e devolve a divergência em pontos percentuais. `stale` só
 * dispara acima da tolerância — juros mexem a cada Copom e um aviso a cada
 * décimo de ponto seria ruído.
 */
export const rateDrift = (goalRate, suggestedRate, tolerancePp = GOAL_RATE_DRIFT_TOLERANCE_PP) => {
    const deltaPp = round1(safeFloat(goalRate) - safeFloat(suggestedRate));
    return { deltaPp, stale: Math.abs(deltaPp) > safeFloat(tolerancePp) };
};
