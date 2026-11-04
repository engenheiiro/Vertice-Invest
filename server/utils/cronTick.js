/**
 * No máximo uma execução por minuto de relógio.
 *
 * Par obrigatório de `recoverMissedExecutions: true` no node-cron 3. A opção
 * recupera o disparo perdido, mas a biblioteca compara a data com milissegundos
 * contra a última execução já zerada, e a passada seguinte reconhece o mesmo minuto
 * como inédito: sozinha, a opção roda TODO job duas vezes, com 1s de intervalo.
 *
 * O relógio de parede, e não a data do disparo, também limita a recuperação depois
 * de uma pausa longa do processo: os minutos atrasados chegam todos na mesma passada
 * e viram uma execução só, em vez de uma rajada.
 *
 * Só serve para expressão com resolução de minuto, que é o caso de todos os crons
 * do scheduler.
 */
export const oncePerMinute = (fn, clock = Date.now) => {
    let ultimoMinuto = null;
    return (...args) => {
        const minuto = Math.floor(clock() / 60000);
        if (minuto === ultimoMinuto) return undefined;
        ultimoMinuto = minuto;
        return fn(...args);
    };
};
