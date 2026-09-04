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

export interface DataSource {
    id: string;
    label: string;
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
