/**
 * Gate de qualidade do auto-publish semanal (jul/2026).
 * O cron de segunda publicava o MarketAnalysis mais recente de cada classe ÀS CEGAS —
 * ranking vazio/degradado ou parado há dias ia ao ar sem revisão. validateAutoPublish
 * bloqueia (≥5 ativos e ≤7 dias) e o bloqueio gera alerta Sentry.
 * Deps pesadas mockadas só para importar o módulo (padrão research_delta.spec.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/aiResearchService.js', () => ({ aiResearchService: {} }));
vi.mock('../services/macroDataService.js', () => ({ macroDataService: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/syncService.js', () => ({ syncService: {} }));
// dateUtils chama holidayService.sync() no import — o mock precisa da função.
vi.mock('../services/holidayService.js', () => ({ holidayService: { sync: vi.fn(), isHoliday: vi.fn(() => false) } }));
vi.mock('../services/financialService.js', () => ({ financialService: {} }));
vi.mock('../utils/userCache.js', () => ({ clearUserCache: vi.fn() }));
vi.mock('../services/engines/signalEngine.js', () => ({ signalEngine: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/RefreshToken.js', () => ({ default: {} }));
vi.mock('../services/notificationService.js', () => ({ createBroadcast: vi.fn() }));
vi.mock('../services/researchPublicationService.js', () => ({
    hasSectionContent: vi.fn((analysis, section) => {
        if (section === 'REPORT') return !!analysis?.comparisonReport;
        if (section === 'EXPLAINABLE_AI') return !!analysis?.generatedExplainableAI;
        return (analysis?.content?.ranking?.length || 0) > 0;
    }),
    activateResearchSections: vi.fn(async ({ analysis, sections }) => {
        if (sections.includes('RANKING')) analysis.isRankingPublished = true;
        await analysis.save();
        return { activated: sections, skipped: [] };
    }),
}));
vi.mock('../services/workers/timeSeriesWorker.js', () => ({ timeSeriesWorker: {} }));
vi.mock('../services/usStocksFundamentalsService.js', () => ({ usStocksFundamentalsService: {} }));

const { validateAutoPublish, runWeeklyAutoPublish, AUTO_PUBLISH_MIN_ASSETS } =
    await import('../services/schedulerService.js');
const MarketAnalysis = (await import('../models/MarketAnalysis.js')).default;
const SystemConfig = (await import('../models/SystemConfig.js')).default;
const { createBroadcast } = await import('../services/notificationService.js');
const Sentry = await import('@sentry/node');

const NOW = new Date('2026-07-03T12:00:00Z');
const mkAnalysis = (n, ageDays, published = false) => ({
    isRankingPublished: published,
    createdAt: new Date(NOW.getTime() - ageDays * 86400000),
    content: { ranking: Array.from({ length: n }, (_, i) => ({ ticker: `T${i}` })) },
    save: vi.fn(),
});

beforeEach(() => {
    vi.clearAllMocks();
    SystemConfig.findOne.mockReturnValue({
        lean: () => Promise.resolve({
            lastSyncStats: { fundamentalsHealthy: true, timestamp: NOW },
        }),
    });
});

describe('validateAutoPublish (função pura)', () => {
    it('ranking saudável e recente → ok', () => {
        expect(validateAutoPublish(mkAnalysis(10, 1), NOW).ok).toBe(true);
    });

    it('ranking com menos que o mínimo de ativos → bloqueia', () => {
        const r = validateAutoPublish(mkAnalysis(AUTO_PUBLISH_MIN_ASSETS - 1, 1), NOW);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('ativos');
    });

    it('ranking vazio/sem content → bloqueia', () => {
        expect(validateAutoPublish({ createdAt: NOW }, NOW).ok).toBe(false);
        expect(validateAutoPublish(null, NOW).ok).toBe(false);
    });

    it('ranking gerado há mais de 7 dias → bloqueia (geração parada)', () => {
        const r = validateAutoPublish(mkAnalysis(10, 8), NOW);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('dias');
    });

    it('ranking BR bloqueia quando o último sync fundamental está degradado', () => {
        const r = validateAutoPublish(
            { ...mkAnalysis(10, 1), assetClass: 'STOCK' },
            NOW,
            { fundamentalsHealthy: false, timestamp: NOW },
        );
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('não está saudável');
    });
});

describe('runWeeklyAutoPublish (fluxo com gate)', () => {
    // runWeeklyAutoPublish valida a idade do ranking contra a data REAL do sistema
    // (validateAutoPublish(latest) sem `now`). Fixamos o relógio em NOW para o gate
    // de 7 dias ser determinístico — senão o caso "1 dia de idade" quebra assim que
    // a data real passa de NOW + 7d.
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
    afterEach(() => { vi.useRealTimers(); });

    const stub = (doc) => MarketAnalysis.findOne.mockReturnValue({ sort: () => Promise.resolve(doc) });

    it('publica ranking saudável e dispara broadcast na 1ª publicação', async () => {
        const doc = mkAnalysis(10, 1, false);
        stub(doc);
        const res = await runWeeklyAutoPublish();
        expect(doc.save).toHaveBeenCalled();
        expect(doc.isRankingPublished).toBe(true);
        expect(res.published.length).toBeGreaterThan(0);
        expect(createBroadcast).toHaveBeenCalled();
    });

    it('BLOQUEIA ranking degradado: não salva, não publica, alerta Sentry', async () => {
        const doc = mkAnalysis(2, 1, false); // só 2 ativos
        stub(doc);
        const res = await runWeeklyAutoPublish();
        expect(doc.save).not.toHaveBeenCalled();
        expect(doc.isRankingPublished).toBe(false);
        expect(res.published).toEqual([]);
        expect(Sentry.captureMessage).toHaveBeenCalled();
    });

    it('BLOQUEIA ranking velho (>7d) mesmo com ativos suficientes', async () => {
        const doc = mkAnalysis(10, 9, false);
        stub(doc);
        const res = await runWeeklyAutoPublish();
        expect(doc.save).not.toHaveBeenCalled();
        expect(res.published).toEqual([]);
    });

    it('já publicado: re-salva flags mas NÃO repete broadcast', async () => {
        const doc = mkAnalysis(10, 1, true);
        stub(doc);
        const res = await runWeeklyAutoPublish();
        expect(doc.save).toHaveBeenCalled();
        expect(res.published).toEqual([]);
        expect(createBroadcast).not.toHaveBeenCalled();
    });
});
