/**
 * Métricas de risco da carteira derivadas da série de cota (TWRR).
 *
 * Fonte ÚNICA de Sharpe e Beta. Tanto o KPI (`getWalletData`) quanto o gráfico
 * (`getWalletPerformance`) chamam daqui, então os dois lugares do app mostram o
 * MESMO número para a mesma carteira. Antes cada um montava a própria série: o
 * KPI sobre os últimos 30 snapshots e o /performance sobre o histórico inteiro —
 * coincidiam só enquanto a carteira tinha ≤ 30 snapshots e divergiam a partir do
 * 31º.
 *
 * Contrato: `sharpe`/`beta` são `null` quando NÃO SÃO CALCULÁVEIS, nunca 0 (ou 1,
 * no caso do beta). Zero é um Sharpe legítimo — usá-lo como sentinela de "sem
 * dado" fazia a UI esconder justamente a carteira que rende perto do CDI.
 *
 * Filosofia: na dúvida, NÃO PUBLICAR o número. Um Sharpe com margem de erro maior
 * que o próprio valor não informa nada, e exibido num badge limpo transmite uma
 * precisão que não existe.
 */
import { calculateBeta, calculateSharpeFromExcess, calculateStdDev } from './mathUtils.js';
import { countBusinessDays, toDateKey } from './dateUtils.js';
import { brazilDateOnly } from './fixedIncome.js';
import { cdiAnnualRateForYear } from '../config/financialConstants.js';

/** Pregões por ano — base da anualização (√252) e das janelas abaixo. */
const TRADING_DAYS_PER_YEAR = 252;

/**
 * Janela das métricas de risco, em snapshots (~1 ano de pregões). É uma métrica
 * ROLANTE, não desde o início: a composição da carteira muda com o tempo e uma
 * janela infinita mede um portfólio que já não existe.
 */
export const SHARPE_WINDOW_SNAPSHOTS = TRADING_DAYS_PER_YEAR + 1;

/**
 * Amostra MÍNIMA para publicar o indicador (~3 meses de pregões).
 *
 * Bem mais estrita que o piso de sanidade da fórmula (`MIN_SHARPE_OBSERVATIONS`,
 * 10 em mathUtils): aquele só evita divisão por ruído, este é POLÍTICA DE
 * PRODUTO. O erro-padrão do Sharpe anualizado é ≈ √(252/n) — com 29 observações
 * dá ±2,95, a ponto de um único dia virar o sinal do indicador. Com 60 cai para
 * ±2,05; com 252 (1 ano), ±1,00. Nem 60 é confortável, e é por isso que o nível
 * de confiança acompanha o número em vez de ficar implícito.
 */
export const MIN_SHARPE_SAMPLE = 60;

/** Amostras a partir das quais a estimativa deixa de ser francamente ruidosa. */
const MODERATE_CONFIDENCE_SAMPLE = Math.round(TRADING_DAYS_PER_YEAR / 2); // ~6 meses
const HIGH_CONFIDENCE_SAMPLE = TRADING_DAYS_PER_YEAR; // ~1 ano

export const SHARPE_CONFIDENCE = { LOW: 'LOW', MODERATE: 'MODERATE', HIGH: 'HIGH' };

/**
 * Fluxo (aporte ou resgate) que, sozinho, é grande o bastante para caracterizar
 * OUTRA carteira: 50% do patrimônio anterior.
 *
 * Proxy consciente. O snapshot guarda patrimônio e custo, não a alocação, então
 * não dá para detectar "mudou de composição" diretamente — um aporte proporcional
 * aos ativos existentes seria sinalizado sem ter mudado o perfil de risco. O erro
 * é DELIBERADAMENTE para o lado conservador: reiniciar a janela à toa esconde o
 * indicador, enquanto não reiniciar publica um número que mistura dois
 * portfólios diferentes.
 */
export const REGIME_BREAK_FLOW_RATIO = 0.5;

/** Motivos pelos quais a métrica não pôde ser calculada (diagnóstico). */
export const RISK_UNAVAILABLE = {
    INSUFFICIENT_SAMPLE: 'INSUFFICIENT_SAMPLE',
    ZERO_VOLATILITY: 'ZERO_VOLATILITY',
    NO_BENCHMARK: 'NO_BENCHMARK',
};

/**
 * Dia-calendário BR de um snapshot, em `YYYY-MM-DD`.
 *
 * O snapshot fecha às 23:59 BRT, que é 02:59 UTC do DIA SEGUINTE — uma chave
 * derivada direto do instante UTC (`toDateKey` cru) aponta para o pregão
 * seguinte. Exportado porque o gráfico de performance precisa da MESMA regra:
 * era por divergir dela que a série do Ibovespa vinha um dia adiantada.
 *
 * Resolve pelo instante e não pela coluna `dayKey` do snapshot: o model valida
 * que as duas concordam, então ler a coluna não acrescentaria correção — e
 * cobre de graça os registros legados sem ela e o ponto live.
 */
export const snapshotDayKey = (point) => toDateKey(brazilDateOnly(point?.date));

/**
 * Snapshots utilizáveis para risco, do mais antigo para o mais recente.
 * Descarta cota inválida, data inválida, patrimônio residual (≤ R$1 — mesmo
 * filtro do /performance, para que os dois caminhos vejam o MESMO conjunto) e o
 * ponto "live": este último é um fechamento PARCIAL do dia (intraday), não um
 * retorno diário, e entrava só no /performance.
 */
const orderedQuotaSnapshots = (snapshots) =>
    (Array.isArray(snapshots) ? snapshots : [])
        .filter((snap) => {
            if (!snap || snap.isLive) return false;
            const quota = Number(snap.quotaPrice);
            if (!Number.isFinite(quota) || quota <= 0) return false;
            // `> 1` e não `!(<= 1)`: patrimônio ausente vira NaN, e NaN <= 1 é
            // FALSO — o snapshot malformado passaria pelo filtro que existe
            // justamente para barrá-lo. (Hoje as duas queries já filtram no banco,
            // então isto é defesa em profundidade, não um bug ativo.)
            if (!(Number(snap.totalEquity) > 1)) return false;
            return !Number.isNaN(new Date(snap.date).getTime());
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date));

/**
 * Índice do último EVENTO DE REGIME dentro da série: o aporte/resgate a partir do
 * qual a carteira passa a ser outra coisa. A série de risco começa nesse ponto.
 *
 * Sem isso, uma carteira de R$368 que recebe R$20 mil (80% deles em reserva a
 * 100% CDI) tem o Sharpe calculado sobre a mistura dos dois regimes — na prática
 * medindo um portfólio que nunca existiu. O fluxo é lido pela variação do CUSTO
 * (`totalInvested`), que só muda com compra/venda, e não pela oscilação de preço.
 *
 * @returns {number} índice inicial da série (0 se não houve quebra)
 */
const lastRegimeBreakIndex = (ordered) => {
    let startIndex = 0;
    for (let i = 1; i < ordered.length; i++) {
        const previousEquity = Number(ordered[i - 1].totalEquity);
        if (!Number.isFinite(previousEquity) || previousEquity <= 0) continue;

        const flow = Math.abs(Number(ordered[i].totalInvested) - Number(ordered[i - 1].totalInvested));
        if (!Number.isFinite(flow)) continue;

        if (flow / previousEquity > REGIME_BREAK_FLOW_RATIO) startIndex = i;
    }
    return startIndex;
};

/**
 * Retornos DIÁRIOS da cota (%) a partir de uma série de snapshots.
 *
 * Só entram pares separados por EXATAMENTE 1 dia útil (`countBusinessDays` já
 * conhece feriados da B3, então fim de semana e feriado contam como 1). Se um
 * snapshot falhar — outage do scheduler, feriado não mapeado —, o par seguinte
 * cobre 2+ pregões e, tratado como se fosse diário, infla a volatilidade e
 * derruba o Sharpe sem que nada no cálculo perceba. Esses pares são DESCARTADOS
 * em vez de normalizados: dividir o retorno pelos dias suavizaria a série e
 * subestimaria o risco, que é o erro oposto e mais perigoso.
 *
 * Datas ancoradas no dia-calendário BR (`brazilDateOnly`): o snapshot é gravado
 * às 23:59 BRT (= 02:59 UTC do dia seguinte) e comparar instantes crus faria
 * cada sexta-feira parecer um sábado.
 *
 * `pairs` acompanha cada retorno com as chaves de dia BR do par, para que o beta
 * possa parear a série de mercado nas MESMAS datas.
 *
 * @returns {{ returns: number[], pairs: Array<{fromKey: string, toKey: string}>, skippedGaps: number }}
 */
export const buildDailyQuotaReturns = (snapshots) => {
    const ordered = orderedQuotaSnapshots(snapshots);
    const returns = [];
    const pairs = [];
    let skippedGaps = 0;

    for (let i = 1; i < ordered.length; i++) {
        const previousDay = brazilDateOnly(ordered[i - 1].date);
        const currentDay = brazilDateOnly(ordered[i].date);

        if (countBusinessDays(previousDay, currentDay) !== 1) {
            skippedGaps++;
            continue;
        }

        returns.push(((Number(ordered[i].quotaPrice) / Number(ordered[i - 1].quotaPrice)) - 1) * 100);
        pairs.push({
            fromKey: snapshotDayKey(ordered[i - 1]),
            toKey: snapshotDayKey(ordered[i]),
            date: currentDay,
        });
    }

    return { returns, pairs, skippedGaps };
};

/**
 * Série de risco pronta: janela rolante + corte no último evento de regime.
 * Compartilhada por Sharpe e Beta para que as duas métricas descrevam
 * exatamente o mesmo período — antes o beta usava o histórico inteiro (com o
 * ponto live) e o Sharpe uma janela curta, sem que nada justificasse a diferença.
 */
const buildRiskSeries = (snapshots) => {
    const windowed = orderedQuotaSnapshots(snapshots).slice(-SHARPE_WINDOW_SNAPSHOTS);
    const startIndex = lastRegimeBreakIndex(windowed);
    const regime = windowed.slice(startIndex);

    return {
        ...buildDailyQuotaReturns(regime),
        regimeBreakAt: startIndex > 0 ? toDateKey(brazilDateOnly(regime[0].date)) : null,
    };
};

/** Taxa livre de risco DIÁRIA (%) vigente na data — o CDI muda de ano para ano. */
const dailyRiskFreeForDate = (date, currentRate) => {
    const annual = cdiAnnualRateForYear(brazilDateOnly(date).getUTCFullYear(), {
        currentRate,
        // Ano recente ainda não mapeado em HISTORICAL_CDI_RATES: a taxa corrente
        // estima muito melhor do que o legado 10% da curva de benchmark.
        fallback: Number(currentRate) > 0 ? Number(currentRate) : 10.0,
    });
    return (Math.pow(1 + annual / 100, 1 / TRADING_DAYS_PER_YEAR) - 1) * 100;
};

/**
 * Erro-padrão do Sharpe anualizado (aproximação de Lo, 2002):
 * SE ≈ √((1 + SR²/2) / n), anualizado. Publicado junto com o valor porque, nas
 * amostras que uma carteira real tem, ele costuma ser da ordem do próprio
 * indicador — e essa é a informação que decide se o número vale alguma coisa.
 */
const sharpeStandardError = (sharpe, sample) => {
    const dailySharpe = sharpe / Math.sqrt(TRADING_DAYS_PER_YEAR);
    return Math.sqrt((1 + (dailySharpe ** 2) / 2) / sample) * Math.sqrt(TRADING_DAYS_PER_YEAR);
};

const confidenceForSample = (sample) => {
    if (sample >= HIGH_CONFIDENCE_SAMPLE) return SHARPE_CONFIDENCE.HIGH;
    if (sample >= MODERATE_CONFIDENCE_SAMPLE) return SHARPE_CONFIDENCE.MODERATE;
    return SHARPE_CONFIDENCE.LOW;
};

/**
 * Índice de Sharpe anualizado da carteira.
 *
 * @param {Array} snapshots snapshots em qualquer ordem (o ponto live é ignorado)
 * @param {number} riskFreeRate CDI anual corrente (%) — anos anteriores usam a taxa da época
 * @returns {{ sharpe: number|null, sample: number, skippedGaps: number,
 *             standardError: number|null, confidence: string|null,
 *             regimeBreakAt: string|null, reason: string|null }}
 */
export const computeQuotaSharpe = (snapshots, riskFreeRate) => {
    const { returns, pairs, skippedGaps, regimeBreakAt } = buildRiskSeries(snapshots);
    const sample = returns.length;
    const base = { sample, skippedGaps, regimeBreakAt, standardError: null, confidence: null };

    if (sample < MIN_SHARPE_SAMPLE) {
        return { ...base, sharpe: null, reason: RISK_UNAVAILABLE.INSUFFICIENT_SAMPLE };
    }

    // Risk-free da DATA de cada retorno, não a taxa de hoje aplicada ao passado.
    const excess = returns.map((r, i) => r - dailyRiskFreeForDate(pairs[i].date, riskFreeRate));

    // Volatilidade zero → divisão por zero. A fórmula devolveria 0, indistinguível
    // de um Sharpe neutro real; aqui vira "indisponível".
    if (calculateStdDev(excess) === 0) {
        return { ...base, sharpe: null, reason: RISK_UNAVAILABLE.ZERO_VOLATILITY };
    }

    const sharpe = calculateSharpeFromExcess(excess);

    return {
        ...base,
        sharpe,
        standardError: sharpeStandardError(sharpe, sample),
        confidence: confidenceForSample(sample),
        reason: null,
    };
};

/**
 * Beta da carteira contra um índice, sobre a MESMA série do Sharpe.
 *
 * Pares sem cotação do índice são descartados dos DOIS lados. O caminho antigo
 * repetia a última cotação conhecida quando faltava o dia, o que injetava um
 * retorno de mercado artificial (zero) na regressão e puxava o beta para baixo.
 *
 * @param {Array} snapshots snapshots em qualquer ordem
 * @param {(dayKey: string) => number|null|undefined} resolveIndexClose fechamento do índice no dia BR
 */
export const computeQuotaBeta = (snapshots, resolveIndexClose) => {
    const { returns, pairs, regimeBreakAt } = buildRiskSeries(snapshots);

    const walletReturns = [];
    const marketReturns = [];

    for (let i = 0; i < returns.length; i++) {
        const from = Number(resolveIndexClose?.(pairs[i].fromKey));
        const to = Number(resolveIndexClose?.(pairs[i].toKey));
        if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) continue;

        walletReturns.push(returns[i]);
        marketReturns.push(((to / from) - 1) * 100);
    }

    const sample = walletReturns.length;
    const base = { sample, regimeBreakAt };

    if (sample === 0) return { ...base, beta: null, reason: RISK_UNAVAILABLE.NO_BENCHMARK };
    if (sample < MIN_SHARPE_SAMPLE) return { ...base, beta: null, reason: RISK_UNAVAILABLE.INSUFFICIENT_SAMPLE };
    if (calculateStdDev(marketReturns) === 0) return { ...base, beta: null, reason: RISK_UNAVAILABLE.ZERO_VOLATILITY };

    return { ...base, beta: calculateBeta(walletReturns, marketReturns), reason: null };
};
