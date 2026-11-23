// Passos de retireStaleInactiveAssets: a aposentadoria automática (estado
// terminal, isBlacklisted) de quem atravessou a quarentena sem pregão.
import logger from '../../config/logger.js';
import { externalMarketService } from '../externalMarketService.js';

// Quarentena antes da APOSENTADORIA automática. Ficar inativo não tem custo de
// dado (o upsert só grava sucesso), mas tem custo de ruído: o loop de reativação
// re-cota todo inativo a cada run, e um papel que saiu da bolsa reaparece para
// sempre no warn "Yahoo falhou para N ativos" — em ago/2026 eram 27 tickers, com
// mortos de até 192 dias (BPAN4, CPLE5, MMC, HOLX…), sem caminho de saída porque
// a única baixa possível era manual e a guarda de porte mandava todo papel grande
// para uma "revisão manual" que nunca acontecia. 90 dias sem cotar em NENHUMA
// fonte não é mais provedor engasgado: instabilidade real dura dias (caso B3SA3),
// e o loop de reativação já teria recuperado o papel em qualquer run desse período.
export const RETIRE_AFTER_INACTIVE_DAYS = 90;
// Idade máxima do último candle para considerar que o papel ainda negocia (e,
// portanto, NÃO pode ser aposentado, por mais que o endpoint de cotação o ignore).
export const RETIRE_RECENT_CANDLE_DAYS = 10;

/** Dias inteiros desde `date` (null quando a data não existe). */
export const daysSince = (date) => (date ? Math.floor((Date.now() - new Date(date).getTime()) / 86400000) : null);

/** O relógio é a última PROVA DE PREGÃO, não o último toque no documento. */
export const pastQuarantine = (assets, idades) => assets.filter((a) => {
    const idade = idades.get(a.ticker);
    return (idade?.days ?? null) !== null && idade.days >= RETIRE_AFTER_INACTIVE_DAYS;
});

const describeNoMarket = (semMercado, mercado) => {
    const detalhe = semMercado
        .map((a) => `${a.ticker} (${mercado.get(a.ticker)?.traded}/${mercado.get(a.ticker)?.sessions})`)
        .join(', ');
    logger.warn(
        `🫥 [Reativação] ${semMercado.length} ativo(s) sem pregão há ${RETIRE_AFTER_INACTIVE_DAYS}d+ mas que nunca `
        + `tiveram mercado regular — fora da baixa automática, decidir a dedo: ${detalhe}`,
        { noRegularMarket: semMercado.map((a) => a.ticker) },
    );
};

/**
 * Papel que nunca teve mercado sai do automático e vai para a triagem a dedo,
 * com prova externa. Devolve null quando a medida falhou: fail-CLOSED, sem ela
 * não há como separar o liquidado do fundo de oferta restrita, e a baixa
 * automática espera a próxima rodada.
 */
export const keepRegularMarket = async (service, candidates) => {
    try {
        const mercado = await service.hadRegularMarketByTicker(candidates);
        const comMercado = candidates.filter((a) => mercado.get(a.ticker)?.regular);
        const semMercado = candidates.filter((a) => !mercado.get(a.ticker)?.regular);
        if (semMercado.length > 0) describeNoMarket(semMercado, mercado);
        return comMercado;
    } catch (error) {
        logger.warn(`[Reativação] Densidade de pregão indisponível (${error.message}); nenhuma baixa automática nesta rodada.`);
        return null;
    }
};

const lastTradedCandle = (candles) => (Array.isArray(candles)
    ? [...candles].reverse().find(c => c?.close > 0 && c?.volume !== 0)
    : null);

/**
 * Última prova antes da baixa: o endpoint de cotação e o de histórico do
 * Yahoo não cobrem o mesmo conjunto de papéis — um FII ilíquido pode não
 * devolver quote nenhum e mesmo assim ter candle de dois dias atrás.
 * Sessão recente = papel vivo: mantém inativo (o quote é que não o serve)
 * e NÃO aposenta. Histórico sem resposta conta como ausência de prova de
 * vida — o papel já falhou cotação nos 90 dias da quarentena, a baixa é
 * reversível (`retireDeadTickers.js --undo`) e o log nomeia quem saiu.
 *
 * SESSÃO, não barra: o exemplo que originou esta guarda era o próprio
 * HGPO11, e ele estava morto desde 25/05/2026. O "candle de dois dias
 * atrás" era continuação com volume 0 — a última prova antes da baixa
 * absolvia justamente quem ela existia para condenar.
 */
export const dropStillTrading = async (assets) => {
    const targets = [];
    for (const a of assets) {
        let candles = null;
        try {
            candles = await externalMarketService.getFullHistory(a.ticker, a.type);
        } catch { /* fonte fora → segue como "sem candle" e a baixa acontece */ }
        const last = lastTradedCandle(candles);
        const candleAge = last ? daysSince(last.date) : null;
        if (candleAge !== null && candleAge <= RETIRE_RECENT_CANDLE_DAYS) {
            logger.info(`↩️ [Reativação] ${a.ticker} segue negociando (candle de ${candleAge}d) — não aposenta, só não cota via quote.`);
            continue;
        }
        targets.push(a);
    }
    return targets;
};

export const retirementOps = (targets, idades, now) => targets.map(a => ({
    updateOne: {
        filter: { ticker: a.ticker, isBlacklisted: false },
        update: {
            $set: {
                isBlacklisted: true,
                // isActive junto, sempre. Aqui o candidato JÁ vem inativo, então
                // a linha é redundante no caminho feliz — e é exatamente por ser
                // redundante que ela precisa existir: o estado terminal fica
                // completo em uma escrita só, e não depende de quem chamou ter
                // deixado o documento no estado certo.
                isActive: false,
                retiredAt: now,
                retiredReason: `auto: ${idades.get(a.ticker)?.days}d sem pregão (${idades.get(a.ticker)?.basis}) e sem cotação em nenhuma fonte`,
            },
        },
    },
}));

export const logRetired = (targets, idades, held) => {
    const detail = targets.map(a => `${a.ticker} (${idades.get(a.ticker)?.days}d, ${idades.get(a.ticker)?.basis})`).join(', ');
    logger.info(
        `🪦 [Reativação] ${targets.length} ativo(s) aposentado(s) após ${RETIRE_AFTER_INACTIVE_DAYS}d sem pregão: ${detail}`,
        { retired: targets.map(a => a.ticker), quarantineDays: RETIRE_AFTER_INACTIVE_DAYS },
    );
    if (held.size > 0) {
        logger.warn(
            `⚠️ [Reativação] Sem cotação há ${RETIRE_AFTER_INACTIVE_DAYS}d+ mas detido(s) em carteira — `
            + `decidir a dedo: ${[...held].join(', ')}`,
        );
    }
};
