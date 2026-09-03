/**
 * Catálogo dos jobs agendados + syncs manuais.
 *
 * Existe por um motivo específico: a AUSÊNCIA de execução não gera log, então um
 * cron que morreu (deploy que derrubou o scheduler, EXTERNAL_SCHEDULER mal
 * configurado, container hibernado no Render) passa despercebido para sempre.
 * `maxSilenceHours` transforma esse silêncio em alarme — a sentinela compara o
 * último `JobRun` gravado com o teto de silêncio tolerado de cada job.
 *
 * `maxSilenceHours` NÃO é o intervalo do cron: é o intervalo + folga suficiente
 * para não alarmar por fim de semana, feriado ou uma execução perdida. Jobs de
 * dia útil ganham folga de fim de semana prolongado (80h cobre sex→seg + feriado).
 *
 * `severity` define o peso da falha/silêncio: 'CRITICAL' derruba o painel inteiro
 * (dado que o produto usa fica errado), 'WARN' sinaliza sem alarmar.
 */

export const JOB_CATALOG = {
    'macro-sync': {
        label: 'Macroeconomia (15 min)',
        maxSilenceHours: 2,
        severity: 'CRITICAL',
    },
    'quotes-sync': {
        label: 'Cotações em tempo real (15 min)',
        maxSilenceHours: 2,
        severity: 'CRITICAL',
    },
    'radar-alpha': {
        label: 'Radar Alpha (15 min)',
        maxSilenceHours: 3,
        severity: 'WARN',
    },
    'backtest-intraday': {
        label: 'Backtest intraday (30 min)',
        maxSilenceHours: 3,
        severity: 'WARN',
    },
    'daily-morning': {
        label: 'Rotina diária — manhã (09:00)',
        maxSilenceHours: 30,
        severity: 'CRITICAL',
    },
    'daily-evening': {
        label: 'Rotina diária — pós-mercado (18:30)',
        maxSilenceHours: 30,
        severity: 'CRITICAL',
        // Desligado in-app quando EXTERNAL_SCHEDULER=true (roda como Render Cron Job).
        heavy: true,
    },
    'weekly-autopublish': {
        label: 'Auto-publish semanal (seg 09:30)',
        maxSilenceHours: 192, // 8 dias
        severity: 'WARN',
    },
    'monthly-anchor-publish': {
        label: 'Publicação da lista âncora Buy-and-Hold (dia 1, 07:30)',
        // 31 dias + 3 de folga. Um job MENSAL é o mais fácil de morrer sem que
        // ninguém note — o web service hiberna, o tick some, e a lista fica
        // parada até alguém reparar. Este teto é o que transforma o silêncio em
        // alarme. Não é heavy: ver o comentário do cron em schedulerService.js.
        maxSilenceHours: 816,
        severity: 'WARN',
    },
    'wallet-candle-recovery': {
        label: 'Recuperação do fechamento oficial (horária, 07:25–21:25)',
        // Data de entrada no catálogo. A sentinela conta a carência de "nunca
        // executado" a partir daqui — sem isso, todo job novo nasce em falha entre
        // o deploy e o primeiro tique dele.
        since: '2026-09-03',
        // Vão noturno: 21:25 → 07:25 do dia seguinte = 10h. 14h deixa folga para
        // uma execução perdida sem alarmar de madrugada.
        maxSilenceHours: 14,
        // WARN: o dano de uma parada aqui é o snapshot ficar marcado pelo preço
        // das 23:59 em vez do fechamento — degradação, não número errado na tela.
        severity: 'WARN',
    },
    'daily-snapshot': {
        label: 'Snapshot patrimonial (23:59)',
        maxSilenceHours: 30,
        severity: 'CRITICAL',
    },
    'subscriptions-check': {
        label: 'Verificação de assinaturas (03:00)',
        maxSilenceHours: 30,
        severity: 'WARN',
    },
    'dividends-sync': {
        label: 'Sync de proventos (04:00)',
        maxSilenceHours: 30,
        severity: 'WARN',
    },
    'holidays-sync': {
        label: 'Sync de feriados (anual)',
        monitored: false, // 1x/ano — silêncio é o estado normal
        severity: 'WARN',
    },
    'us-fundamentals': {
        label: 'Fundamentals S&P 500 (dias úteis 07:30)',
        maxSilenceHours: 80, // folga p/ fim de semana + feriado
        severity: 'WARN',
    },
    'fx-history': {
        label: 'Taxa USD/BRL histórica (19:45)',
        maxSilenceHours: 30,
        // CRITICAL: a série por data é o que converte posição dolarizada no
        // rebuild de histórico e no snapshot das 23:59. Parada, o resolver cai na
        // cotação de hoje para todo dia posterior ao último candle e a variação
        // cambial some da curva de patrimônio — e do TWRR/Sharpe que saem dela.
        severity: 'CRITICAL',
    },
    'assets-reactivation': {
        label: 'Reativação de ativos inativos (seg 05:00)',
        maxSilenceHours: 192,
        severity: 'WARN',
    },
    'storage-cleanup': {
        label: 'Limpeza de armazenamento (01:00)',
        maxSilenceHours: 30,
        severity: 'WARN',
    },
    'treasury-prices': {
        label: 'PU do Tesouro Direto (ter-sáb 12:30)',
        // Maior vão da grade: sábado 12:30 → terça 12:30 = 72h (a segunda não tem
        // rodada porque a sexta já entrou no sábado). 80h deixa 8h de folga.
        maxSilenceHours: 80,
        severity: 'CRITICAL', // marca a mercado a renda fixa do snapshot das 23:59
        heavy: true,
    },
    'lgpd-retention': {
        label: 'Retenção LGPD (02:30)',
        maxSilenceHours: 30,
        severity: 'WARN',
        heavy: true,
    },
    'data-health': {
        label: 'Sentinela de saúde dos dados (horária)',
        maxSilenceHours: 3,
        severity: 'WARN',
    },
    // Sync completo, seja qual for o gatilho (`npm run sync:prod`, botão do Admin
    // ou as rotinas diárias). Sem `maxSilenceHours`: o sync manual roda quando dá,
    // então silêncio aqui não é falha — a cobrança de periodicidade fica com
    // 'daily-morning'/'daily-evening'. Continua no painel com o último resultado,
    // que é o que interessa depois de rodar à mão.
    'full-sync': {
        label: 'Sync completo (manual + rotina)',
        monitored: false,
        severity: 'WARN',
    },
};

export const getJobMeta = (jobId) => JOB_CATALOG[jobId] || null;

export const getJobLabel = (jobId) => JOB_CATALOG[jobId]?.label || jobId;

/** Jobs que a sentinela cobra presença (exclui anuais e disparos manuais). */
export const monitoredJobIds = () =>
    Object.entries(JOB_CATALOG)
        .filter(([, meta]) => meta.monitored !== false && Number.isFinite(meta.maxSilenceHours))
        .map(([id]) => id);
