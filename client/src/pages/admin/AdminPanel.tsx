import React, { useEffect, useState } from 'react';
import { Header } from '../../components/dashboard/Header';
import { researchService, ResearchReport, PublishStatus } from '../../services/research';
import { marketService } from '../../services/market';
import { authService } from '../../services/auth';
import { subscriptionService } from '../../services/subscription';
import { Bot, RefreshCw, CheckCircle2, AlertCircle, Activity, Settings, Play } from 'lucide-react';
import { AuditDetailModal } from '../../components/admin/AuditDetailModal';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import { AdminPainelTab, type MacroData } from './AdminPainelTab';
import { AdminOperacoesTab } from './AdminOperacoesTab';
import { AdminFerramentasTab } from './AdminFerramentasTab';
import { getErrorMessage } from '../../utils/errorMessages';

interface CacheData {
    ticker: string;
    status: 'CACHED' | 'LIVE_ONLY' | 'NOT_FOUND';
    currentPrice?: number;
    dataPoints?: number;
}

type TabId = 'painel' | 'operacoes' | 'ferramentas';

const TABS: { id: TabId; label: string; Icon: React.ElementType }[] = [
    { id: 'painel', label: 'Painel', Icon: Activity },
    { id: 'operacoes', label: 'Operações', Icon: Play },
    { id: 'ferramentas', label: 'Ferramentas', Icon: Settings },
];

export const AdminPanel = () => {
    const { addToast } = useToast();
    const confirm = useConfirm();
    const [activeTab, setActiveTab] = useState<TabId>('painel');

    // --- ESTADOS ---
    const [history, setHistory] = useState<ResearchReport[]>([]);
    const [loadingKey, setLoadingKey] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<{type: 'success' | 'error'; text: string} | null>(null);
    const [auditModalOpen, setAuditModalOpen] = useState(false);
    const [selectedAuditReport, setSelectedAuditReport] = useState<ResearchReport | null>(null);
    const [isGlobalRunning, setIsGlobalRunning] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isMacroSyncing, setIsMacroSyncing] = useState(false);
    const [isResettingHealth, setIsResettingHealth] = useState(false);
    const [isSnapshotRunning, setIsSnapshotRunning] = useState(false);

    const [macroData, setMacroData] = useState<MacroData | null>(null);
    const [isLoadingMacro, setIsLoadingMacro] = useState(true);

    const [cacheSearchTicker, setCacheSearchTicker] = useState('');
    const [cacheData, setCacheData] = useState<CacheData | null>(null);
    const [isSearchingCache, setIsSearchingCache] = useState(false);

    const [splitTicker, setSplitTicker] = useState('');
    const [isFixingSplit, setIsFixingSplit] = useState(false);

    const [testPaymentLoading, setTestPaymentLoading] = useState<string | null>(null);

    const [backtestDays, setBacktestDays] = useState<number>(7);
    const [isSavingConfig, setIsSavingConfig] = useState(false);
    const [isClearingRadar, setIsClearingRadar] = useState(false);
    const [isSyncingTimeSeries, setIsSyncingTimeSeries] = useState(false);

    const [qualityStats, setQualityStats] = useState<any>(null);
    const [accuracyData, setAccuracyData] = useState<any[]>([]);
    const [accuracyWindow, setAccuracyWindow] = useState<number>(30);
    const [accuracyAsset, setAccuracyAsset] = useState<string>('BRASIL_10');
    const [accuracyProfile, setAccuracyProfile] = useState<string>('MODERATE');
    const [discardLogs, setDiscardLogs] = useState<any[]>([]);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    const [publishStatus, setPublishStatus] = useState<PublishStatus[]>([]);
    const [isPublishingAll, setIsPublishingAll] = useState(false);

    const [promptModal, setPromptModal] = useState({ open: false, id: '', prompt: '', generatedAI: '', assetClass: '' });
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
    const [localGeneratedText, setLocalGeneratedText] = useState('');
    const [userHasEdited, setUserHasEdited] = useState(false);

    // --- LOADERS ---
    const loadHistory = async () => {
        try { setHistory(await researchService.getHistory()); } catch (e) { console.error("Erro histórico", e); }
    };

    const loadMacro = async () => {
        setIsLoadingMacro(true);
        try {
            const data = await researchService.getMacroData();
            setMacroData(data && Object.keys(data).length > 0 ? data : null);
        } catch { setMacroData(null); }
        finally { setIsLoadingMacro(false); }
    };

    const loadConfig = async () => {
        try {
            const [stats, qStats] = await Promise.all([researchService.getRadarStats(), researchService.getDataQualityStats()]);
            if (stats?.backtestHorizon) setBacktestDays(stats.backtestHorizon);
            setQualityStats(qStats);
        } catch (e) { console.error("Erro configs", e); }
    };

    const loadAccuracy = async () => {
        try {
            // BRASIL_10 é curva única (sem perfil); demais classes respeitam o perfil escolhido.
            const prof = accuracyAsset === 'BRASIL_10' ? undefined : accuracyProfile;
            const data = await researchService.getAlgorithmAccuracy(accuracyAsset, accuracyWindow, prof);
            setAccuracyData(data.map((d: any) => ({
                ...d,
                formattedDate: new Date(d.date).toLocaleDateString('pt-BR'),
                equityReturn: d.equityReturn ?? d.avgReturn ?? 0,
                ibovReturn: d.ibovReturn ?? d.benchmarkReturn ?? 0,
                spxReturn: d.spxReturn ?? 0,
                cdiReturn: d.cdiReturn ?? 0,
                ifixReturn: d.ifixReturn ?? 0,
                btcReturn: d.btcReturn ?? 0,
                holdingsCount: d.holdingsCount ?? 0,
                lastRebalanceDate: d.lastRebalanceDate ?? null,
            })));
        } catch (e) { console.error("Erro accuracy", e); }
    };

    const loadDiscardLogs = async () => {
        setIsLoadingLogs(true);
        try { setDiscardLogs(await researchService.getDiscardLogs()); } catch { /* não-crítico */ }
        finally { setIsLoadingLogs(false); }
    };

    const loadPublishStatus = async () => {
        try { setPublishStatus(await researchService.getPublishStatus()); } catch { /* não-crítico */ }
    };

    useEffect(() => { loadHistory(); loadMacro(); loadConfig(); loadDiscardLogs(); loadPublishStatus(); }, []);
    useEffect(() => { loadAccuracy(); }, [accuracyWindow, accuracyAsset, accuracyProfile]);

    // --- HANDLERS ---
    const showStatus = (type: 'success' | 'error', text: string, ms = 5000) => {
        setStatusMsg({ type, text });
        setTimeout(() => setStatusMsg(null), ms);
    };

    const handleSyncData = async () => {
        setIsSyncing(true);
        try {
            await researchService.syncMarketData();
            showStatus('success', "Banco de Dados atualizado! Cotações sincronizadas.");
            await Promise.all([loadMacro(), loadConfig(), loadAccuracy()]);
        } catch (e: unknown) { showStatus('error', getErrorMessage(e, "Erro na sincronização.")); }
        finally { setIsSyncing(false); }
    };

    const handleMacroSync = async () => {
        setIsMacroSyncing(true);
        try {
            await researchService.syncMacro();
            showStatus('success', "Indicadores e S&P 500 atualizados com sucesso.");
            await loadMacro();
        } catch (e: unknown) { showStatus('error', getErrorMessage(e, "Erro na sync macro.")); }
        finally { setIsMacroSyncing(false); }
    };

    const handleGlobalRun = async () => {
        setIsGlobalRunning(true);
        try {
            await researchService.runFullPipeline();
            showStatus('success', "Protocolo V3 Completo finalizado com sucesso!", 8000);
            await Promise.all([loadHistory(), loadMacro(), loadConfig(), loadDiscardLogs(), loadAccuracy(), loadPublishStatus()]);
        } catch (e: unknown) { showStatus('error', getErrorMessage(e, "Erro durante o processamento global."), 8000); }
        finally { setIsGlobalRunning(false); }
    };

    const handleForceSnapshot = async () => {
        const ok = await confirm({ title: 'Forçar snapshot de rentabilidade', message: 'Isso calculará a rentabilidade de TODOS os usuários. Se já houver snapshot hoje, será substituído. Continuar?', confirmText: 'Executar', isDestructive: true });
        if (!ok) return;
        setIsSnapshotRunning(true);
        try {
            const res = await researchService.triggerSnapshot(true);
            showStatus('success', `Snapshot executado. Criados: ${res.stats.created}, Ignorados: ${res.stats.skipped}`);
            await loadConfig();
        } catch (e: unknown) { showStatus('error', getErrorMessage(e, "Erro ao executar snapshot.")); }
        finally { setIsSnapshotRunning(false); }
    };

    const handleResetHealth = async () => {
        setIsResettingHealth(true);
        try {
            const res = await researchService.resetAssetHealth();
            showStatus('success', `${res.reactivated} ativos reativados com sucesso.`, 3000);
            await loadConfig();
        } catch { showStatus('error', "Erro ao resetar saúde dos ativos.", 3000); }
        finally { setIsResettingHealth(false); }
    };

    const handlePublishGranular = async (id: string, type: 'RANKING' | 'REPORT' | 'EXPLAINABLE_AI' | 'ALL') => {
        setLoadingKey(`${id}-PUBG_${type}`);
        try {
            await researchService.publish(id, type);
            showStatus('success', "Publicado com sucesso.", 4000);
            await Promise.all([loadHistory(), loadPublishStatus()]);
        } catch { showStatus('error', "Falha ao publicar.", 4000); }
        finally { setLoadingKey(null); }
    };

    const handlePublishAllPending = async () => {
        const pending = publishStatus.filter(s => s.readyToPublish && s.latestId);
        if (pending.length === 0) return showStatus('error', "Nenhum draft pendente para publicar.");
        setIsPublishingAll(true);
        try {
            for (const s of pending) await researchService.publish(s.latestId!, 'ALL');
            showStatus('success', `${pending.length} classe(s) publicadas com sucesso!`);
            await Promise.all([loadHistory(), loadPublishStatus()]);
        } catch { showStatus('error', "Erro ao publicar todas."); }
        finally { setIsPublishingAll(false); }
    };

    const handleViewPrompt = async (id: string, assetClass: string) => {
        setPromptModal({ open: true, id, prompt: '', generatedAI: '', assetClass });
        setLocalGeneratedText('');
        setUserHasEdited(false);
        setIsLoadingPrompt(true);
        try {
            const report = await researchService.getReportDetails(id);
            const generatedAI = report.generatedExplainableAI || '';
            setPromptModal({ open: true, id, prompt: report.explainableAIPrompt || '', generatedAI, assetClass });
            setLocalGeneratedText(generatedAI);
        } catch {
            setPromptModal(p => ({ ...p, open: false }));
            addToast("Erro ao carregar prompt.", 'error');
        } finally { setIsLoadingPrompt(false); }
    };

    const handleGenerateExplainableAI = async () => {
        if (!promptModal.id) return;
        setIsGeneratingAI(true);
        try {
            const customText = userHasEdited && localGeneratedText ? localGeneratedText : undefined;
            const result = await researchService.generateExplainableAI(promptModal.id, customText);
            setLocalGeneratedText(result.generatedExplainableAI);
            setUserHasEdited(false);
            setPromptModal(prev => ({ ...prev, generatedAI: result.generatedExplainableAI }));
            await loadPublishStatus();
            showStatus('success', "Explainable IA salvo com sucesso!");
        } catch (e: unknown) { showStatus('error', getErrorMessage(e, "Erro ao gerar IA.")); }
        finally { setIsGeneratingAI(false); }
    };

    const handleCacheSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!cacheSearchTicker) return;
        setIsSearchingCache(true);
        setCacheData(null);
        try { setCacheData(await marketService.getAssetCacheStatus(cacheSearchTicker)); } catch { /* não-crítico */ }
        finally { setIsSearchingCache(false); }
    };

    const handleFixSplit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!splitTicker) return;
        const ok = await confirm({ title: 'Corrigir desdobramento (split)', message: `Isso alterará o histórico de TODOS os usuários que possuem ${splitTicker.toUpperCase()}. Confirma?`, confirmText: 'Aplicar', isDestructive: true });
        if (!ok) return;
        setIsFixingSplit(true);
        try {
            const response = await authService.api('/api/wallet/fix-splits', { method: 'POST', body: JSON.stringify({ ticker: splitTicker, type: 'STOCK' }) });
            const data = await response.json();
            if (response.ok) showStatus('success', `${data.message} (${data.details?.updates || 0} afetados)`);
            else throw new Error(data.message);
        } catch (e: unknown) { showStatus('error', getErrorMessage(e, "Erro ao aplicar split.")); }
        finally { setIsFixingSplit(false); }
    };

    const handleTestPayment = async (planKey: string) => {
        setTestPaymentLoading(planKey);
        try {
            const data = await subscriptionService.testCheckout(planKey);
            if (data.redirectUrl) window.open(data.redirectUrl, '_blank');
        } catch (e: unknown) { showStatus('error', getErrorMessage(e, "Erro ao gerar link de teste.")); }
        finally { setTestPaymentLoading(null); }
    };

    const handleSaveBacktestConfig = async (days: number) => {
        setIsSavingConfig(true);
        try {
            await researchService.updateBacktestConfig(days);
            setBacktestDays(days);
            showStatus('success', `Horizonte de backtest atualizado para ${days} dias.`, 3000);
        } catch { showStatus('error', "Erro ao salvar configuração.", 3000); }
        finally { setIsSavingConfig(false); }
    };

    const handleSyncTimeSeries = async () => {
        setIsSyncingTimeSeries(true);
        try {
            const res = await researchService.syncTimeSeries();
            showStatus('success', res.message || "Séries temporais atualizadas.");
            await loadConfig();
        } catch (e: unknown) { showStatus('error', getErrorMessage(e, "Erro ao sincronizar séries temporais.")); }
        finally { setIsSyncingTimeSeries(false); }
    };

    const handleClearRadarHistory = async () => {
        const ok = await confirm({ title: 'Limpar histórico do Radar', message: 'Isso apagará TODOS os sinais históricos do Radar Alpha. Confirma?', confirmText: 'Limpar', isDestructive: true });
        if (!ok) return;
        setIsClearingRadar(true);
        try {
            await researchService.clearSignalsHistory();
            showStatus('success', "Histórico do Radar limpo com sucesso.", 3000);
        } catch { showStatus('error', "Erro ao limpar histórico.", 3000); }
        finally { setIsClearingRadar(false); }
    };

    const openAudit = async (reportId: string) => {
        setSelectedAuditReport(null);
        setAuditModalOpen(true);
        try { setSelectedAuditReport(await researchService.getReportDetails(reportId)); }
        catch { setAuditModalOpen(false); addToast("Erro ao carregar auditoria.", 'error'); }
    };

    return (
        <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main id="main-content" tabIndex={-1} className="max-w-[1400px] mx-auto p-6 animate-fade-in">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/20">
                                <Bot size={24} className="text-white" />
                            </div>
                            Vértice AI Control Room
                        </h1>
                        <p className="text-slate-400 text-sm mt-1 ml-13">Gerencie a ingestão de inteligência de mercado.</p>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-green-900/20 border border-green-900/50 rounded-full">
                        <Activity size={12} className="text-green-500 animate-pulse" />
                        <span className="text-xs font-bold text-green-500">SYSTEM ONLINE</span>
                    </div>
                </div>

                {statusMsg && (
                    <div className={`mb-4 p-4 rounded-xl border flex items-center gap-3 animate-fade-in ${statusMsg.type === 'success' ? 'bg-emerald-900/10 border-emerald-900/30 text-emerald-400' : 'bg-red-900/10 border-red-900/30 text-red-400'}`}>
                        {statusMsg.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                        <span className="text-sm font-bold">{statusMsg.text}</span>
                    </div>
                )}

                {/* Tab Navigation */}
                <div className="flex gap-1 mb-6 bg-base border border-slate-800 rounded-xl p-1">
                    {TABS.map(({ id, label, Icon }) => (
                        <button key={id} onClick={() => setActiveTab(id)} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === id ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                            <Icon size={14} />
                            {label}
                        </button>
                    ))}
                </div>

                {activeTab === 'painel' && (
                    <AdminPainelTab
                        qualityStats={qualityStats}
                        accuracyData={accuracyData}
                        accuracyWindow={accuracyWindow}
                        setAccuracyWindow={setAccuracyWindow}
                        accuracyAsset={accuracyAsset}
                        setAccuracyAsset={setAccuracyAsset}
                        accuracyProfile={accuracyProfile}
                        setAccuracyProfile={setAccuracyProfile}
                        macroData={macroData}
                        isLoadingMacro={isLoadingMacro}
                        isMacroSyncing={isMacroSyncing}
                        isSyncing={isSyncing}
                        isGlobalRunning={isGlobalRunning}
                        isResettingHealth={isResettingHealth}
                        isSnapshotRunning={isSnapshotRunning}
                        isSyncingTimeSeries={isSyncingTimeSeries}
                        onResetHealth={handleResetHealth}
                        onForceSnapshot={handleForceSnapshot}
                        onSyncTimeSeries={handleSyncTimeSeries}
                        onMacroSync={handleMacroSync}
                        onSyncData={handleSyncData}
                        onRetryMacro={loadMacro}
                    />
                )}

                {activeTab === 'operacoes' && (
                    <AdminOperacoesTab
                        history={history}
                        publishStatus={publishStatus}
                        loadingKey={loadingKey}
                        isGlobalRunning={isGlobalRunning}
                        isSyncing={isSyncing}
                        isPublishingAll={isPublishingAll}
                        promptModal={promptModal}
                        isLoadingPrompt={isLoadingPrompt}
                        localGeneratedText={localGeneratedText}
                        userHasEdited={userHasEdited}
                        isGeneratingAI={isGeneratingAI}
                        onGlobalRun={handleGlobalRun}
                        onPublishAllPending={handlePublishAllPending}
                        onPublishGranular={handlePublishGranular}
                        onOpenAudit={openAudit}
                        onViewPrompt={handleViewPrompt}
                        onGenerateExplainableAI={handleGenerateExplainableAI}
                        onClosePromptModal={() => { setPromptModal(p => ({ ...p, open: false })); setLocalGeneratedText(''); setUserHasEdited(false); }}
                        setLocalGeneratedText={setLocalGeneratedText}
                        setUserHasEdited={setUserHasEdited}
                    />
                )}

                {activeTab === 'ferramentas' && (
                    <AdminFerramentasTab
                        backtestDays={backtestDays}
                        isSavingConfig={isSavingConfig}
                        isClearingRadar={isClearingRadar}
                        cacheSearchTicker={cacheSearchTicker}
                        setCacheSearchTicker={setCacheSearchTicker}
                        cacheData={cacheData}
                        isSearchingCache={isSearchingCache}
                        splitTicker={splitTicker}
                        setSplitTicker={setSplitTicker}
                        isFixingSplit={isFixingSplit}
                        testPaymentLoading={testPaymentLoading}
                        discardLogs={discardLogs}
                        isLoadingLogs={isLoadingLogs}
                        onSaveBacktestConfig={handleSaveBacktestConfig}
                        onClearRadarHistory={handleClearRadarHistory}
                        onCacheSearch={handleCacheSearch}
                        onFixSplit={handleFixSplit}
                        onTestPayment={handleTestPayment}
                        onLoadDiscardLogs={loadDiscardLogs}
                    />
                )}
            </main>

            <AuditDetailModal isOpen={auditModalOpen} onClose={() => setAuditModalOpen(false)} report={selectedAuditReport} />
        </div>
    );
};
