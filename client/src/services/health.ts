import { authService } from './auth';

/**
 * Painel de Saúde dos Dados (Admin).
 *
 * A leitura devolve o ÚLTIMO relatório persistido pela sentinela — nada é
 * recalculado ao abrir a tela. `runNow()` força o recálculo sob demanda.
 */

export type HealthStatus = 'OK' | 'WARN' | 'CRITICAL';

export interface HealthCheck {
    id: string;
    label: string;
    category: string;
    status: HealthStatus;
    value: number | null;
    detail: string;
    hint: string;
}

export interface HealthReport {
    runAt: string;
    status: HealthStatus;
    summary: { ok: number; warn: number; critical: number };
    checks: HealthCheck[];
    trigger?: string;
    durationMs?: number | null;
}

export interface HealthHistoryPoint {
    runAt: string;
    status: HealthStatus;
    summary: { ok: number; warn: number; critical: number };
    trigger?: string;
}

export interface JobStatus {
    jobId: string;
    label: string;
    severity: HealthStatus;
    maxSilenceHours: number | null;
    monitored: boolean;
    lastRunAt: string | null;
    lastStatus: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | null;
    lastError: string | null;
    lastDurationMs: number | null;
    runs24h: number;
    failures24h: number;
}

/**
 * Estado de uma fonte externa. `UNKNOWN` não é falha: o contador de chamadas vive
 * na memória do servidor e zera a cada reinício, então uma fonte que só roda no
 * sync diário fica legitimamente sem histórico por horas depois de um deploy.
 */
export type SourceStatus = 'OK' | 'WARN' | 'CRITICAL' | 'UNKNOWN';

/** Bloco do painel de fontes. A ordem vem do servidor — é decisão de produto. */
export interface SourceGroup {
    id: string;
    label: string;
    hint: string;
}

export interface DataSource {
    id: string;
    label: string;
    /** Nome curto para o card; o `label` completo aparece no detalhe. */
    short?: string;
    /** Posição na cadeia: 'Fonte principal', '3ª fonte (só Bitcoin)', 'Reserva'… */
    role?: string;
    /** Bloco a que pertence — casa com `SourceGroup.id`. */
    group?: string;
    /**
     * 'scheduled' tem hora marcada; 'onFailure' só é chamada quando a fonte
     * anterior da cadeia falha — nesta, ausência de chamadas é boa notícia.
     */
    trigger?: 'scheduled' | 'onFailure';
    /** Periodicidade em português: "A cada 15 minutos", "Todo dia às 09:00 e 18:30". */
    cadence?: string | null;
    /** Próximo disparo: "em 9 min", "hoje às 18:30". `null` para fonte de reserva. */
    nextRun?: string | null;
    /**
     * Cadeia de cobertura a que pertence e posição nela (1-based). `null` quando a
     * fonte não tem reserva. Não se deduz do bloco: um bloco pode juntar uma cadeia
     * e uma fonte independente, e desenhar seta entre elas seria mentira.
     */
    chain?: string | null;
    chainPosition?: number | null;
    chainSize?: number | null;
    /** Quem assume se esta falhar, na ordem de tentativa. Vazio = ponto único de falha. */
    backups?: string[];
    /** A fonte principal que esta cobre; `null` se ela própria for a principal. */
    covers?: string | null;
    /** Chamadas que trouxeram dado (o complemento de `failures`). */
    ok?: number;
    lastOkAt?: string | null;
    /** O que ela alimenta, em português de gente. Vai direto para a tela. */
    feeds: string;
    critical: boolean;
    status: SourceStatus;
    detail: string;
    /**
     * Por que a fonte está quieta, decidido no SERVIDOR. `null`/ausente quando
     * ela está sendo julgada pelas próprias chamadas. A tela escolhe a palavra
     * curta do rodapé a partir daqui — nunca rededuz o estado.
     */
    idleReason?: 'SKIPPED' | 'STANDBY' | 'DELIVERED_BEFORE_RESTART' | 'NOT_YET' | 'NO_LIVE_SUBJECT' | null;
    lastDeliveryAt: string | null;
    lastDeliveryHours: number | null;
    /**
     * Dá para medir a ENTREGA desta fonte, ou só a conectividade dela?
     * `false` = o painel não pode dizer "última entrega" sem inventar.
     * Opcional para o cliente sobreviver a um servidor mais antigo.
     */
    deliveryTracked?: boolean;
    /** Última chamada que VOLTOU com dado — conectividade, nunca entrega. */
    lastResponseAt?: string | null;
    lastResponseHours?: number | null;
    /** Chamadas que não foram feitas por decisão nossa (ex.: PTAX em feriado). */
    skipped?: number;
    lastSkipAt?: string | null;
    lastSkipReason?: string | null;
    attempts: number;
    failures: number;
    failureRate: number | null;
    lastError: string | null;
    lastFailAt: string | null;
    /**
     * Quantos ATIVOS passaram por esta fonte dentro da cadeia. `null` quando a
     * cadeia não tem registro por ativo — e null não é zero: zero afirma que
     * nada escalou, null admite que não medimos.
     */
    escalated?: {
        reached: number;
        rescued: number;
        missed: number;
        /**
         * Dos que esta fonte não trouxe, quantos NENHUMA fonte trouxe. É o que
         * separa "a reserva falhou e a seguinte salvou" de "o ativo não negocia
         * mais" — sem isso, uma fonte chamada só para ticker morto fica vermelha
         * para sempre por um defeito que não é dela.
         */
        orphaned?: number;
    } | null;
}

/** Um ativo que precisou descer a cadeia, e o caminho que ele fez. */
export interface ChainEscalation {
    /** O ticker (ou o que se buscava). */
    subject: string;
    /** Ids das fontes do caminho, na ordem — a primeira é a que não entregou. */
    tried: string[];
    /**
     * Dos `tried`, quais NÃO foram consultadas — decisão nossa, não falha delas.
     *
     * Rotina que desce direto para a reserva porque a régua de staleness mandou
     * poupar a principal não pode riscar a principal na tela: pular não é falhar.
     * Ausente em ledger antigo, e aí a lista vazia é a leitura certa.
     */
    skipped?: string[];
    /** Id de quem trouxe o dado; `null` = nenhuma fonte trouxe. */
    resolvedBy: string | null;
    reason: string | null;
    /** Escalada conhecida (ticker que sempre falha na fonte principal). */
    expected: boolean;
    /** Quantas vezes aconteceu desde o reinício. */
    count: number;
    at: string;
}

/**
 * Resumo do trajeto por cadeia. Só existe para cadeias com registro por ativo;
 * a ausência da chave significa "não medimos", nunca "nada escalou".
 */
export interface ChainFlow {
    chain: string;
    total: number;
    /** Assuntos que nenhuma fonte resolveu — a única categoria com consequência. */
    unresolved: number;
    expected: number;
    /**
     * Dos `unresolved`, quantos ninguém PODERIA ter resolvido — papel que não
     * negociou não tem fechamento em fonte alguma. Vermelho é o que sobra.
     *
     * Opcional porque o cliente pode subir antes do servidor: ausente, a tela
     * volta ao comportamento antigo em vez de mostrar `NaN` no lugar da conta.
     */
    unresolvedExpected?: number;
    byResolver: { id: string | null; label: string | null; count: number }[];
    items: ChainEscalation[];
    /** Quantos ficaram de fora de `items` pelo teto de transporte. */
    truncated: number;
    /**
     * Quando foi a escalada mais recente. `null` = nenhuma desde o reinício.
     *
     * A linha do painel afirmava "43 ativos precisaram de reserva" sem tempo
     * nenhum, cercada de cards que falam do agora — um estouro de sete horas
     * atrás lia-se como estando acontecendo.
     */
    lastAt: string | null;
    /**
     * As palavras da cadeia, escritas no servidor. Cotação fala de ativo e preço;
     * câmbio, de moeda e cotação; indicadores, de valor; candle, de fechamento.
     */
    vocabulary: {
        noun: string;
        none: string;
        rescued: string;
        allFromPrimary: string;
        missingBadge: string;
        missingLong: string;
        /** As palavras da ausência que a cadeia não tinha como evitar. */
        expectedBadge?: string;
        expectedLong?: string;
    };
}

/** Um motivo pelo qual a cotação chegou fora do esperado. */
export interface QuoteSuspectFinding {
    /** SALTO_NA_FONTE | SALTO_VS_BANCO | VARIACAO_INCOERENTE */
    code: string;
    /** A frase pronta, escrita no servidor. A tela não recalcula nada. */
    detail: string;
    movePct: number | null;
    /**
     * O que a NOSSA série de candles decidiu sobre o salto contra o banco:
     * 'NOVO_CONFIRMADO' = o preço guardado é que estava errado (caso encerrado);
     * 'GUARDADO_CONFIRMADO' = a série não sustenta o preço novo;
     * `null` = ela não conseguiu desempatar, ou o achado é de outro tipo.
     */
    arbitration?: 'NOVO_CONFIRMADO' | 'GUARDADO_CONFIRMADO' | null;
}

/** Uma cotação que foi GRAVADA, mas com número fora da magnitude esperada. */
export interface QuoteSuspect {
    subject: string;
    type: string | null;
    /** Fonte que trouxe o número, como ela se identifica (YAHOO, BRAPI_FALLBACK…). */
    source: string | null;
    price: number | null;
    findings: QuoteSuspectFinding[];
    /** A nossa série já disse que o errado era o preço guardado: nada a investigar. */
    settled?: boolean;
    /** Quantas vezes desde o reinício — repetir atualiza a mesma linha. */
    count: number;
    at: string;
}

/**
 * Cotações suspeitas do processo corrente.
 *
 * Não é uma variação do `ChainFlow`: aquele diz por ONDE o preço veio, este diz
 * se o preço FAZ SENTIDO. Um ativo pode ter vindo pela fonte principal, sem
 * escalada nenhuma, e ainda assim trazer número torto.
 */
export interface QuoteSuspectView {
    total: number;
    items: QuoteSuspect[];
    /** Quantos dos listados já foram resolvidos pela nossa própria série. */
    settled?: number;
    truncated: number;
}

export interface SourceSummary {
    total: number;
    ok: number;
    degraded: number;
    unknown: number;
    degradedLabels: string[];
    worst: SourceStatus;
}

export interface DataHealthResponse {
    report: HealthReport | null;
    history: HealthHistoryPoint[];
    jobs: JobStatus[];
    sources?: DataSource[];
    sourceSummary?: SourceSummary;
    sourceGroups?: SourceGroup[];
    /** Trajeto por ativo, por cadeia. Chave ausente = cadeia sem medição. */
    sourceChains?: Record<string, ChainFlow>;
    /** Cotações gravadas com número fora do esperado, desde o último reinício. */
    quoteSuspects?: QuoteSuspectView;
}

export interface BackendError {
    _id: string;
    origin: 'HTTP' | 'JOB' | 'INGESTION';
    source: string;
    code: string;
    message: string;
    stack: string | null;
    statusCode: number | null;
    count: number;
    firstSeenAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
}

export const healthService = {
    async getDataHealth(): Promise<DataHealthResponse | null> {
        const response = await authService.api('/api/research/data-health');
        if (!response.ok) return null;
        return await response.json();
    },

    async runNow(): Promise<HealthReport> {
        const response = await authService.api('/api/research/data-health/run', { method: 'POST' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Falha ao reavaliar a saúde dos dados.');
        return data.report;
    },

    async listErrors(origin?: string): Promise<{ errors: BackendError[]; unresolvedCount: number }> {
        const qs = origin ? `?origin=${encodeURIComponent(origin)}` : '';
        const response = await authService.api(`/api/research/errors${qs}`);
        if (!response.ok) return { errors: [], unresolvedCount: 0 };
        return await response.json();
    },

    async resolveError(id: string): Promise<void> {
        const response = await authService.api(`/api/research/errors/${id}/resolve`, { method: 'POST' });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || 'Falha ao marcar erro como tratado.');
        }
    },
};
