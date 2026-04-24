
import React, { useEffect, useState } from 'react';
import { Header } from '../../components/dashboard/Header';
import { researchService, ResearchReport, PublishStatus } from '../../services/research';
import { marketService } from '../../services/market';
import { authService } from '../../services/auth';
import { Bot, RefreshCw, CheckCircle2, AlertCircle, Activity, ShieldCheck, BarChart3, Layers, Globe, Zap, Search, Play, Server, Clock, TrendingUp, TrendingDown, Minus, HardDrive, Scissors, Settings, Database, Trash2, ShieldAlert, Target, ClipboardList, MessageSquare, Share2, Send, Copy, X } from 'lucide-react';
import { AuditDetailModal } from '../../components/admin/AuditDetailModal';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

interface AssetClassOption {
    id: string;
    label: string;
    icon: React.ReactNode;
    desc: string;
}

interface MacroIndicator {
    value: number;
    change?: number;
}

interface MacroData {
    selic?: MacroIndicator;
    cdi?: MacroIndicator;
    ipca?: MacroIndicator;
    ibov?: MacroIndicator;
    usd?: MacroIndicator;
    spx?: MacroIndicator;
    btc?: MacroIndicator;
    lastUpdated?: string;
}

interface CacheData {
    ticker: string;
    status: 'CACHED' | 'LIVE_ONLY' | 'NOT_FOUND';
    currentPrice?: number;
    lastSync?: string;
    historyStatus: string;
    dataPoints?: number;
    historyLastUpdated?: string;
}

const ASSET_CLASSES: AssetClassOption[] = [
    { id: 'BRASIL_10', label: 'Brasil 10 (Mix)', icon: <ShieldCheck size={18} className="text-emerald-500" />, desc: 'Carteira Defensiva Top Picks' },
    { id: 'STOCK', label: 'Ações Brasil', icon: <BarChart3 size={18} className="text-blue-500" />, desc: 'B3: Ibovespa & Small Caps' },
    { id: 'FII', label: 'Fundos Imobiliários', icon: <Layers size={18} className="text-indigo-500" />, desc: 'IFIX: Tijolo, Papel & Fiagros' },
    { id: 'STOCK_US', label: 'Mercado Global', icon: <Globe size={18} className="text-cyan-500" />, desc: 'NYSE & NASDAQ (Stocks)' },
    { id: 'CRYPTO', label: 'Criptoativos', icon: <Zap size={18} className="text-purple-500" />, desc: 'Top Cap & Projetos DeFi' }
];

type TabId = 'painel' | 'operacoes' | 'ferramentas';

export const AdminPanel = () => {
    const [activeTab, setActiveTab] = useState<TabId>('painel');

    // --- ESTADOS ---
    const [history, setHistory] = useState<ResearchReport[]>([]);
    const [loadingKey, setLoadingKey] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
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

    const [backtestDays, setBacktestDays] = useState<number>(7);
    const [isSavingConfig, setIsSavingConfig] = useState(false);
    const [isClearingRadar, setIsClearingRadar] = useState(false);
    const [isSyncingTimeSeries, setIsSyncingTimeSeries] = useState(false);

    const [qualityStats, setQualityStats] = useState<any>(null);

    const [accuracyData, setAccuracyData] = useState<any[]>([]);
    const [accuracyWindow, setAccuracyWindow] = useState<number>(30);
    const [accuracyAsset, setAccuracyAsset] = useState<string>('BRASIL_10');
    const [discardLogs, setDiscardLogs] = useState<any[]>([]);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    const [publishStatus, setPublishStatus] = useState<PublishStatus[]>([]);
    const [isPublishingAll, setIsPublishingAll] = useState(false);

    const [promptModal, setPromptModal] = useState<{ open: boolean; id: string; prompt: string; generatedAI: string; assetClass: string }>({ open: false, id: '', prompt: '', generatedAI: '', assetClass: '' });
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
    const [localGeneratedText, setLocalGeneratedText] = useState('');
    const [userHasEdited, setUserHasEdited] = useState(false);

    // --- LOADERS ---
    const loadHistory = async () => {
        try {
            const data = await researchService.getHistory();
            setHistory(data);
        } catch (error) {
            console.error("Erro ao carregar histórico", error);
        }
    };

    const loadMacro = async () => {
        setIsLoadingMacro(true);
        try {
            const data = await researchService.getMacroData();
            setMacroData(data && Object.keys(data).length > 0 ? data : null);
        } catch (e) {
            console.error("Erro macro", e);
            setMacroData(null);
        } finally {
            setIsLoadingMacro(false);
        }
    };

    const loadConfig = async () => {
        try {
            const [stats, qStats] = await Promise.all([
                researchService.getRadarStats(),
                researchService.getDataQualityStats()
            ]);
            if (stats?.backtestHorizon) {
                setBacktestDays(stats.backtestHorizon);
            }
            setQualityStats(qStats);
        } catch (e) { console.error("Erro ao carregar configs", e); }
    };

    const loadAccuracy = async () => {
        try {
            const data = await researchService.getAlgorithmAccuracy(accuracyAsset, accuracyWindow);
            setAccuracyData(data.map((d: any) => ({
                ...d,
                formattedDate: new Date(d.date).toLocaleDateString('pt-BR'),
                ibovReturn: d.ibovReturn ?? d.benchmarkReturn ?? 0,
                spxReturn: d.spxReturn ?? 0,
                cdiReturn: d.cdiReturn ?? 0,
                ifixReturn: d.ifixReturn ?? 0,
            })));
        } catch (e) { console.error("Erro accuracy", e); }
    };

    const loadDiscardLogs = async () => {
        setIsLoadingLogs(true);
        try {
            const data = await researchService.getDiscardLogs();
            setDiscardLogs(data);
        } catch (e) { console.error("Erro logs", e); }
        finally { setIsLoadingLogs(false); }
    };

    const loadPublishStatus = async () => {
        try {
            const data = await researchService.getPublishStatus();
            setPublishStatus(data);
        } catch (e) { /* não-crítico */ }
    };

    useEffect(() => {
        loadHistory();
        loadMacro();
        loadConfig();
        loadDiscardLogs();
        loadPublishStatus();
    }, []);

    useEffect(() => {
        loadAccuracy();
    }, [accuracyWindow, accuracyAsset]);

    // --- HANDLERS ---
    const handleSyncData = async () => {
        setIsSyncing(true);
        setStatusMsg(null);
        try {
            await researchService.syncMarketData();
            setStatusMsg({ type: 'success', text: "Banco de Dados atualizado com sucesso! Cotações sincronizadas." });
            await loadMacro();
            await loadConfig();
            await loadAccuracy();
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: e.message || "Erro na sincronização." });
        } finally {
            setIsSyncing(false);
            setTimeout(() => setStatusMsg(null), 5000);
        }
    };

    const handleMacroSync = async () => {
        setIsMacroSyncing(true);
        setStatusMsg(null);
        try {
            await researchService.syncMacro();
            setStatusMsg({ type: 'success', text: "Indicadores e S&P 500 atualizados com sucesso." });
            await loadMacro();
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: e.message || "Erro na sync macro." });
        } finally {
            setIsMacroSyncing(false);
            setTimeout(() => setStatusMsg(null), 5000);
        }
    };

    const handleGlobalRun = async () => {
        setIsGlobalRunning(true);
        setStatusMsg(null);
        try {
            await researchService.runFullPipeline();
            setStatusMsg({ type: 'success', text: "Protocolo V3 Completo (Sync + Análise) finalizado com sucesso!" });
            await loadHistory();
            await loadMacro();
            await loadConfig();
            await loadDiscardLogs();
            await loadAccuracy();
            await loadPublishStatus();
        } catch (error: any) {
            setStatusMsg({ type: 'error', text: error.message || "Erro durante o processamento global." });
        } finally {
            setIsGlobalRunning(false);
            setTimeout(() => setStatusMsg(null), 8000);
        }
    };

    const handleForceSnapshot = async () => {
        if (!confirm("ATENÇÃO: Isso calculará a rentabilidade de TODOS os usuários com base nos preços atuais. Se já houver um snapshot hoje, ele será substituído. Continuar?")) return;

        setIsSnapshotRunning(true);
        setStatusMsg(null);
        try {
            const res = await researchService.triggerSnapshot(true);
            setStatusMsg({ type: 'success', text: `Snapshot executado. Criados: ${res.stats.created}, Ignorados: ${res.stats.skipped}` });
            await loadConfig();
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: e.message || "Erro ao executar snapshot." });
        } finally {
            setIsSnapshotRunning(false);
            setTimeout(() => setStatusMsg(null), 5000);
        }
    };

    const handleResetHealth = async () => {
        setIsResettingHealth(true);
        try {
            const res = await researchService.resetAssetHealth();
            setStatusMsg({ type: 'success', text: `${res.reactivated} ativos reativados com sucesso.` });
            await loadConfig();
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: "Erro ao resetar saúde dos ativos." });
        } finally {
            setIsResettingHealth(false);
            setTimeout(() => setStatusMsg(null), 3000);
        }
    };

    const handleAction = async (id: string, action: 'IA_NARRATIVE' | 'PUB_RANK' | 'PUB_MC' | 'PUB_BOTH') => {
        setLoadingKey(`${id}-${action}`);
        try {
            if (action === 'IA_NARRATIVE') await researchService.generateNarrative(id);
            if (action === 'PUB_RANK') await researchService.publish(id, 'RANKING');
            if (action === 'PUB_MC') await researchService.publish(id, 'MORNING_CALL');
            if (action === 'PUB_BOTH') await researchService.publish(id, 'BOTH');
            setStatusMsg({ type: 'success', text: "Ação executada com sucesso." });
            await Promise.all([loadHistory(), loadPublishStatus()]);
        } catch (error) {
            setStatusMsg({ type: 'error', text: "Falha na execução." });
        } finally {
            setLoadingKey(null);
            setTimeout(() => setStatusMsg(null), 5000);
        }
    };

    const handlePublishGranular = async (id: string, type: 'RANKING' | 'REPORT' | 'EXPLAINABLE_AI' | 'ALL') => {
        const key = `${id}-PUBG_${type}`;
        setLoadingKey(key);
        try {
            await researchService.publish(id, type);
            setStatusMsg({ type: 'success', text: "Publicado com sucesso." });
            await Promise.all([loadHistory(), loadPublishStatus()]);
        } catch (e) {
            setStatusMsg({ type: 'error', text: "Falha ao publicar." });
        } finally {
            setLoadingKey(null);
            setTimeout(() => setStatusMsg(null), 4000);
        }
    };

    const handlePublishAllPending = async () => {
        const pending = publishStatus.filter(s => s.readyToPublish && s.latestId);
        if (pending.length === 0) return setStatusMsg({ type: 'error', text: "Nenhum draft pendente para publicar." });
        setIsPublishingAll(true);
        try {
            for (const s of pending) {
                await researchService.publish(s.latestId!, 'ALL');
            }
            setStatusMsg({ type: 'success', text: `${pending.length} classe(s) publicadas com sucesso!` });
            await loadHistory();
            await loadPublishStatus();
        } catch (e) {
            setStatusMsg({ type: 'error', text: "Erro ao publicar todas." });
        } finally {
            setIsPublishingAll(false);
            setTimeout(() => setStatusMsg(null), 5000);
        }
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
        } catch (e) {
            setPromptModal(p => ({ ...p, open: false }));
            alert("Erro ao carregar prompt.");
        } finally {
            setIsLoadingPrompt(false);
        }
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
            setStatusMsg({ type: 'success', text: "Explainable IA salvo com sucesso!" });
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: e.message || "Erro ao gerar IA." });
        } finally {
            setIsGeneratingAI(false);
            setTimeout(() => setStatusMsg(null), 5000);
        }
    };

    const handleGenerate = async (assetId: string, strategyId: string) => {
        const key = `${assetId}-${strategyId}`;
        setLoadingKey(key);
        setStatusMsg(null);
        try {
            await researchService.crunchNumbers(assetId);
            setStatusMsg({ type: 'success', text: `Análise para ${assetId} gerada com sucesso!` });
            await loadHistory();
            await loadDiscardLogs();
            await loadAccuracy();
        } catch (error: any) {
            setStatusMsg({ type: 'error', text: error.message || "Erro ao gerar análise." });
        } finally {
            setLoadingKey(null);
        }
    };

    const handleCacheSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!cacheSearchTicker) return;
        setIsSearchingCache(true);
        setCacheData(null);
        try {
            const data = await marketService.getAssetCacheStatus(cacheSearchTicker);
            setCacheData(data);
        } catch (e) {
            console.error(e);
        } finally {
            setIsSearchingCache(false);
        }
    };

    const handleFixSplit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!splitTicker) return;
        if (!confirm(`ATENÇÃO: Isso alterará o histórico de transações de TODOS os usuários que possuem ${splitTicker.toUpperCase()}. Confirma?`)) return;

        setIsFixingSplit(true);
        setStatusMsg(null);
        try {
            const response = await authService.api('/api/wallet/fix-splits', {
                method: 'POST',
                body: JSON.stringify({ ticker: splitTicker, type: 'STOCK' })
            });
            const data = await response.json();
            if (response.ok) {
                setStatusMsg({ type: 'success', text: `${data.message} (${data.details?.updates || 0} afetados)` });
            } else {
                throw new Error(data.message);
            }
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: e.message || "Erro ao aplicar split." });
        } finally {
            setIsFixingSplit(false);
            setTimeout(() => setStatusMsg(null), 5000);
        }
    };

    const handleSaveBacktestConfig = async (days: number) => {
        setIsSavingConfig(true);
        try {
            await researchService.updateBacktestConfig(days);
            setBacktestDays(days);
            setStatusMsg({ type: 'success', text: `Horizonte de backtest atualizado para ${days} dias.` });
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: "Erro ao salvar configuração." });
        } finally {
            setIsSavingConfig(false);
            setTimeout(() => setStatusMsg(null), 3000);
        }
    };

    const handleSyncTimeSeries = async () => {
        setIsSyncingTimeSeries(true);
        setStatusMsg(null);
        try {
            const res = await researchService.syncTimeSeries();
            setStatusMsg({ type: 'success', text: res.message || "Séries temporais atualizadas." });
            await loadConfig();
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: e.message || "Erro ao sincronizar séries temporais." });
        } finally {
            setIsSyncingTimeSeries(false);
            setTimeout(() => setStatusMsg(null), 5000);
        }
    };

    const handleClearRadarHistory = async () => {
        if (!confirm("ATENÇÃO: Isso apagará TODOS os sinais históricos do Radar Alpha. Apenas novos sinais serão gerados a partir do próximo scan. Confirma?")) return;

        setIsClearingRadar(true);
        try {
            await researchService.clearSignalsHistory();
            setStatusMsg({ type: 'success', text: "Histórico do Radar limpo com sucesso." });
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: "Erro ao limpar histórico." });
        } finally {
            setIsClearingRadar(false);
            setTimeout(() => setStatusMsg(null), 3000);
        }
    };

    const openAudit = async (reportId: string) => {
        setSelectedAuditReport(null);
        setAuditModalOpen(true);
        try {
            const fullReport = await researchService.getReportDetails(reportId);
            setSelectedAuditReport(fullReport);
        } catch (e) {
            setAuditModalOpen(false);
            alert("Erro ao carregar detalhes da auditoria.");
        }
    };

    const getLatestForClass = (classId: string) => {
        return history.find(h => h.assetClass === classId && h.strategy === 'BUY_HOLD');
    };

    const isUpdatedToday = (dateString?: string) => {
        if (!dateString) return false;
        const today = new Date().toISOString().split('T')[0];
        return dateString.startsWith(today);
    };

    const isMacroDataValid = macroData && macroData.selic && macroData.ibov;

    // Skeleton inline para stats cards
    const Skel = () => <span className="block h-7 w-12 bg-slate-800 rounded animate-pulse mt-1" />;

    const TABS: { id: TabId; label: string; Icon: React.ElementType }[] = [
        { id: 'painel', label: 'Painel', Icon: Activity },
        { id: 'operacoes', label: 'Operações', Icon: Play },
        { id: 'ferramentas', label: 'Ferramentas', Icon: Settings },
    ];

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main className="max-w-[1400px] mx-auto p-6 animate-fade-in">
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
                    <div className={`mb-4 p-4 rounded-xl border flex items-center gap-3 animate-fade-in ${
                        statusMsg.type === 'success' ? 'bg-emerald-900/10 border-emerald-900/30 text-emerald-400' : 'bg-red-900/10 border-red-900/30 text-red-400'
                    }`}>
                        {statusMsg.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                        <span className="text-sm font-bold">{statusMsg.text}</span>
                    </div>
                )}

                {/* Tab Navigation */}
                <div className="flex gap-1 mb-6 bg-[#080C14] border border-slate-800 rounded-xl p-1">
                    {TABS.map(({ id, label, Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${
                                activeTab === id
                                    ? 'bg-slate-700 text-white shadow'
                                    : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            <Icon size={14} />
                            {label}
                        </button>
                    ))}
                </div>

                {/* ========================= PAINEL ========================= */}
                {activeTab === 'painel' && (
                    <>
                        {/* Stats KPI — sempre renderiza, skeleton enquanto carrega */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">

                            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 flex items-center gap-4 shadow-lg">
                                <div className="w-12 h-12 bg-blue-900/20 rounded-xl flex items-center justify-center text-blue-500 border border-blue-900/50 shrink-0">
                                    <RefreshCw size={24} />
                                </div>
                                <div>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase">Ativos Processados</p>
                                    <h3 className="text-2xl font-black text-white">{qualityStats ? qualityStats.assetsProcessed : <Skel />}</h3>
                                    <p className="text-[9px] text-slate-500 mt-0.5">Na última sincronização</p>
                                </div>
                            </div>

                            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 flex items-center gap-4 shadow-lg">
                                <div className="w-12 h-12 bg-yellow-900/20 rounded-xl flex items-center justify-center text-yellow-500 border border-yellow-900/50 shrink-0">
                                    <ShieldCheck size={24} />
                                </div>
                                <div>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase">Typos Corrigidos</p>
                                    <h3 className="text-2xl font-black text-white">{qualityStats ? qualityStats.typosFixed : <Skel />}</h3>
                                    <p className="text-[9px] text-slate-500 mt-0.5">Sanitização ativa</p>
                                </div>
                            </div>

                            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${qualityStats?.blacklistedAssets > 0 ? 'bg-red-900/20 text-red-500 border-red-900/50' : 'bg-green-900/20 text-green-500 border-green-900/50'}`}>
                                        <ShieldAlert size={24} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 font-bold uppercase">Blacklist</p>
                                        <h3 className={`text-2xl font-black ${qualityStats?.blacklistedAssets > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                            {qualityStats ? qualityStats.blacklistedAssets : <Skel />}
                                        </h3>
                                        <p className="text-[9px] text-slate-500 mt-0.5">Ativos bloqueados</p>
                                    </div>
                                </div>
                                {qualityStats?.blacklistedAssets > 0 && (
                                    <button
                                        onClick={handleResetHealth}
                                        disabled={isResettingHealth}
                                        className="px-2 py-1.5 bg-red-900/20 border border-red-900/50 text-red-400 hover:bg-red-900/40 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1"
                                        title="Reativa ativos bloqueados por falhas consecutivas"
                                    >
                                        {isResettingHealth ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} fill="currentColor" />}
                                        Reativar
                                    </button>
                                )}
                            </div>

                            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${qualityStats?.snapshotStats?.skipped > 0 ? 'bg-orange-900/20 text-orange-500 border-orange-900/50' : 'bg-indigo-900/20 text-indigo-500 border-indigo-900/50'}`}>
                                        <Activity size={24} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 font-bold uppercase">Snapshots Noturnos</p>
                                        <div className="flex items-baseline gap-1">
                                            <h3 className="text-2xl font-black text-white">
                                                {qualityStats ? (qualityStats.snapshotStats?.created || 0) : <Skel />}
                                            </h3>
                                            <span className="text-[10px] text-slate-500 font-bold">criados</span>
                                        </div>
                                        <p className={`text-[9px] mt-0.5 font-bold ${qualityStats?.snapshotStats?.skipped > 0 ? 'text-orange-500' : 'text-emerald-500'}`}>
                                            {qualityStats ? `${qualityStats.snapshotStats?.skipped || 0} anomalias ignoradas` : '...'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleForceSnapshot}
                                    disabled={isSnapshotRunning}
                                    className="px-2 py-1.5 bg-indigo-900/20 border border-indigo-900/50 text-indigo-400 hover:bg-indigo-900/40 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1"
                                    title="Recalcular rentabilidade de todos os usuários agora"
                                >
                                    {isSnapshotRunning ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                                    Forçar
                                </button>
                            </div>

                            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${qualityStats?.timeSeriesAgeHours > 48 ? 'bg-red-900/20 text-red-500 border-red-900/50 animate-pulse' : 'bg-blue-900/20 text-blue-500 border-blue-900/50'}`}>
                                        <Clock size={24} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 font-bold uppercase">Séries Temporais</p>
                                        <div className="flex items-baseline gap-1">
                                            <h3 className={`text-2xl font-black ${qualityStats?.timeSeriesAgeHours > 48 ? 'text-red-500' : 'text-white'}`}>
                                                {qualityStats ? (qualityStats.timeSeriesAgeHours ? qualityStats.timeSeriesAgeHours.toFixed(1) : 0) : <Skel />}
                                            </h3>
                                            <span className="text-[10px] text-slate-500 font-bold">h</span>
                                        </div>
                                        <p className={`text-[9px] mt-0.5 font-bold ${qualityStats?.timeSeriesAgeHours > 48 ? 'text-red-500' : 'text-emerald-500'}`}>
                                            {qualityStats ? (qualityStats.timeSeriesAgeHours > 48 ? 'ALERTA: Defasado' : 'Saudável') : '...'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleSyncTimeSeries}
                                    disabled={isSyncingTimeSeries}
                                    className="px-2 py-1.5 bg-blue-900/20 border border-blue-900/50 text-blue-400 hover:bg-blue-900/40 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1"
                                    title="Atualiza o histórico de preços de todos os ativos"
                                >
                                    {isSyncingTimeSeries ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                                    Sync
                                </button>
                            </div>
                        </div>

                        {/* Precisão do Algoritmo */}
                        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 mb-6 shadow-lg">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                                <div>
                                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                                        <Target size={18} className="text-purple-500" />
                                        Precisão do Algoritmo (Backtest Contínuo)
                                    </h3>
                                    <p className="text-xs text-slate-500">Retorno médio das Top Picks vs IBOV · CDI · IFIX</p>
                                </div>
                                <div className="flex gap-2">
                                    <select
                                        value={accuracyAsset}
                                        onChange={(e) => setAccuracyAsset(e.target.value)}
                                        className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 outline-none"
                                    >
                                        <option value="BRASIL_10">Brasil 10</option>
                                        <option value="STOCK">Ações BR</option>
                                        <option value="FII">FIIs</option>
                                        <option value="STOCK_US">Global (S&P 500)</option>
                                    </select>
                                    <div className="flex bg-slate-900 p-0.5 rounded border border-slate-700">
                                        {[7, 30, 60, 90].map(days => (
                                            <button
                                                key={days}
                                                onClick={() => setAccuracyWindow(days)}
                                                className={`px-3 py-1 text-[10px] font-bold rounded ${accuracyWindow === days ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                                            >
                                                {days}D
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="h-[280px] w-full">
                                {accuracyData.length > 0 ? (() => {
                                    const hasIfixData = accuracyData.some(d => d.ifixReturn !== 0) && accuracyAsset !== 'STOCK_US';
                                    const hasSpxData = accuracyAsset === 'STOCK_US' && accuracyData.some(d => d.spxReturn !== 0);
                                    return (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={accuracyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                                <defs>
                                                    <linearGradient id="colorAvg" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                                                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                                <XAxis dataKey="formattedDate" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={20} />
                                                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px' }}
                                                    itemStyle={{ fontWeight: 'bold' }}
                                                    formatter={(value: number, name: string) => [`${value >= 0 ? '+' : ''}${value.toFixed(2)}%`, name]}
                                                    labelFormatter={(label) => `📅 ${label}`}
                                                />
                                                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                                                <Area type="monotone" dataKey="avgReturn" name="Carteira (Algo)" stroke="#3B82F6" fillOpacity={1} fill="url(#colorAvg)" strokeWidth={2.5} dot={false} />
                                                <Area type="monotone" dataKey="ibovReturn" name="IBOV" stroke="#F97316" fill="transparent" strokeDasharray="5 3" strokeWidth={1.5} dot={false} />
                                                <Area type="monotone" dataKey="cdiReturn" name="CDI" stroke="#10B981" fill="transparent" strokeDasharray="3 3" strokeWidth={1.5} dot={false} />
                                                {hasIfixData && (
                                                    <Area type="monotone" dataKey="ifixReturn" name="IFIX" stroke="#A78BFA" fill="transparent" strokeDasharray="5 3" strokeWidth={1.5} dot={false} />
                                                )}
                                                {hasSpxData && (
                                                    <Area type="monotone" dataKey="spxReturn" name="S&P 500" stroke="#06B6D4" fill="transparent" strokeDasharray="5 3" strokeWidth={1.5} dot={false} />
                                                )}
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    );
                                })() : (
                                    <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
                                        <Target size={24} className="opacity-30" />
                                        <p className="text-xs">Sem dados de backtest. Rode o <span className="text-blue-400 font-bold">sync:prod</span> para acumular dados.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Ambiente Macro */}
                        <div className="bg-[#0B101A] border border-slate-800 rounded-2xl p-4">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex flex-col">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                        <Globe size={14} className="text-blue-500" />
                                        Ambiente Macroeconômico
                                    </h3>
                                    {macroData?.lastUpdated && (
                                        <span className="text-[10px] text-slate-500 font-mono mt-1 ml-6 flex items-center gap-1">
                                            <Clock size={10} />
                                            Última Sync: {new Date(macroData.lastUpdated).toLocaleString()}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={handleMacroSync} disabled={isMacroSyncing} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:border-purple-500">
                                        <Globe size={12} className={isMacroSyncing ? 'animate-pulse' : ''} />
                                        {isMacroSyncing ? 'Atualizando...' : 'Sync Macro'}
                                    </button>
                                    <button onClick={handleSyncData} disabled={isSyncing || isGlobalRunning} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:border-blue-500">
                                        <Database size={12} className={isSyncing ? 'animate-pulse' : ''} />
                                        {isSyncing ? 'Sincronizando...' : 'Sync Preços'}
                                    </button>
                                </div>
                            </div>
                            {isMacroDataValid ? (
                                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                                    <MacroCard label="Selic" value={`${macroData?.selic?.value}%`} sub="BCB Meta" color="text-yellow-400" />
                                    <MacroCard label="CDI" value={`${macroData?.cdi?.value?.toFixed(2)}%`} sub="Est. Cetip" color="text-yellow-400" />
                                    <MacroCard label="IPCA" value={`${macroData?.ipca?.value}%`} sub="12 meses" color="text-red-400" />
                                    <MacroCard label="Ibovespa" value={Math.round(macroData?.ibov?.value || 0).toLocaleString()} change={macroData?.ibov?.change} sub="Pts" />
                                    <MacroCard label="Dólar" value={`R$ ${macroData?.usd?.value?.toFixed(3) || '0.000'}`} change={macroData?.usd?.change} sub="PTAX" />
                                    <MacroCard label="S&P 500" value={Math.round(macroData?.spx?.value || 0).toLocaleString()} change={macroData?.spx?.change} sub="US Pts" />
                                    <MacroCard label="Bitcoin" value={`$${Math.round(macroData?.btc?.value || 0).toLocaleString()}`} change={macroData?.btc?.change} sub="USD" color="text-purple-400" />
                                </div>
                            ) : (
                                <div className="text-center text-xs text-slate-500 py-4 flex flex-col items-center">
                                    <p>Carregando dados globais ou serviço indisponível...</p>
                                    {!isLoadingMacro && (
                                        <button onClick={loadMacro} className="mt-2 text-blue-500 hover:underline">Tentar Novamente</button>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* ========================= OPERAÇÕES ========================= */}
                {activeTab === 'operacoes' && (
                    <>
                        {/* Protocolo V3 */}
                        <div className="bg-[#080C14] border border-blue-900/30 rounded-2xl p-6 mb-6 relative overflow-hidden shadow-lg">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600" />
                            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                                <div>
                                    <h2 className="text-lg font-bold text-white">Protocolo V3</h2>
                                    <p className="text-slate-400 text-xs mt-1 leading-relaxed max-w-md">
                                        Coleta B3 + Valuation + Risk Scoring + Radar Alpha.
                                        <span className="text-blue-400 font-bold ml-1">1. Sync → 2. Crunch → 3. Radar</span>
                                    </p>
                                </div>
                                <button
                                    onClick={handleGlobalRun}
                                    disabled={isGlobalRunning || isSyncing}
                                    className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 shadow-xl ${isGlobalRunning ? 'bg-slate-800 text-slate-400 cursor-wait border border-slate-700' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105'}`}
                                >
                                    {isGlobalRunning ? <><RefreshCw size={16} className="animate-spin" /> Rodando Full...</> : <><Play size={16} fill="currentColor" /> Executar Tudo</>}
                                </button>
                            </div>
                        </div>

                        {/* Controle de Publicação */}
                        {publishStatus.length > 0 && (() => {
                            const pendingCount = publishStatus.filter(s => s.readyToPublish).length;
                            const lastPub = publishStatus.map(s => s.lastPublishedAt).filter(Boolean).sort().reverse()[0];
                            const daysSinceLastPub = lastPub ? Math.floor((Date.now() - new Date(lastPub).getTime()) / 86400000) : null;
                            return (
                                <div className="bg-[#080C14] border border-indigo-900/40 rounded-2xl p-5 mb-6 shadow-lg">
                                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                        <div>
                                            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
                                                <Send size={16} className="text-indigo-400" />
                                                Controle de Publicação Semanal
                                            </h3>
                                            <div className="flex items-center gap-4 text-[10px] text-slate-500 font-bold">
                                                {pendingCount > 0 ? (
                                                    <span className="text-yellow-400 flex items-center gap-1">
                                                        <AlertCircle size={10} /> {pendingCount} classe(s) com draft pronto para publicar
                                                    </span>
                                                ) : (
                                                    <span className="text-emerald-500 flex items-center gap-1">
                                                        <CheckCircle2 size={10} /> Tudo publicado
                                                    </span>
                                                )}
                                                {daysSinceLastPub !== null && (
                                                    <span className={daysSinceLastPub >= 7 ? 'text-yellow-500' : 'text-slate-500'}>
                                                        Última pub.: {daysSinceLastPub === 0 ? 'hoje' : `${daysSinceLastPub}d atrás`}
                                                        {daysSinceLastPub >= 7 && ' — recomendado publicar'}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex gap-3 mt-2">
                                                {publishStatus.map(s => (
                                                    <div key={s.assetClass} className="flex items-center gap-1">
                                                        <div className={`w-2 h-2 rounded-full ${s.isRankingPublished ? 'bg-emerald-500' : s.readyToPublish ? 'bg-yellow-500' : 'bg-slate-600'}`} />
                                                        <span className="text-[9px] text-slate-500 font-bold">{s.assetClass}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <button
                                            onClick={handlePublishAllPending}
                                            disabled={isPublishingAll || pendingCount === 0}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all border ${pendingCount > 0 ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-lg shadow-indigo-900/30' : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'}`}
                                        >
                                            {isPublishingAll ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                                            Publicar Tudo Pendente
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Matriz de Geração */}
                        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-[#0B101A]">
                                <div className="flex items-center gap-2">
                                    <Server size={18} className="text-slate-400" />
                                    <h3 className="font-bold text-white text-sm uppercase tracking-wider">Matriz de Geração & Refinamento</h3>
                                </div>
                                <p className="text-[10px] text-slate-500">Gerar → Visualizar → Publicar</p>
                            </div>
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-[#0B101A] border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                        <th className="px-5 py-3">Ativo</th>
                                        <th className="px-5 py-3 text-center">Visualizar</th>
                                        <th className="px-5 py-3 text-center">Publicar</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {ASSET_CLASSES.map((asset) => {
                                        const latest = getLatestForClass(asset.id);
                                        const ps = publishStatus.find(s => s.assetClass === asset.id);
                                        const updatedToday = isUpdatedToday(latest?.date);
                                        const hasPrompt = !!(ps?.hasExplainableAIPrompt);
                                        const hasGeneratedAI = !!(ps?.hasGeneratedExplainableAI);
                                        const latestId = ps?.latestId || latest?._id;

                                        return (
                                            <tr key={asset.id} className="hover:bg-slate-900/20 transition-colors">
                                                <td className="px-5 py-3">
                                                    <div className="flex items-center gap-3">
                                                        {asset.icon}
                                                        <div>
                                                            <span className="text-xs font-bold text-slate-300">{asset.label}</span>
                                                            <div className="flex items-center gap-1 mt-0.5">
                                                                {updatedToday ? (
                                                                    <span className="text-[9px] text-emerald-500 font-bold flex items-center gap-1"><CheckCircle2 size={9} />Hoje</span>
                                                                ) : (
                                                                    <span className="text-[9px] text-slate-600 font-bold flex items-center gap-1"><AlertCircle size={9} />Pendente</span>
                                                                )}
                                                                {ps && (
                                                                    <span className={`text-[9px] font-bold px-1 rounded ${ps.isRankingPublished ? 'text-emerald-500' : ps.readyToPublish ? 'text-yellow-500' : 'text-slate-600'}`}>
                                                                        {ps.isRankingPublished ? '● Pub.' : ps.readyToPublish ? '● Draft' : '○'}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3 text-center">
                                                    {latestId ? (
                                                        <div className="flex justify-center gap-1.5">
                                                            <button
                                                                onClick={() => openAudit(latestId)}
                                                                title="Ver Ranking Completo"
                                                                className="p-1.5 bg-slate-800 border border-slate-700 text-slate-400 rounded hover:text-white hover:bg-slate-700 transition-colors"
                                                            >
                                                                <Search size={11} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleViewPrompt(latestId, asset.id)}
                                                                disabled={!hasPrompt}
                                                                title={hasPrompt ? "Ver Prompt Explainable IA" : "Prompt não gerado ainda"}
                                                                className={`p-1.5 border rounded transition-colors ${hasPrompt ? 'bg-slate-800 border-slate-700 text-slate-400 hover:text-blue-400 hover:bg-blue-900/20 hover:border-blue-700' : 'bg-slate-800/40 border-slate-800 text-slate-700 cursor-not-allowed'}`}
                                                            >
                                                                <MessageSquare size={11} />
                                                            </button>
                                                        </div>
                                                    ) : <span className="text-[9px] text-slate-700 font-mono">—</span>}
                                                </td>
                                                <td className="px-5 py-3 text-center">
                                                    {latestId ? (
                                                        <div className="flex justify-center gap-1">
                                                            <PubBtn
                                                                icon={<Share2 size={9} />}
                                                                label="Rank"
                                                                active={!!(latest?.isRankingPublished)}
                                                                isLoading={loadingKey === `${latestId}-PUBG_RANKING`}
                                                                onClick={() => handlePublishGranular(latestId, 'RANKING')}
                                                                title="Publicar Ranking"
                                                            />
                                                            <PubBtn
                                                                icon={<Zap size={9} />}
                                                                label="IA"
                                                                active={!!(latest as any)?.isExplainableAIPublished}
                                                                disabled={!hasGeneratedAI}
                                                                isLoading={loadingKey === `${latestId}-PUBG_EXPLAINABLE_AI`}
                                                                onClick={() => handlePublishGranular(latestId, 'EXPLAINABLE_AI')}
                                                                title="Publicar Explainable IA"
                                                            />
                                                            <PubBtn
                                                                icon={<Send size={9} />}
                                                                label="Tudo"
                                                                active={false}
                                                                isLoading={loadingKey === `${latestId}-PUBG_ALL`}
                                                                onClick={() => handlePublishGranular(latestId, 'ALL')}
                                                                title="Publicar Tudo"
                                                                variant="all"
                                                            />
                                                        </div>
                                                    ) : <span className="text-[9px] text-slate-700 font-mono">—</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {/* ========================= FERRAMENTAS ========================= */}
                {activeTab === 'ferramentas' && (
                    <>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                            {/* Configuração Radar */}
                            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 shadow-lg">
                                <div className="flex items-center gap-2 mb-4">
                                    <Settings size={18} className="text-blue-500" />
                                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Configuração Radar</h3>
                                </div>
                                <div className="mb-6">
                                    <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Horizonte de Backtest (Dias)</p>
                                    <div className="flex gap-2">
                                        {[3, 7, 15, 30].map(d => (
                                            <button
                                                key={d}
                                                onClick={() => handleSaveBacktestConfig(d)}
                                                disabled={isSavingConfig}
                                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                                    backtestDays === d
                                                        ? 'bg-blue-600 text-white border-blue-500'
                                                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                                                }`}
                                            >
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Manutenção</p>
                                    <button
                                        onClick={handleClearRadarHistory}
                                        disabled={isClearingRadar}
                                        className="w-full py-2 bg-red-900/10 border border-red-900/30 text-red-500 hover:bg-red-900/20 hover:text-red-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all"
                                    >
                                        {isClearingRadar ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                        Limpar Histórico do Radar
                                    </button>
                                </div>
                            </div>

                            {/* Inspector de Cache */}
                            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 shadow-lg">
                                <div className="flex items-center gap-2 mb-4">
                                    <HardDrive size={18} className="text-emerald-500" />
                                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Inspector de Cache</h3>
                                </div>
                                <form onSubmit={handleCacheSearch} className="flex gap-0 relative mb-4">
                                    <input
                                        placeholder="Ticker..."
                                        value={cacheSearchTicker}
                                        onChange={(e) => setCacheSearchTicker(e.target.value.toUpperCase())}
                                        className="flex-1 bg-[#0B101A] border border-slate-700 border-r-0 rounded-l-xl px-4 py-2 text-sm text-white focus:outline-none font-mono uppercase"
                                    />
                                    <button type="submit" disabled={isSearchingCache} className="px-3 bg-slate-800 border border-slate-700 border-l-0 rounded-r-xl text-slate-300 hover:text-white">
                                        {isSearchingCache ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                                    </button>
                                </form>
                                {cacheData && (
                                    <div className="p-3 bg-[#0F131E] rounded-xl border border-slate-800 space-y-1">
                                        <div className="flex justify-between font-bold text-white">
                                            <span>{cacheData.ticker}</span>
                                            <span className={`text-[9px] px-1.5 rounded ${cacheData.status === 'CACHED' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>{cacheData.status}</span>
                                        </div>
                                        <p className="text-xs text-slate-400">Price: {cacheData.currentPrice?.toFixed(2)}</p>
                                        <p className="text-[10px] text-slate-600">Points: {cacheData.dataPoints}</p>
                                    </div>
                                )}
                            </div>

                            {/* Reparar Splits */}
                            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 shadow-lg">
                                <div className="flex items-center gap-2 mb-4">
                                    <Scissors size={18} className="text-yellow-500" />
                                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Reparar Splits</h3>
                                </div>
                                <p className="text-[10px] text-slate-400 mb-4">Corrige histórico de usuários pós-split.</p>
                                <form onSubmit={handleFixSplit} className="flex gap-2">
                                    <input
                                        placeholder="Ticker"
                                        value={splitTicker}
                                        onChange={(e) => setSplitTicker(e.target.value.toUpperCase())}
                                        className="flex-1 bg-[#0B101A] border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none font-mono uppercase"
                                    />
                                    <button type="submit" disabled={isFixingSplit || !splitTicker} className="px-3 py-2 bg-yellow-600/20 text-yellow-500 border border-yellow-600/30 rounded-xl hover:text-white hover:bg-yellow-600/40 transition-colors">
                                        <Zap size={16} />
                                    </button>
                                </form>
                            </div>
                        </div>

                        {/* Log de Descartes */}
                        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 shadow-lg">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-base font-bold text-white flex items-center gap-2">
                                    <ClipboardList size={18} className="text-red-500" />
                                    Log de Descartes (Quality Gate)
                                </h3>
                                <button onClick={loadDiscardLogs} className="text-xs font-bold text-blue-500 hover:text-white flex items-center gap-1">
                                    <RefreshCw size={12} className={isLoadingLogs ? 'animate-spin' : ''} /> Atualizar
                                </button>
                            </div>
                            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[300px] custom-scrollbar">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-[#0B101A] sticky top-0 z-10">
                                        <tr>
                                            <th className="p-3 font-bold text-slate-500 uppercase">Data</th>
                                            <th className="p-3 font-bold text-slate-500 uppercase">Ativo</th>
                                            <th className="p-3 font-bold text-slate-500 uppercase">Motivo</th>
                                            <th className="p-3 font-bold text-slate-500 uppercase">Detalhe</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50 bg-[#05070A]">
                                        {discardLogs.length === 0 ? (
                                            <tr><td colSpan={4} className="p-8 text-center text-slate-500">Nenhum descarte recente.</td></tr>
                                        ) : (
                                            discardLogs.map((log: any) => (
                                                <tr key={log._id} className="hover:bg-slate-900/30">
                                                    <td className="p-3 text-slate-400 font-mono w-32">{new Date(log.createdAt).toLocaleString()}</td>
                                                    <td className="p-3 text-white font-bold w-24">{log.ticker}</td>
                                                    <td className="p-3 text-red-400 font-bold">{log.reason}</td>
                                                    <td className="p-3 text-slate-500">{log.details}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </main>

            <AuditDetailModal isOpen={auditModalOpen} onClose={() => setAuditModalOpen(false)} report={selectedAuditReport} />

            {/* Modal — Prompt + Explainable IA */}
            {promptModal.open && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#0B101A] border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
                        <div className="flex items-center justify-between p-5 border-b border-slate-800">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <MessageSquare size={16} className="text-blue-400" />
                                Explainable IA — {promptModal.assetClass}
                            </h3>
                            <button onClick={() => { setPromptModal(p => ({ ...p, open: false })); setLocalGeneratedText(''); setUserHasEdited(false); }} className="text-slate-500 hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="overflow-y-auto p-5 space-y-4">
                            {isLoadingPrompt ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-3">
                                    <RefreshCw size={22} className="animate-spin text-blue-500" />
                                    <p className="text-sm font-bold text-slate-400">Carregando prompt...</p>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Prompt Gerado (copie e cole em qualquer IA)</p>
                                            <button
                                                onClick={() => { navigator.clipboard.writeText(promptModal.prompt); }}
                                                className="flex items-center gap-1 text-[9px] font-bold text-blue-400 hover:text-white bg-blue-900/20 border border-blue-900/50 px-2 py-1 rounded transition-colors"
                                            >
                                                <Copy size={10} /> Copiar
                                            </button>
                                        </div>
                                        <textarea
                                            readOnly
                                            value={promptModal.prompt || 'Prompt não disponível. Rode o sync:prod.'}
                                            className="w-full h-40 bg-slate-900 border border-slate-700 rounded-lg p-3 text-[10px] text-slate-400 font-mono resize-none focus:outline-none"
                                        />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                            Texto Explainable IA
                                            {userHasEdited && <span className="ml-2 text-yellow-400 normal-case font-normal">(editado — clique em Salvar para confirmar)</span>}
                                        </p>
                                        <button
                                            onClick={handleGenerateExplainableAI}
                                            disabled={isGeneratingAI || (!promptModal.prompt && !userHasEdited)}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isGeneratingAI ? <RefreshCw size={12} className="animate-spin" /> : <Bot size={12} />}
                                            {isGeneratingAI ? 'Salvando...' : 'Salvar'}
                                        </button>
                                    </div>
                                    <textarea
                                        value={localGeneratedText || ''}
                                        onChange={e => { setLocalGeneratedText(e.target.value); setUserHasEdited(true); }}
                                        placeholder="Cole aqui o texto gerado por outra IA, ou clique em Salvar para usar o Gemini."
                                        className="w-full h-48 bg-slate-900 border border-slate-700 rounded-lg p-3 text-[11px] text-slate-300 font-sans resize-none focus:outline-none leading-relaxed focus:border-indigo-600"
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const PubBtn = ({ icon, label, active, onClick, disabled, isLoading, title, variant }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; disabled?: boolean; isLoading?: boolean; title?: string; variant?: 'all' }) => (
    <button
        onClick={onClick}
        disabled={disabled || isLoading || (active && variant !== 'all')}
        title={title}
        className={`flex items-center gap-0.5 px-1.5 py-1 rounded text-[9px] font-black uppercase transition-all border ${
            active && variant !== 'all'
                ? 'bg-emerald-900/20 text-emerald-400 border-emerald-900/50 cursor-default'
                : variant === 'all'
                ? 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-indigo-700 hover:border-indigo-500 hover:text-white'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-blue-500 hover:text-white'
        } ${disabled ? 'opacity-30 cursor-not-allowed' : ''} ${isLoading ? 'animate-pulse' : ''}`}
    >
        {isLoading ? <RefreshCw size={8} className="animate-spin" /> : icon}
        {label}
    </button>
);

const MacroCard = ({ label, value, change, sub, color }: { label: string, value: string, change?: number, sub: string, color?: string }) => (
    <div className="bg-[#0F131E] border border-slate-800 p-3 rounded-xl flex flex-col justify-between h-full">
        <div>
            <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">{label}</p>
            <p className={`text-sm font-mono font-bold ${color || 'text-white'}`}>{value}</p>
        </div>
        <div className="flex justify-between items-end mt-2">
            <span className="text-[9px] text-slate-600">{sub}</span>
            {change !== undefined && (
                <span className={`text-[9px] font-bold flex items-center ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {change > 0 ? <TrendingUp size={8} className="mr-0.5" /> : change < 0 ? <TrendingDown size={8} className="mr-0.5" /> : <Minus size={8} className="mr-0.5" />}
                    {Math.abs(change).toFixed(2)}%
                </span>
            )}
        </div>
    </div>
);
