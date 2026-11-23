import logger from '../../config/logger.js';
import { isB3Coverable } from '../b3HistoryFallback.js';
import { recordEscalation } from '../../utils/sourceHealth.js';

/**
 * O QUE O CAMINHO DO CANDLE EM CARTEIRA CONTA DEPOIS DE BUSCAR — ledger do painel
 * de fontes e linhas de log. Separado de `walletDayCandleService` porque não busca
 * nem grava nada: só relata o desfecho que a busca já decidiu.
 */

/**
 * O CAMINHO DE CADA ATIVO, para o painel de fontes.
 *
 * A lista de `unresolved` já era escrita no log, e log ninguém relê. No painel
 * ela responde a pergunta que a linha do bloco "Histórico e índices" não
 * tinha: a B3 aparecia verde, chamada há horas, sem que nada dissesse QUAIS
 * ativos ela socorreu — nem quais ficaram sem fechamento nenhum, que é o
 * conjunto com consequência (o patrimônio deles é marcado pelo preço das
 * 23:59 em vez do fechamento).
 *
 * Quem a B3 não cobre (cripto, ativo americano) entra com a trilha de um elo
 * só: aqui, ao contrário do worker do universo, isso é notícia — a carteira é
 * pequena e o ativo sem fechamento do dia degrada o snapshot daquele dia.
 *
 * @param {Array<{ticker:string,type:string,reason:string}>} unresolved quem o Yahoo não entregou
 * @param {{recuperados:Set<string>, semNegocio:Set<string>}} b3 desfecho do reforço da B3
 * @param {string} dayStr o pregão de que cada linha fala
 */
export const recordDayCandleChain = (unresolved, { recuperados, semNegocio }, dayStr) => {
    for (const alvo of unresolved) {
        const semNegocioNoDia = semNegocio.has(alvo.ticker);
        recordEscalation({
            chain: 'candle',
            subject: alvo.ticker,
            // A mesma régua de cobertura que o reforço da B3 usa para escolher os
            // alvos — importada, não recopiada: trilha que discorda de quem foi
            // chamado de verdade é pior que trilha nenhuma.
            tried: isB3Coverable(alvo.ticker, alvo.type) ? ['yahoo.history', 'b3'] : ['yahoo.history'],
            resolvedBy: recuperados.has(alvo.ticker) ? 'b3' : null,
            // Quando a B3 confirma que não houve negócio, o motivo do Yahoo ("não
            // trouxe o candle") descreve o sintoma; o fato é o papel não ter
            // negociado, e é ele que decide se isto merece atenção.
            reason: semNegocioNoDia
                ? `O papel não negociou em ${dayStr} — ausente também no arquivo oficial da B3`
                : alvo.reason,
            expected: semNegocioNoDia,
            // O PREGÃO DE QUE ESTA LINHA FALA, e aqui ele é defesa.
            //
            // A varredura do universo (`recoverUniverseTipWithB3`) sobrescreve a
            // linha deste mesmo ticker para curar o vermelho, e ela não consulta o
            // Yahoo — então declara o elo como "não consultado". Aqui o Yahoo FOI
            // chamado, ativo por ativo, e não trouxe o candle: é medição, não
            // suposição. Sem datar a linha, a herança lá não reconhece o pregão e
            // a medição se perde na primeira varredura que passar.
            session: dayStr,
        });
    }
};

/**
 * Resumo do run do candle do dia.
 *
 * @param {{dayStr:string, pending:number, fetched:number, recuperados:Set<string>, semCandle:Array}} outcome
 */
export const logDayCandleOutcome = ({ dayStr, pending, fetched, recuperados, semCandle }) => {
    logger.info('[DayCandle] Candles do dia garantidos para ativos em carteira', {
        day: dayStr,
        pending,
        fetched,
        recoveredFromB3: recuperados.size,
        missing: semCandle.length,
    });
    if (recuperados.size > 0) {
        logger.info('[DayCandle] Fechamento oficial da B3 cobriu a lacuna do Yahoo', {
            day: dayStr, assets: [...recuperados],
        });
    }
    // Cada ativo aqui teve o patrimônio marcado pelo preço das 23:59 em vez do
    // fechamento, e é este o conjunto que a sentinela vai acusar amanhã. Sem os
    // NOMES e o MOTIVO, o alarme obriga a refazer à mão a ida ao Mongo e à fonte
    // que já foi feita uma vez — foi o custo de diagnosticar BOVA11/IVVB11 em
    // 28/08/2026. Warn, e não info: o snapshot do dia saiu degradado.
    if (semCandle.length > 0) {
        logger.warn('[DayCandle] Ativos em carteira sem candle do dia — snapshot cai no preço corrente', {
            day: dayStr,
            missing: semCandle.length,
            assets: semCandle.map((u) => `${u.ticker}: ${u.reason}`),
        });
    }
};

const describeDaysByKey = (porChave) => [...porChave].map(([chave, dias]) => `${chave}: ${dias.join(', ')}`);

/**
 * Resumo da varredura de lacuna.
 *
 * @param {string} throughDay último dia da janela
 * @param {Map<string,string[]>} recuperados chave → dias fechados pela B3
 * @param {Map<string,string[]>} faltantesPorChave chave → dias que faltavam
 */
export const logGapHealOutcome = (throughDay, recuperados, faltantesPorChave) => {
    if (recuperados.size > 0) {
        logger.info('[DayCandle] Lacuna da janela fechada pelo fechamento oficial da B3', {
            throughDay,
            assets: describeDaysByKey(recuperados),
        });
        return;
    }
    // Sem isto, "a lacuna existe e nada foi feito" fica indistinguível de
    // "não havia lacuna" — que foi o buraco de diagnóstico de 03/09/2026.
    logger.info('[DayCandle] Lacuna na janela sem cobertura no arquivo da B3', {
        throughDay,
        assets: describeDaysByKey(faltantesPorChave),
    });
};
