/**
 * Leitura de `Promise.allSettled` com a rejeição REGISTRADA.
 *
 * Rotas que montam uma resposta a partir de várias buscas independentes usam
 * `allSettled` de propósito: se os proventos caem, a carteira ainda tem de
 * renderizar com o resto. A degradação graciosa está certa.
 *
 * O que não pode é ela ser MUDA. Ler `r.status === 'fulfilled' ? r.value : padrão`
 * descarta a rejeição sem deixar rastro: a busca falha, o usuário recebe números
 * piores, e nada em lugar nenhum diz que faltou dado — para sempre, a cada
 * requisição.
 *
 * Aconteceu no payload da carteira em 02/09/2026: uma promessa consumida duas
 * vezes (Query do Mongoose sem `.exec()`) rejeitava na segunda leitura, o
 * `allSettled` engolia, e `snapshots` chegava vazio. Sem snapshot não há âncora
 * de TWRR — a Rentabilidade Real virava ROI simples, o selo do card trocava
 * "Auditado" por "Estimado" e a Variação Hoje perdia o dia-âncora. O único
 * sintoma foi o selo, achado no olho.
 *
 * O leitor acumula as falhas em vez de logar uma por uma: quando o banco inteiro
 * está fora, sete linhas de log inundam justamente o momento em que ele mais
 * precisa ser legível. Uma linha, nomeando o que caiu.
 *
 * Uso:
 *
 *     const settled = createSettledReader();
 *     const config = settled.or(configR, null, 'macro');
 *     const snaps  = settled.or(snapshotsR, [], 'snapshots');
 *     if (settled.failures.length > 0) logger.warn('…', { failed: settled.failed(), … });
 */

/** Mensagem legível de uma rejeição, seja ela Error, string ou qualquer coisa. */
const reasonMessage = (reason) => {
    if (reason instanceof Error) return reason.message;
    if (reason === undefined) return 'undefined';
    if (reason === null) return 'null';
    if (typeof reason === 'string') return reason;
    try {
        return JSON.stringify(reason);
    } catch {
        return String(reason);
    }
};

export const createSettledReader = () => {
    const failures = [];

    return {
        failures,

        /**
         * Valor do resultado, ou `fallback` com a falha anotada sob `source`.
         * @param {PromiseSettledResult} result
         * @param {*} fallback valor de degradação
         * @param {string} source nome curto da busca (aparece no log)
         */
        or(result, fallback, source) {
            if (result && result.status === 'fulfilled') return result.value;
            failures.push({ source, error: reasonMessage(result?.reason) });
            return fallback;
        },

        /** Nomes do que falhou, prontos para grep numa linha de log. */
        failed() {
            return failures.map((f) => f.source).join(',');
        },
    };
};
