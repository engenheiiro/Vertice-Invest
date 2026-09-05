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
    lastDeliveryAt: string | null;
    lastDeliveryHours: number | null;
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
    escalated?: { reached: number; rescued: number; missed: number } | null;
}

/** Um ativo que precisou descer a cadeia, e o caminho que ele fez. */
export interface ChainEscalation {
    /** O ticker (ou o que se buscava). */
    subject: string;
    /** Ids das fontes tentadas, na ordem — a primeira é a que falhou. */
    tried: string[];
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
    /** Ativos que nenhuma fonte precificou — a única categoria com consequência. */
    unresolved: number;
    expected: number;
    byResolver: { id: string | null; label: string | null; count: number }[];
    items: ChainEscalation[];
    /** Quantos ficaram de fora de `items` pelo teto de transporte. */
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
