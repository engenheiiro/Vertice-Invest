
// ... (Imports e States mantidos) ...
import React, { useEffect, useState } from 'react';
import { Header } from '../../components/dashboard/Header';
import { researchService, ResearchReport } from '../../services/research';
import { marketService } from '../../services/market';
import { Bot, RefreshCw, CheckCircle2, AlertCircle, History, Activity, ShieldCheck, BarChart3, Layers, Globe, Zap, Search, Play, Server, Clock, TrendingUp, TrendingDown, Sparkles, Database, Minus, HardDrive, Terminal } from 'lucide-react';
import { AuditDetailModal } from '../../components/admin/AuditDetailModal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

// ... (Constantes mantidas) ...
const ASSET_CLASSES = [
    { id: 'BRASIL_10', label: 'Brasil 10 (Mix)', icon: <ShieldCheck size={18} className="text-emerald-500" />, desc: 'Carteira Defensiva Top Picks' },
    { id: 'STOCK', label: 'Ações Brasil', icon: <BarChart3 size={18} className="text-blue-500" />, desc: 'B3: Ibovespa & Small Caps' },
    { id: 'FII', label: 'Fundos Imobiliários', icon: <Layers size={18} className="text-indigo-500" />, desc: 'IFIX: Tijolo, Papel & Fiagros' },
    { id: 'STOCK_US', label: 'Mercado Global', icon: <Globe size={18} className="text-cyan-500" />, desc: 'NYSE & NASDAQ (Stocks)' },
    { id: 'CRYPTO', label: 'Criptoativos', icon: <Zap size={18} className="text-purple-500" />, desc: 'Top Cap & Projetos DeFi' }
];

export const AdminPanel = () => {
    // ... (Hooks e funções mantidos) ...
    const [history, setHistory] = useState<any[]>([]); 
    const [loadingKey, setLoadingKey] = useState<string | null>(null); 
    const [statusMsg, setStatusMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
    const [auditModalOpen, setAuditModalOpen] = useState(false);
    const [selectedAuditReport, setSelectedAuditReport] = useState<ResearchReport | null>(null);
    const [isGlobalRunning, setIsGlobalRunning] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    
    // Novos Estados Macro
    const [macroData, setMacroData] = useState<any>(null);
    const [isLoadingMacro, setIsLoadingMacro] = useState(true);

    // Estados Inspector de Cache
    const [cacheSearchTicker, setCacheSearchTicker] = useState('');
    const [cacheData, setCacheData] = useState<any>(null);
    const [isSearchingCache, setIsSearchingCache] = useState(false);

    // ... (Funções loadHistory, loadMacro, handleSyncData, handleGlobalRun, handleEnhanceWithAI, handleAction, handleCacheSearch, openAudit, getLatestForClass, isUpdatedToday, isMacroDataValid mantidas) ...
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

    useEffect(() => {
        loadHistory();
        loadMacro();
    }, []);

    const handleSyncData = async () => {
        setIsSyncing(true);
        setStatusMsg(null);
        try {
            await researchService.syncMarketData();
            setStatusMsg({ type: 'success', text: "Banco de Dados atualizado com sucesso! Cotações sincronizadas." });
            await loadMacro(); // Recarrega macro para ver o timestamp novo
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: e.message || "Erro na sincronização." });
        } finally {
            setIsSyncing(false);
            setTimeout(() => setStatusMsg(null), 5000);
        }
    };

    const handleGlobalRun = async () => {
        setIsGlobalRunning(true);
        setStatusMsg(null);

        try {
            await researchService.crunchNumbers(undefined, true);
            setStatusMsg({ type: 'success', text: "Ciclo de Análise Quantitativa Finalizado!" });
            await loadHistory(); 
        } catch (error: any) {
            setStatusMsg({ type: 'error', text: error.message || "Erro durante o processamento global." });
        } finally {
            setIsGlobalRunning(false);
            setTimeout(() => setStatusMsg(null), 8000);
        }
    };

    const handleEnhanceWithAI = async (assetId: string) => {
        setLoadingKey(`${assetId}-AI_ENHANCE`);
        setStatusMsg(null);
        try {
            await researchService.enhanceReport(assetId);
            setStatusMsg({ type: 'success', text: `Refinamento IA aplicado em ${assetId}. Dados qualitativos integrados.` });
            await loadHistory();
        } catch (error: any) {
            setStatusMsg({ type: 'error', text: error.message || "Erro na IA." });
        } finally {
            setLoadingKey(null);
            setTimeout(() => setStatusMsg(null), 6000);
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
            await loadHistory();
        } catch (error) {
            setStatusMsg({ type: 'error', text: "Falha na execução." });
        } finally { 
            setLoadingKey(null);
            setTimeout(() => setStatusMsg(null), 5000);
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

    const openAudit = async (reportId: string) => {
        try {
            const fullReport = await researchService.getReportDetails(reportId);
            setSelectedAuditReport(fullReport);
            setAuditModalOpen(true);
        } catch (e) {
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

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main className="max-w-[1400px] mx-auto p-6 animate-fade-in">
                {/* Header da Página Admin (Mantido) */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/20">
                                <Bot size={24} className="text-white" />
                            </div>
                            Vértice AI Control Room
                        </h1>
                        <p className="text-slate-400 text-sm mt-1 ml-13">Gerencie a ingestão de inteligência de mercado.</p>
                    </div>
                    
                    <div className="flex items-center gap-4">
                         <div className="flex items-center gap-2 px-3 py-1.5 bg-green-900/20 border border-green-900/50 rounded-full">
                            <Activity size={12} className="text-green-500 animate-pulse" />
                            <span className="text-xs font-bold text-green-500">SYSTEM ONLINE</span>
                         </div>
                    </div>
                </div>

                {/* === ÁREA SUPERIOR (Mantido) === */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    <div className="lg:col-span-2 bg-[#0B101A] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex flex-col">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                    <Globe size={14} className="text-blue-500" />
                                    Ambiente Macroeconômico
                                </h3>
                                {/* TIMESTAMP DE ATUALIZAÇÃO */}
                                {macroData?.lastUpdated && (
                                    <span className="text-[10px] text-slate-500 font-mono mt-1 ml-6 flex items-center gap-1">
                                        <Clock size={10} />
                                        Última Sync: {new Date(macroData.lastUpdated).toLocaleString()}
                                    </span>
                                )}
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={handleSyncData}
                                    disabled={isSyncing}
                                    className={`
                                        flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border
                                        ${isSyncing 
                                            ? 'bg-blue-900/20 text-blue-400 border-blue-900/50 cursor-wait' 
                                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:border-blue-500'
                                        }
                                    `}
                                    title="Forçar atualização de preços e indicadores no banco de dados"
                                >
                                    <Database size={12} className={isSyncing ? 'animate-pulse' : ''} />
                                    {isSyncing ? 'Sincronizando...' : 'Sync Preços'}
                                </button>
                                {isLoadingMacro && <RefreshCw size={12} className="text-slate-500 animate-spin" />}
                            </div>
                        </div>
                        
                        {isMacroDataValid ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                                <MacroCard label="Selic" value={`${macroData?.selic?.value}%`} sub="BCB Meta" color="text-yellow-400" />
                                <MacroCard label="CDI" value={`${macroData?.cdi?.value?.toFixed(2)}%`} sub="Est. Cetip" color="text-yellow-400" />
                                <MacroCard label="IPCA" value={`${macroData?.ipca?.value}%`} sub="12 meses" color="text-red-400" />
                                <MacroCard label="Ibovespa" value={Math.round(macroData?.ibov?.value || 0).toLocaleString()} change={macroData?.ibov?.change} sub="Pts" />
                                <MacroCard label="Dólar" value={`R$ ${macroData?.usd?.value?.toFixed(3) || '0.000'}`} change={macroData?.usd?.change} sub="PTAX" />
                                <MacroCard label="S&P 500" value={Math.round(macroData?.spx?.value || 0).toLocaleString()} change={macroData?.spx?.change} sub="US Pts" />
                                <MacroCard label="Bitcoin" value={`$${Math.round(macroData?.btc?.value || 0).toLocaleString()}`} change={macroData?.btc?.change} sub="USD" color="text-purple-400" />
                            </div>
                        ) : (
                            <div className="text-center text-xs text-slate-500 py-4 flex flex-col items-center flex-1 justify-center">
                                <p>Carregando dados globais ou serviço indisponível...</p>
                                {!isLoadingMacro && (
                                    <button onClick={loadMacro} className="mt-2 text-blue-500 hover:underline">Tentar Novamente</button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-1 bg-[#080C14] border border-blue-900/30 rounded-2xl p-6 text-center relative overflow-hidden shadow-lg flex flex-col justify-center items-center">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600"></div>
                        <div className="mb-4">
                            <h2 className="text-lg font-bold text-white leading-tight">Protocolo V3</h2>
                            <p className="text-slate-400 text-[10px] mt-1 px-4 leading-relaxed">
                                Coleta B3, Valuation e Risk Scoring em massa.
                            </p>
                        </div>
                        <button
                            onClick={handleGlobalRun}
                            disabled={isGlobalRunning}
                            className={`w-full max-w-[200px] px-4 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-xl ${isGlobalRunning ? 'bg-slate-800 text-slate-400 cursor-wait border border-slate-700' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105'}`}
                        >
                            {isGlobalRunning ? <><RefreshCw size={16} className="animate-spin" /> Processando...</> : <><Play size={16} fill="currentColor" /> Executar</>}
                        </button>
                    </div>
                </div>

                {/* === ÁREA INFERIOR: Inspector de Cache (Mantido) === */}
                <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 mb-10 shadow-lg">
                    <div className="flex items-center gap-2 mb-4">
                        <HardDrive size={18} className="text-emerald-500" />
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Inspector de Cache</h3>
                        <div className="h-px bg-slate-800 flex-1 ml-4"></div>
                    </div>
                    <div className="flex flex-col md:flex-row gap-6">
                        <div className="w-full md:w-1/3 flex flex-col justify-center">
                            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                                Consulte o estado do cache de dados históricos e cotações. Digite o ticker para verificar se os dados estão consistentes.
                            </p>
                            <form onSubmit={handleCacheSearch} className="flex gap-0 relative">
                                <div className="relative flex-1">
                                    <input placeholder="Ex: PETR4..." value={cacheSearchTicker} onChange={(e) => setCacheSearchTicker(e.target.value.toUpperCase())} className="w-full bg-[#0B101A] border border-slate-700 border-r-0 rounded-l-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 font-mono uppercase" />
                                </div>
                                <button type="submit" disabled={isSearchingCache} className="px-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 border-l-0 rounded-r-xl text-slate-300 hover:text-white transition-colors disabled:opacity-50">
                                    {isSearchingCache ? <RefreshCw size={18} className="animate-spin"/> : <Search size={18} />}
                                </button>
                            </form>
                        </div>
                        <div className="w-full md:w-2/3 bg-[#0B101A] border border-slate-800 rounded-xl min-h-[140px] relative overflow-hidden flex items-center justify-center">
                            {!cacheData ? (
                                <div className="text-center opacity-40">
                                    <Terminal size={40} className="mx-auto mb-2 text-slate-600" />
                                    <p className="text-xs font-mono text-slate-500">Aguardando comando...</p>
                                </div>
                            ) : cacheData.status === 'NOT_CACHED' ? (
                                <div className="text-center">
                                    <div className="w-12 h-12 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-3 border border-red-900/40">
                                        <AlertCircle size={24} className="text-red-500" />
                                    </div>
                                    <h4 className="text-white font-bold mb-1">Cache Miss</h4>
                                    <p className="text-xs text-slate-400">O ativo <strong className="text-red-400">{cacheData.ticker}</strong> não está no banco.</p>
                                </div>
                            ) : (
                                <div className="w-full h-full p-6">
                                    <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-3">
                                        <div className="flex items-center gap-3">
                                            <div className="text-2xl font-black text-white tracking-tighter">{cacheData.ticker}</div>
                                            <span className="px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-900/50 text-[10px] font-bold uppercase">Cached</span>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] text-slate-500 uppercase font-bold">Data Points</p>
                                            <p className="text-lg font-mono text-white">{cacheData.dataPoints}</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Range de Dados</p>
                                            <p className="text-xs text-slate-300 font-mono">
                                                {new Date(cacheData.firstDate).toLocaleDateString()} {'->'} {new Date(cacheData.lastDate).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Última Sync</p>
                                            <p className="text-xs text-slate-300 font-mono">
                                                {new Date(cacheData.lastUpdated).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-3 border-t border-slate-800">
                                        <p className="text-[9px] text-slate-500 uppercase font-bold mb-2">Amostra Recente (Close)</p>
                                        <div className="flex gap-2 overflow-hidden">
                                            {cacheData.sample.map((s: any, idx: number) => (
                                                <div key={idx} className="bg-slate-900 px-2 py-1 rounded border border-slate-800 text-[10px] font-mono text-slate-300">
                                                    {s.close.toFixed(2)}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* PAINEL DE CONTROLE POR ATIVO (ETAPA 2) - Mantido igual */}
                <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl mb-10">
                    <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-[#0B101A]">
                        <div className="flex items-center gap-2">
                            <Server size={18} className="text-slate-400" />
                            <h3 className="font-bold text-white text-sm uppercase tracking-wider">Refinamento & Publicação</h3>
                        </div>
                    </div>
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-[#0B101A] border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                <th className="px-6 py-4">Ativo</th>
                                <th className="px-6 py-4">Status Quant</th>
                                <th className="px-6 py-4 text-center">Refinamento (IA)</th>
                                <th className="px-6 py-4 text-right">Ações Finais</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {ASSET_CLASSES.map((asset) => {
                                const latest = getLatestForClass(asset.id);
                                const updatedToday = isUpdatedToday(latest?.date);
                                const isLoadingEnhance = loadingKey === `${asset.id}-AI_ENHANCE`;
                                
                                // Bloqueio para STOCK_US e CRYPTO
                                const isRestricted = asset.id === 'CRYPTO' || asset.id === 'STOCK_US';

                                return (
                                    <tr key={asset.id} className="hover:bg-slate-900/30 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                {asset.icon}
                                                <span className="text-xs font-bold text-slate-300">{asset.label}</span>
                                            </div>
                                        </td>

                                        <td className="px-6 py-4">
                                            {updatedToday ? (
                                                <div className="flex items-center gap-2 text-emerald-500 text-[10px] font-bold">
                                                    <CheckCircle2 size={12} /> Atualizado Hoje
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-red-500 text-[10px] font-bold opacity-70">
                                                    <AlertCircle size={12} /> Pendente
                                                </div>
                                            )}
                                        </td>

                                        <td className="px-6 py-4 text-center">
                                            {/* BOTÃO DE REFINAMENTO IA */}
                                            <button 
                                                onClick={() => handleEnhanceWithAI(asset.id)}
                                                disabled={!updatedToday || isLoadingEnhance || isRestricted}
                                                className={`
                                                    mx-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border
                                                    ${isRestricted 
                                                        ? 'opacity-30 cursor-not-allowed bg-slate-800 border-slate-700 text-slate-500' 
                                                        : (!updatedToday 
                                                            ? 'bg-slate-800/50 border-slate-800 text-slate-600 cursor-not-allowed'
                                                            : 'bg-purple-900/20 border-purple-500/30 text-purple-400 hover:bg-purple-900/40 hover:text-white hover:border-purple-500')
                                                    }
                                                `}
                                                title={isRestricted ? "Indisponível para esta classe" : "Busca notícias no Google e reajusta o ranking matemático"}
                                            >
                                                {isLoadingEnhance ? (
                                                    <RefreshCw size={12} className="animate-spin" />
                                                ) : (
                                                    <Sparkles size={12} fill="currentColor" />
                                                )}
                                                Refinar com IA
                                            </button>
                                        </td>

                                        <td className="px-6 py-4 text-right">
                                            {latest && !isRestricted && (
                                                <div className="flex items-center justify-end gap-2">
                                                    {/* Botão Ver Resultado (Audit) */}
                                                    <button 
                                                        onClick={() => openAudit(latest._id)}
                                                        className="text-[10px] font-bold text-slate-400 hover:text-white bg-slate-800 px-2 py-1 rounded hover:bg-slate-700"
                                                    >
                                                        <Search size={12} />
                                                    </button>

                                                    <div className="w-px h-3 bg-slate-800 mx-1"></div>

                                                    <QuickActionBtn 
                                                        active={latest.isRankingPublished} 
                                                        label="Rank" 
                                                        onClick={() => handleAction(latest._id, 'PUB_RANK')}
                                                        isLoading={loadingKey === `${latest._id}-PUB_RANK`}
                                                    />
                                                    
                                                    {/* Botão Gerar Texto descritivo (Morning Call) */}
                                                    <button 
                                                        onClick={() => handleAction(latest._id, 'IA_NARRATIVE')}
                                                        disabled={loadingKey === `${latest._id}-IA_NARRATIVE`}
                                                        className={`p-1.5 rounded hover:bg-slate-800 ${latest.content.morningCall ? 'text-emerald-500' : 'text-slate-500'}`}
                                                        title="Gerar Texto Explicativo"
                                                    >
                                                        <Bot size={14} />
                                                    </button>

                                                    <QuickActionBtn 
                                                        active={latest.isMorningCallPublished} 
                                                        label="Pub. Call" 
                                                        disabled={!latest.content.morningCall}
                                                        onClick={() => handleAction(latest._id, 'PUB_MC')}
                                                        isLoading={loadingKey === `${latest._id}-PUB_MC`}
                                                    />
                                                </div>
                                            )}
                                            {isRestricted && (
                                                <span className="text-[10px] text-slate-600 font-mono opacity-50">-- RESTRICTED --</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* HISTÓRICO DE LOGS (Mantido) */}
                <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <History size={18} className="text-slate-500" />
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider">Log de Execução</h3>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-slate-800">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-[#0B101A]">
                                <tr>
                                    <th className="p-3 font-bold text-slate-500">Data</th>
                                    <th className="p-3 font-bold text-slate-500">Ativo</th>
                                    <th className="p-3 font-bold text-slate-500">Estratégia</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {history.slice(0, 8).map((h, idx) => (
                                    <tr key={idx} className="hover:bg-slate-900/50">
                                        <td className="p-3 text-slate-300 font-mono">
                                            {new Date(h.date).toLocaleString()}
                                        </td>
                                        <td className="p-3 text-slate-300">
                                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-bold text-[10px]">
                                                {h.assetClass}
                                            </span>
                                        </td>
                                        <td className="p-3 text-slate-500 font-mono text-[10px]">
                                            {h.strategy}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            </main>

            {/* Modal de Auditoria */}
            <AuditDetailModal 
                isOpen={auditModalOpen} 
                onClose={() => setAuditModalOpen(false)} 
                report={selectedAuditReport} 
            />
        </div>
    );
};

const QuickActionBtn = ({ active, label, onClick, disabled, isLoading }: any) => (
    <button 
        onClick={onClick}
        disabled={disabled || isLoading}
        className={`
            px-2 py-1 rounded text-[9px] font-black uppercase transition-all border
            ${active 
                ? 'bg-emerald-900/20 text-emerald-400 border-emerald-900/50 cursor-default' 
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-blue-500 hover:text-white'}
            ${disabled ? 'opacity-30 cursor-not-allowed grayscale' : ''}
            ${isLoading ? 'animate-pulse' : ''}
        `}
    >
        {isLoading ? '...' : active ? label : label}
    </button>
);

const MacroCard = ({ label, value, change, sub, color }: any) => (
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
