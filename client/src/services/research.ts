
import { authService } from './auth';

export interface AuditEntry {
    factor: string;
    points: number;
    type: 'base' | 'bonus' | 'penalty';
    category: string;
}

export interface RankingItem {
    position: number;
    ticker: string;
    name: string;
    sector?: string;
    type?: string;
    usSubType?: 'STOCK' | 'ETF' | 'REIT' | 'DOLLAR' | 'GOLD' | null;
    action: 'BUY' | 'SELL' | 'WAIT';
    currentPrice: number; 
    targetPrice: number;
    score: number;
    probability: number;
    riskProfile?: 'DEFENSIVE' | 'MODERATE' | 'BOLD';
    riskVeto?: {
        active: boolean;
        level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
        rationale: string;
        source?: string;
        evaluatedAt?: string;
    };
    aiMetadata?: {
        riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
        riskRationale?: string;
        evaluatedAt?: string;
    };
    /**
     * Retenção de assento (semanal): presente só no item que está na lista
     * porque JÁ estava — o draft não o teria escolhido de novo.
     *
     * Não confundir com a `action`: ela continua derivada do score
     * (score >= 70 ⇔ COMPRAR). Um retido abaixo de 70 aparece como AGUARDAR.
     */
    retention?: {
        retained: boolean;
        holdScore: number;
        previousPosition: number | null;
        previousScore: number | null;
        previousProfile: 'DEFENSIVE' | 'MODERATE' | 'BOLD' | null;
        displaced: { ticker: string; score: number } | null;
        reason: string;
    } | null;
    thesis: string;
    auditLog?: AuditEntry[];
    bullThesis?: string[]; 
    bearThesis?: string[]; 
    reason: string;
    metrics: {
        grahamPrice: number;
        bazinPrice: number;
        pegRatio: number;
        altmanZScore: number;
        earningsYield: number;
        roe: number;
        dy: number;
        pl: number;
        pvp: number;
        evEbitda?: number;
        psr?: number;
        roic?: number;
        ebitMargin?: number;
        pEbit?: number;
        pAtivos?: number;
        pCapGiro?: number;
        vacancy?: number;
        capRate?: number;
        ffoYield?: number;
        qtdImoveis?: number;
        vpCota?: number;
        ffoCota?: number;
        debtToEquity?: number;
        currentRatio?: number;
        netMargin?: number;
        avgLiquidity?: number;
        mktCap?: number;
        patrimLiq?: number;
        revenueGrowth?: number;
        marketCap?: number;
        netDebt?: number;
        netRevenue?: number;
        netIncome?: number;
        totalAssets?: number;
        beta?: number;
        volatility?: number;
        sma200?: number;
        ema50?: number;
        earningsGrowth?: number;
        lpa?: number;
        vpa?: number;
        peg?: number;
        payoutRatio?: number;
        structural?: {
            quality: number;
            valuation: number;
            risk: number;
        };
    };
}

export interface ComparisonReportSummary {
    totalAssets: number;
    newEntries: number;
    exits: number;
    upgrades: number;
    downgrades: number;
    positionChanges: number;
}

export interface ComparisonReport {
    assetClass: string;
    generatedAt: string;
    summary: ComparisonReportSummary;
    newEntries: { ticker: string; name: string; score: number; action: string; riskProfile: string }[];
    exits: { ticker: string; name: string; reason: string }[];
    upgrades: { ticker: string; name: string; previousScore: number; newScore: number }[];
    downgrades: { ticker: string; name: string; previousScore: number; newScore: number; reason: string }[];
    biggestMovers: { ticker: string; name: string; positionChange: number; scoreDelta: number }[];
    topBuys: { ticker: string; name: string; score: number; riskProfile: string; sector: string }[];
}

export type ResearchSection = 'RANKING' | 'MORNING_CALL' | 'REPORT' | 'EXPLAINABLE_AI';

// Nomes das seções de publicação para o feedback ao admin.
export const SECTION_LABEL: Record<string, string> = {
    RANKING: 'Ranking',
    MORNING_CALL: 'Morning Call',
    REPORT: 'Relatório',
    EXPLAINABLE_AI: 'Explainable IA',
};

export interface PublishResult {
    message: string;
    activated?: ResearchSection[];
    skipped?: ResearchSection[];
}

export interface PublishStatus {
    assetClass: string;
    lastSyncAt: string | null;
    lastPublishedAt: string | null;
    isRankingPublished: boolean;
    isReportPublished: boolean;
    isExplainableAIPublished: boolean;
    hasComparisonReport: boolean;
    hasExplainableAIPrompt: boolean;
    hasGeneratedExplainableAI: boolean;
    latestId: string | null;
    // Seções com conteúdo ainda não publicadas — o que o "Publicar Tudo
    // Pendente" vai colocar no ar nesta classe.
    pendingSections?: ResearchSection[];
    readyToPublish: boolean;
}

export interface TreasuryBondItem {
    title: string;
    type: 'PREFIXADO' | 'IPCA' | 'SELIC' | 'RENDAMAIS' | 'EDUCA';
    index: string;
    rate: number;
    maturityDate: string | null;
    minInvestment: number;
    unitPrice: number;
    nominalEstimate: number;  // rendimento nominal anual estimado (%)
    realEstimate: number;     // acima da inflação (%)
    vsCdi: number | null;     // pontos percentuais vs CDI
}

export interface FixedIncomeResponse {
    macro: { ipca: number; selic: number; cdi: number };
    bonds: TreasuryBondItem[];
    updatedAt: string | null;
}

export interface BuyAndHoldRow {
    position: number;
    ticker: string;
    name?: string;
    sector?: string;
    archetype?: string;
    score: number;
    action: 'BUY' | 'WAIT';
    axes: { durability: number; resilience: number; consistency: number };
    premiumPct: number | null;
    reason: string;
}

export interface BuyAndHoldShadow {
    version: string;
    generatedAt: string;
    writesPerformed: boolean;
    config: { minMarketCap: number; maxBeta: number; weights: { durability: number; resilience: number; consistency: number } };
    macro: { SELIC?: number; IPCA?: number; NTNB_LONG?: number; RATES_STALE?: boolean };
    counts: { analyzed: number; eligible: number; excluded: number; buy: number; wait: number };
    ranking: BuyAndHoldRow[];
    excludedByReason: { reason: string; count: number }[];
}

// ─── Estratégia âncora (BUY_AND_HOLD) ────────────────────────────────────────
// Lista para carregar por décadas, distinta do Research semanal (BUY_HOLD).
// Convivem: outra `strategy`, outro ponteiro publicado, outro contrato.

export const ANCHOR_STRATEGY = 'BUY_AND_HOLD';

export interface AnchorAxes {
    durability: number;
    resilience: number;
    consistency: number;
}

export interface AnchorHysteresis {
    state: 'ENTERED' | 'MAINTAINED' | 'HELD' | 'OUT';
    entryScore: number;
    holdScore: number;
    previousScore: number | null;
}

/** Payload âncora de um item do ranking. Null em todo item do ranking legado. */
export interface AnchorPayload {
    version?: string;
    axes?: AnchorAxes;
    composite?: number | null;
    hysteresis?: AnchorHysteresis | null;
    exitReason?: string | null;
    // Ações
    archetype?: string | null;
    premiumPct?: number | null;
    // FIIs
    subType?: string | null;
    manager?: string | null;
    spreadPp?: number | null;
    pFfo?: number | null;
    ffoCoverage?: number | null;
    vacancy?: number | null;
    publicationLimit?: { bucket: string; cap: number; manager?: string } | null;
    expensive?: boolean;
    payoutUncovered?: boolean;
}

/** Quem saiu da lista nesta apuração, e por quê. */
export interface AnchorExit {
    ticker: string;
    name: string | null;
    reason: string;
    score: number | null;
    previousScore: number | null;
    /** false = sumiu do ranking inteiro (perdeu o portão). */
    stillListed: boolean;
}

export interface AnchorRankingItem extends RankingItem {
    anchor?: AnchorPayload | null;
}

export interface AnchorReport extends Omit<ResearchReport, 'content'> {
    anchorExits?: AnchorExit[];
    inputManifest?: {
        thresholds?: { entryScore: number; holdScore: number };
        counts?: Record<string, number>;
        bootstrap?: boolean;
        disclaimer?: string;
        macro?: Record<string, number | boolean | undefined>;
    };
    content: {
        morningCall: string;
        ranking: AnchorRankingItem[];
    };
}

/** Classes com motor âncora. CRYPTO/ETF/US não têm — a lista é BR e de renda. */
export type AnchorAssetClass = 'STOCK' | 'FII';

/**
 * Rascunho publicável de uma classe — a saída de `buildAnchorRanking` no
 * servidor. É o MESMO objeto que o cron mensal leva ao ar: já passou pelo
 * portão de elegibilidade do motor, pela histerese contra a lista publicada
 * anterior e pelo teto de composição. Não é a saída crua do motor (essa é a do
 * endpoint `/buy-and-hold/shadow`, que não conhece histerese nem teto).
 */
export interface AnchorBuilt {
    assetClass: AnchorAssetClass;
    label: string;
    strategy: string;
    version: string;
    generatedAt: string;
    macro: { SELIC?: number; IPCA?: number; NTNB_LONG?: number; RATES_STALE?: boolean };
    config: { minMarketCap: number; maxBeta: number; weights: AnchorAxes };
    thresholds: { entryScore: number; holdScore: number };
    disclaimer: string;
    /** true = nunca houve publicação desta classe; sem lista anterior, vale o limiar de entrada para todos. */
    bootstrap: boolean;
    previousAnalysisId: string | null;
    ranking: AnchorRankingItem[];
    exits: AnchorExit[];
    excludedByReason: { reason: string; count: number }[];
    counts: {
        analyzed: number;
        eligible: number;
        excluded: number;
        buy: number;
        wait: number;
        held: number;
        entered: number;
        exits: number;
    };
}

/**
 * Desfecho da publicação âncora de UMA classe. Os estados são mutuamente
 * exclusivos e a tela precisa distinguir todos:
 *  - `blocked`   → o portão de qualidade reprovou; `reason` diz por quê e
 *                  `built` traz o rascunho que NÃO foi ao ar.
 *  - `dryRun`    → prévia; nada foi escrito, `built` é o que iria ao ar.
 *  - `published` → foi ao ar; sem `built` (o servidor devolve só os agregados).
 *  - `error`     → a classe falhou sozinha, sem derrubar a outra.
 */
export interface AnchorPublishOutcome {
    assetClass: AnchorAssetClass;
    published: boolean;
    blocked?: boolean;
    reason?: string;
    dryRun?: boolean;
    error?: string;
    built?: AnchorBuilt;
    analysisId?: string;
    counts?: AnchorBuilt['counts'];
    exits?: AnchorExit[];
    bootstrap?: boolean;
}

export interface AnchorPublishResponse {
    strategy: string;
    dryRun: boolean;
    results: AnchorPublishOutcome[];
}

/** Motivo pelo qual a lista âncora não pôde ser exibida. */
export type AnchorUnavailable = 'FORBIDDEN' | 'EMPTY';

export class AnchorReportError extends Error {
    constructor(public kind: AnchorUnavailable, message: string) {
        super(message);
        this.name = 'AnchorReportError';
    }
}

/** Quem perdeu o ASSENTO no ranking semanal nesta apuração, e por quê. */
export interface RetentionExit {
    ticker: string;
    name: string | null;
    reason: string;
    /** Código do desfecho (BELOW_HOLD, INELIGIBLE, SECTOR_CAP, ...). */
    outcome?: string;
    score: number | null;
    previousScore: number | null;
}

export interface ResearchReport {
    _id: string;
    date: string;
    createdAt?: string;
    assetClass: string;
    strategy: string;
    isRankingPublished: boolean;
    isMorningCallPublished: boolean;
    isReportPublished?: boolean;
    isExplainableAIPublished?: boolean;
    comparisonReport?: ComparisonReport;
    /**
     * Quem perdeu o assento nesta apuração, com motivo legível. Só vem
     * preenchido quando a retenção está agindo (fora do modo shadow) — em
     * shadow as saídas são contrafactuais e o backend não as envia.
     */
    retentionExits?: RetentionExit[];
    explainableAIPrompt?: string;
    generatedExplainableAI?: string;
    generatedExplainableAIByProfile?: { DEFENSIVE?: string; MODERATE?: string; BOLD?: string };
    generatedBy?: string;
    content: {
        morningCall: string;
        ranking: RankingItem[];
        fullAuditLog?: RankingItem[];
    };
}

export const researchService = {
    async crunchNumbers(assetClass?: string, isBulk: boolean = false) {
        const response = await authService.api('/api/research/crunch', {
            method: 'POST',
            body: JSON.stringify({ assetClass, isBulk })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Erro ao processar números.");
        }
        return await response.json();
    },

    async runFullPipeline() {
        const response = await authService.api('/api/research/full-pipeline', {
            method: 'POST'
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro no pipeline completo.");
        }
        return await response.json();
    },

    async enhanceReport(assetClass: string, strategy: string = 'BUY_HOLD') {
        const response = await authService.api('/api/research/enhance', {
            method: 'POST',
            body: JSON.stringify({ assetClass, strategy })
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro ao refinar com IA");
        }
        return await response.json();
    },

    async syncMarketData() {
        const response = await authService.api('/api/research/sync-market', {
            method: 'POST'
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro na sincronização de dados.");
        }
        return await response.json();
    },

    async syncMacro() {
        const response = await authService.api('/api/research/sync-macro', {
            method: 'POST'
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro na sincronização macro.");
        }
        return await response.json();
    },

    async generateNarrative(analysisId: string) {
        const response = await authService.api('/api/research/narrative', {
            method: 'POST',
            body: JSON.stringify({ analysisId })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Erro ao gerar narrativa.");
        }
        return await response.json();
    },

    // `partial: true` publica as seções que já têm conteúdo e devolve as vazias
    // em `skipped`, em vez de rejeitar a análise inteira (409).
    async publish(
        analysisId: string,
        type: 'RANKING' | 'MORNING_CALL' | 'BOTH' | 'REPORT' | 'EXPLAINABLE_AI' | 'ALL',
        options: { partial?: boolean } = {}
    ): Promise<PublishResult> {
        const response = await authService.api('/api/research/publish', {
            method: 'POST',
            body: JSON.stringify({ analysisId, type, ...(options.partial ? { partial: true } : {}) })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Erro ao publicar.");
        }
        return await response.json();
    },

    async getHistory() {
        const response = await authService.api('/api/research/history');
        if (!response.ok) return [];
        return await response.json();
    },

    async getReportDetails(id: string) {
        const response = await authService.api(`/api/research/details/${id}`);
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Erro ao buscar detalhes");
        }
        return await response.json();
    },

    /**
     * Saída CRUA do motor âncora, sem histerese e sem teto de composição —
     * diagnóstico do cálculo, não prévia de publicação (para essa, use
     * `publishAnchorRanking({ dryRun: true })`).
     *
     * `assetClass` é explícito de propósito: o servidor faz default para STOCK
     * quando o parâmetro não vem, e omiti-lo escondia os FIIs sem avisar.
     */
    async getBuyAndHoldShadow(assetClass: AnchorAssetClass = 'STOCK'): Promise<BuyAndHoldShadow> {
        const response = await authService.api(`/api/research/buy-and-hold/shadow?assetClass=${assetClass}`);
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Erro ao gerar ranking Buy-and-Hold.");
        }
        return await response.json();
    },

    /**
     * Válvula manual da publicação âncora (BUY_AND_HOLD). O cron é MENSAL —
     * isto é como o admin publica fora dessa janela, e como ele confere antes.
     *
     * `dryRun: true` percorre o MESMO caminho do cron (motor → portão de
     * qualidade → histerese → teto de composição) e devolve o rascunho em
     * `built` sem escrever nada. Por isso a prévia e o que vai ao ar são
     * literalmente o mesmo cálculo, e não duas aproximações que podem divergir.
     *
     * Sem `assetClass` o servidor roda Ações E FIIs. O card sempre manda a
     * classe: publicar as duas de uma vez não pode acontecer por engano.
     *
     * NÃO toca no Research semanal (BUY_HOLD): outra strategy, outro ponteiro.
     */
    async publishAnchorRanking(
        { assetClass, dryRun = false }: { assetClass?: AnchorAssetClass; dryRun?: boolean } = {},
    ): Promise<AnchorPublishResponse> {
        const response = await authService.api('/api/research/anchor/publish', {
            method: 'POST',
            body: JSON.stringify(assetClass ? { assetClass, dryRun } : { dryRun }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(
                data.message
                || (dryRun ? 'Erro ao gerar o rascunho da lista âncora.' : 'Erro ao publicar a lista âncora.'),
            );
        }
        return await response.json();
    },

    async getLatest(assetClass: string, strategy: string) {
        const response = await authService.api(`/api/research/latest?assetClass=${assetClass}&strategy=${strategy}`);
        if (!response.ok) return null;
        return await response.json();
    },

    /**
     * Lista âncora publicada de uma classe. Diferente de `getLatest`, distingue
     * 403 (plano abaixo de PRO) de 404 (ainda não há publicação): a tela precisa
     * oferecer upgrade num caso e explicar a ausência no outro, e um `null` para
     * os dois transformaria bloqueio de plano em "indisponível".
     */
    async getAnchorReport(assetClass: string): Promise<AnchorReport> {
        const response = await authService.api(
            `/api/research/latest?assetClass=${assetClass}&strategy=${ANCHOR_STRATEGY}`,
        );
        if (response.status === 403) {
            const data = await response.json().catch(() => ({}));
            throw new AnchorReportError('FORBIDDEN', data.message || 'Disponível a partir do plano Pro.');
        }
        if (!response.ok) {
            throw new AnchorReportError('EMPTY', 'Nenhuma lista publicada para esta classe ainda.');
        }
        return await response.json();
    },

    async getMacroData() {
        const response = await authService.api('/api/research/macro');
        if (!response.ok) return null;
        return await response.json();
    },

    async getFixedIncomeData(): Promise<FixedIncomeResponse | null> {
        const response = await authService.api('/api/research/fixed-income');
        if (!response.ok) return null;
        return await response.json();
    },

    async getSignalsHistory() {
        const response = await authService.api('/api/research/signals?history=true');
        if (!response.ok) return { signals: [], meta: null };
        return await response.json();
    },

    async getRadarStats() {
        const response = await authService.api('/api/research/radar-stats');
        if (!response.ok) return null;
        return await response.json();
    },

    async updateBacktestConfig(days: number) {
        const response = await authService.api('/api/research/config/backtest', {
            method: 'POST',
            body: JSON.stringify({ days })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Falha ao atualizar config.");
        }
        return await response.json();
    },

    async clearSignalsHistory() {
        const response = await authService.api('/api/research/signals/history', {
            method: 'DELETE'
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Falha ao limpar histórico.");
        }
        return await response.json();
    },

    async getDataQualityStats() {
        const response = await authService.api('/api/research/data-quality');
        if (!response.ok) return null;
        return await response.json();
    },

    async resetAssetHealth() {
        const response = await authService.api('/api/research/reset-health', {
            method: 'POST'
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Falha ao resetar saúde.");
        }
        return await response.json();
    },

    async triggerSnapshot(force: boolean = true) {
        const response = await authService.api('/api/wallet/admin/snapshot/force', {
            method: 'POST',
            body: JSON.stringify({ force })
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Falha ao executar snapshot.");
        }
        return await response.json();
    },

    // --- NOVOS MÉTODOS (ACURÁCIA E LOGS) ---
    async getAlgorithmAccuracy(assetClass?: string, days: number = 30, profile?: string) {
        const response = await authService.api(`/api/research/accuracy?assetClass=${assetClass || ''}&days=${days}&profile=${profile || ''}`);
        if (!response.ok) return [];
        return await response.json();
    },

    async getDiscardLogs() {
        const response = await authService.api('/api/research/discard-logs');
        if (!response.ok) return [];
        return await response.json();
    },

    async syncTimeSeries() {
        const response = await authService.api('/api/research/sync-time-series', { method: 'POST' });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro ao sincronizar séries temporais.");
        }
        return await response.json();
    },

    async getPublishStatus(): Promise<PublishStatus[]> {
        const response = await authService.api('/api/research/publish-status');
        if (!response.ok) return [];
        return await response.json();
    },

    async generateExplainableAI(analysisId: string, customText?: string): Promise<{ generatedExplainableAI: string }> {
        const response = await authService.api('/api/research/generate-explainable', {
            method: 'POST',
            body: JSON.stringify({ analysisId, ...(customText ? { customText } : {}) })
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Erro ao gerar Explainable IA.");
        }
        return await response.json();
    }
};
