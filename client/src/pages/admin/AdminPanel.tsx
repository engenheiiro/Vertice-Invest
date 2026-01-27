
import React, { useEffect, useState } from 'react';
import { Header } from '../../components/dashboard/Header';
import { researchService, ResearchReport } from '../../services/research';
import { Bot, RefreshCw, CheckCircle2, AlertCircle, History, Activity, ShieldCheck, BarChart3, Layers, Globe, Zap, Search, Play, Server, Clock, TrendingUp, TrendingDown, Sparkles } from 'lucide-react';
import { AuditDetailModal } from '../../components/admin/AuditDetailModal';

// Constantes de Configuração
const ASSET_CLASSES = [
    { id: 'BRASIL_10', label: 'Brasil 10 (Mix)', icon: <ShieldCheck size={18} className="text-emerald-500" />, desc: 'Carteira Defensiva Top Picks' },
    { id: 'STOCK', label: 'Ações Brasil', icon: <BarChart3 size={18} className="text-blue-500" />, desc: 'B3: Ibovespa & Small Caps' },
    { id: 'FII', label: 'Fundos Imobiliários', icon: <Layers size={18} className="text-indigo-500" />, desc: 'IFIX: Tijolo, Papel & Fiagros' },
    { id: 'STOCK_US', label: 'Mercado Global', icon: <Globe size={18} className="text-cyan-500" />, desc: 'NYSE & NASDAQ (Stocks)' },
    { id: 'CRYPTO', label: 'Criptoativos', icon: <Zap size={18} className="text-purple-500" />, desc: 'Top Cap & Projetos DeFi' }
];

export const AdminPanel = () => {
    const [history, setHistory] = useState<any[]>([]); 
    const [loadingKey, setLoadingKey] = useState<string | null>(null); 
    const [statusMsg, setStatusMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
    const [auditModalOpen, setAuditModalOpen] = useState(false);
    const [selectedAuditReport, setSelectedAuditReport] = useState<ResearchReport | null>(null);
    const [isGlobalRunning, setIsGlobalRunning] = useState(false);
    
    // Novos Estados Macro
    const [macroData, setMacroData] = useState<any>(null);
    const [isLoadingMacro, setIsLoadingMacro] = useState(true);

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
            setMacroData(data);
        } catch (e) {
            console.error("Erro macro", e);
        } finally {
            setIsLoadingMacro(false);
        }
    };

    useEffect(() => {
        loadHistory();
        loadMacro();
    }, []);

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

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main className="max-w-[1400px] mx-auto p-6 animate-fade-in">
                
                {/* Header da Página Admin */}
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

                {/* --- DASHBOARD MACROECONÔMICO --- */}
                <div className="bg-[#0B101A] border border-slate-800 rounded-2xl p-4 mb-8">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <Globe size={14} className="text-blue-500" />
                            Ambiente Macroeconômico (Ao Vivo)
                        </h3>
                        {isLoadingMacro && <RefreshCw size={12} className="text-slate-500 animate-spin" />}
                    </div>
                    
                    {macroData ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                            <MacroCard label="Selic" value={`${macroData.selic.value}%`} sub="BCB Meta" color="text-yellow-400" />
                            <MacroCard label="CDI" value={`${macroData.cdi.value.toFixed(2)}%`} sub="Est. Cetip" color="text-yellow-400" />
                            <MacroCard label="IPCA (12m)" value={`${macroData.ipca.value}%`} sub="Inflação" color="text-red-400" />
                            <MacroCard label="Ibovespa" value={Math.round(macroData.ibov.value).toLocaleString()} change={macroData.ibov.change} sub="B3 Pts" />
                            <MacroCard label="Dólar" value={`R$ ${macroData.usd.value.toFixed(3)}`} change={macroData.usd.change} sub="PTAX" />
                            <MacroCard label="S&P 500" value={Math.round(macroData.spx.value).toLocaleString()} change={macroData.spx.change} sub="US Pts" />
                            <MacroCard label="Bitcoin" value={`$${Math.round(macroData.btc.value).toLocaleString()}`} change={macroData.btc.change} sub="USD" color="text-purple-400" />
                        </div>
                    ) : (
                        <div className="text-center text-xs text-slate-500 py-4">Carregando dados globais...</div>
                    )}
                </div>

                {/* --- ÁREA DE COMANDO CENTRAL (ETAPA 1) --- */}
                <div className="bg-[#080C14] border border-blue-900/30 rounded-2xl p-8 mb-10 text-center relative overflow-hidden shadow-2xl">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600"></div>
                    
                    <h2 className="text-xl font-bold text-white mb-2">Protocolo de Análise V3 (Matemático)</h2>
                    <p className="text-slate-400 text-sm mb-6 max-w-xl mx-auto">
                        Etapa 1: Coleta de dados (B3/Fundamentus), Cálculo de Valuation (Graham/Bazin) e Classificação de Risco inicial.
                    </p>

                    <button
                        onClick={handleGlobalRun}
                        disabled={isGlobalRunning}
                        className={`
                            relative px-8 py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all
                            flex items-center justify-center gap-3 mx-auto shadow-xl
                            ${isGlobalRunning 
                                ? 'bg-slate-800 text-slate-400 cursor-wait border border-slate-700' 
                                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105'
                            }
                        `}
                    >
                        {isGlobalRunning ? (
                            <>
                                <RefreshCw size={20} className="animate-spin" />
                                Calculando Dados...
                            </>
                        ) : (
                            <>
                                <Play size={20} fill="currentColor" />
                                INICIAR CÁLCULO QUANTITATIVO
                            </>
                        )}
                    </button>
                </div>

                {/* Feedback Message */}
                {statusMsg && (
                    <div className={`mb-6 p-4 rounded-xl border flex items-center gap-3 animate-fade-in shadow-lg ${
                        statusMsg.type === 'success' ? 'bg-emerald-900/20 border-emerald-900/50 text-emerald-400' : 'bg-red-900/20 border-red-900/50 text-red-400'
                    }`}>
                        {statusMsg.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
                        <span className="text-base font-bold">{statusMsg.text}</span>
                    </div>
                )}

                {/* PAINEL DE CONTROLE POR ATIVO (ETAPA 2) */}
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
                                                disabled={!updatedToday || isLoadingEnhance}
                                                className={`
                                                    mx-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border
                                                    ${!updatedToday 
                                                        ? 'bg-slate-800/50 border-slate-800 text-slate-600 cursor-not-allowed'
                                                        : 'bg-purple-900/20 border-purple-500/30 text-purple-400 hover:bg-purple-900/40 hover:text-white hover:border-purple-500'
                                                    }
                                                `}
                                                title="Busca notícias no Google e reajusta o ranking matemático"
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
                                            {latest && (
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
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* HISTÓRICO DE LOGS */}
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
                    {change >= 0 ? <TrendingUp size={8} className="mr-0.5" /> : <TrendingDown size={8} className="mr-0.5" />}
                    {Math.abs(change).toFixed(2)}%
                </span>
            )}
        </div>
    </div>
);
