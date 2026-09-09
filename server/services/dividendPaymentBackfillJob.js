/**
 * O backfill de data de pagamento como JOB, e não como request longo.
 *
 * POR QUE A TROCA
 * A varredura faz uma requisição por ativo com pausa entre elas — minutos de
 * relógio. Enquanto ela era o corpo de um POST, duas coisas quebravam ao mesmo
 * tempo: a tela ficava com um spinner mudo do começo ao fim (nenhum progresso
 * atravessa uma resposta que ainda não terminou), e sair da página abortava o
 * fetch, dando a impressão de que o trabalho tinha parado — quando na verdade ele
 * continuava no servidor, sem ninguém para receber o resultado.
 *
 * COMO FICA
 * O POST dispara e responde na hora; o trabalho segue neste módulo e publica
 * progresso a cada ativo. A tela pergunta "como está?" por GET, quantas vezes
 * quiser, de qualquer aba — voltar para a página reencontra o job em andamento em
 * vez de recomeçar.
 *
 * ESTADO EM MEMÓRIA, DE PROPÓSITO
 * Um único processo executa e um único job roda por vez, então um objeto de módulo
 * responde a pergunta inteira. Reiniciar o servidor (nodemon salvando um arquivo)
 * perde o job — e isso é honesto: quem morreu foi o processo que fazia o trabalho,
 * não só o registro dele. Este botão é ferramenta de dev, disparada à mão e
 * acompanhada; guardar o progresso no banco só faria o registro sobreviver a quem
 * o produzia.
 */
import logger from '../config/logger.js';

const OCIOSO = 'IDLE';
const RODANDO = 'RUNNING';
const CONCLUIDO = 'DONE';
const ERRO = 'ERROR';

export const BACKFILL_STATUS = { OCIOSO, RODANDO, CONCLUIDO, ERRO };

let estado = {
    status: OCIOSO,
    iniciadoEm: null,
    atualizadoEm: null,
    terminadoEm: null,
    /** Ativos já visitados e total da fila — o par que vira a barra de progresso. */
    feitos: 0,
    total: 0,
    /** Último ativo consultado. É o que mostra que a fila anda, e não só o número. */
    ticker: null,
    /** Datas gravadas até agora. */
    preenchidos: 0,
    /** Resumo final, no mesmo formato que o POST devolvia antes. */
    stats: null,
    message: null,
    erro: null,
};

/** Cópia rasa: o chamador não escreve no estado do job. */
export const getBackfillState = () => ({ ...estado });

export const isBackfillRunning = () => estado.status === RODANDO;

/**
 * Dispara a varredura se não houver outra em andamento.
 *
 * @param {(opcoes: object) => Promise<object>} executar rotina do backfill
 * @param {(resumo: object) => {message: string, stats: object}} resumir formatação do resultado
 * @returns {{iniciado: boolean, estado: object}} `iniciado:false` quando já havia job rodando
 */
export const startBackfill = (executar, resumir) => {
    if (estado.status === RODANDO) return { iniciado: false, estado: getBackfillState() };

    estado = {
        status: RODANDO,
        iniciadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        terminadoEm: null,
        feitos: 0,
        total: 0,
        ticker: null,
        preenchidos: 0,
        stats: null,
        message: null,
        erro: null,
    };

    // Sem `await`: quem chamou responde ao HTTP agora. O erro é capturado aqui
    // dentro para não virar rejeição sem dono no processo.
    executar({
        onProgress: ({ i, total, ticker, resumo }) => {
            estado = {
                ...estado,
                feitos: i,
                total,
                ticker,
                preenchidos: resumo?.preenchidos ?? estado.preenchidos,
                atualizadoEm: new Date().toISOString(),
            };
        },
    })
        .then((resumo) => {
            const { message, stats } = resumir(resumo);
            estado = {
                ...estado,
                status: CONCLUIDO,
                terminadoEm: new Date().toISOString(),
                atualizadoEm: new Date().toISOString(),
                feitos: stats?.ativos ?? estado.feitos,
                total: stats?.ativos ?? estado.total,
                ticker: null,
                preenchidos: stats?.preenchidos ?? estado.preenchidos,
                stats,
                message,
            };
            logger.info('📅 [Admin] Backfill de data de pagamento concluído', {
                preenchidos: stats?.preenchidos, ativos: stats?.ativos,
            });
        })
        .catch((error) => {
            estado = {
                ...estado,
                status: ERRO,
                terminadoEm: new Date().toISOString(),
                atualizadoEm: new Date().toISOString(),
                ticker: null,
                erro: error.message,
                message: `Backfill interrompido: ${error.message}`,
            };
            logger.error('📅 [Admin] Backfill de data de pagamento falhou', { erro: error.message });
        });

    return { iniciado: true, estado: getBackfillState() };
};

/** Só para os testes: devolve o módulo ao estado de quem nunca rodou nada. */
export const __resetBackfillState = () => {
    estado = {
        status: OCIOSO, iniciadoEm: null, atualizadoEm: null, terminadoEm: null,
        feitos: 0, total: 0, ticker: null, preenchidos: 0, stats: null, message: null, erro: null,
    };
};
