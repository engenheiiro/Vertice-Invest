import React, { useEffect, useState } from 'react';
import { Header } from '../../components/dashboard/Header';
import { researchService, ResearchReport } from '../../services/research';
import { 
    Zap, Calculator, CheckCircle2, AlertCircle, 
    Clock, BarChart3, Bot, Globe, ShieldCheck, Layers, Search 
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { AuditDetailModal } from '../../components/admin/AuditDetailModal';

const ASSET_CLASSES = [
    { id: 'BRASIL_10', label: 'Brasil 10', icon: <ShieldCheck size={14} className="text-emerald-500" /> },
    { id: 'STOCK', label: 'Ações BR', icon: <BarChart3 size={14} className="text-blue-500" /> },
    { id: 'FII', label: 'FIIs BR', icon: <Layers size={14} className="text-indigo-500" /> },
    { id: 'STOCK_US', label: 'Exterior', icon: <Globe size={14} className="text-cyan-500" /> },
    { id: 'CRYPTO', label: 'Cripto', icon: <Zap size={14} className="text-purple-500" /> },
];

export const AdminPanel = () => {
    const [history, setHistory] = useState<ResearchReport[]>([]);
    const [loading, setLoading] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
    
    // Estados para Auditoria
    const [auditModalOpen, setAuditModalOpen] = useState(false);
    const [selectedAuditReport, setSelectedAuditReport] = useState<ResearchReport | null>(null);

    const loadData = async () => {
        try {
            const data = await researchService.getHistory();
            setHistory(data);
        } catch (e) {
            console.error("Erro ao carregar histórico", e);
        }
    };

    useEffect(() => { loadData(); }, []);

    const handleBatchSync = async () => {
        setLoading('batch');
        setStatusMsg(null);
        try {
            await researchService.crunchNumbers(undefined, true);
            setStatusMsg({ type: 'success', text: "Processamento em Lote Concluído! Dados Atualizados." });
            await loadData();
        } catch (error) {
            setStatusMsg({ type: 'error', text: "Erro no processamento em lote." });
        } finally { setLoading(null); }
    };

    const handleAction = async (id: string, action: 'IA' | 'PUB_RANK' | 'PUB_MC' | 'PUB_BOTH') => {
        setLoading(`${id}-${action}`);
        try {
            if (action === 'IA') await researchService.generateNarrative(id);
            if (action === 'PUB_RANK') await researchService.publish(id, 'RANKING');
            if (action === 'PUB_MC') await researchService.publish(id, 'MORNING_CALL');
            if (action === 'PUB_BOTH') await researchService.publish(id, 'BOTH');
            
            setStatusMsg({ type: 'success', text: "Ação executada com sucesso." });
            await loadData();
        } catch (error) {
            setStatusMsg({ type: 'error', text: "Falha na execução." });
        } finally { setLoading(null); }
    };

    const openAudit = async (reportId: string) => {
        // Busca o relatório completo (com fullAuditLog) antes de abrir
        try {
            const fullReport = await researchService.getReportDetails(reportId);
            setSelectedAuditReport(fullReport);
            setAuditModalOpen(true);
        } catch (e) {
            alert("Erro ao carregar detalhes da auditoria.");
        }
    };

    const getLatestForClass = (classId: string) => {
        return history.find(h => h.assetClass === classId);
    };

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />
            
            <main className="max-w-[1200px] mx-auto p-6 animate-fade-in">
                
                {/* Header Compacto */}
                <div className="flex items-center justify-between mb-8 border-b border-slate-800 pb-6">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                            <h1 className="text-lg font-black tracking-tight uppercase">Vértice Intelligence Unit</h1>
                        </div>
                        <p className="text-xs text-slate-500 font-medium italic">Painel de Orquestração Quantitativa & IA</p>
                    </div>

                    <Button 
                        onClick={handleBatchSync} 
                        status={loading === 'batch' ? 'loading' : 'idle'}
                        className="w-auto py-2.5 px-6 text-xs bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/20"
                    >
                        <Calculator size={14} className="mr-2" /> Sincronizar Todos os Rankings
                    </Button>
                </div>

                {/* Feedback Message */}
                {statusMsg && (
                    <div className={`mb-6 p-4 rounded-xl border flex items-center gap-3 animate-fade-in ${
                        statusMsg.type === 'success' ? 'bg-emerald-900/10 border-emerald-900/30 text-emerald-400' : 'bg-red-900/10 border-red-900/30 text-red-400'
                    }`}>
                        {statusMsg.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                        <span className="text-sm font-bold">{statusMsg.text}</span>
                    </div>
                )}

                {/* Tabela de Comando Central */}
                <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl mb-10">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-[#0B101A] border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                <th className="px-6 py-4">Classe de Ativo</th>
                                <th className="px-6 py-4">Auditoria Matemática</th>
                                <th className="px-6 py-4">Status IA Narrativa</th>
                                <th className="px-6 py-4 text-right">Ações de Controle</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {ASSET_CLASSES.map((asset) => {
                                const latest = getLatestForClass(asset.id);

                                return (
                                    <tr key={asset.id} className="hover:bg-slate-900/30 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center border border-slate-800 group-hover:border-slate-700">
                                                    {asset.icon}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black text-white">{asset.label}</p>
                                                    {latest && (
                                                        <p className="text-[9px] text-slate-500 font-mono mt-0.5">
                                                            {new Date(latest.date).toLocaleString('pt-BR', {
                                                                day: '2-digit', month: '2-digit', year: '2-digit',
                                                                hour: '2-digit', minute: '2-digit'
                                                            })}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        
                                        <td className="px-6 py-4">
                                            {latest ? (
                                                <button 
                                                    onClick={() => openAudit(latest._id)}
                                                    className="flex items-center gap-2 group/btn"
                                                >
                                                    <div className="w-7 h-7 bg-emerald-900/20 rounded-lg flex items-center justify-center border border-emerald-900/30 group-hover/btn:border-emerald-500 transition-all">
                                                        <Search size={12} className="text-emerald-500" />
                                                    </div>
                                                    <span className="text-[10px] font-bold text-slate-300 underline decoration-slate-700 underline-offset-4 group-hover/btn:text-white">Ver Detalhes do Estudo</span>
                                                </button>
                                            ) : (
                                                <span className="text-[10px] font-bold text-slate-600 italic">Pendente...</span>
                                            )}
                                        </td>

                                        <td className="px-6 py-4">
                                            {latest?.content.morningCall ? (
                                                <div className="flex items-center gap-2">
                                                    <CheckCircle2 size={14} className="text-emerald-500" />
                                                    <span className="text-[10px] font-bold text-slate-300">Redigido</span>
                                                </div>
                                            ) : latest ? (
                                                <button 
                                                    onClick={() => handleAction(latest._id, 'IA')}
                                                    disabled={!!loading}
                                                    className="text-[10px] font-black text-blue-400 hover:text-blue-300 flex items-center gap-1.5 px-2 py-1 bg-blue-900/20 rounded border border-blue-900/30 transition-all"
                                                >
                                                    {loading === `${latest._id}-IA` ? <Bot size={12} className="animate-spin" /> : <Bot size={12} />}
                                                    Gerar Texto IA
                                                </button>
                                            ) : <span className="text-[10px] text-slate-700">-</span>}
                                        </td>

                                        <td className="px-6 py-4 text-right">
                                            {latest && (
                                                <div className="flex items-center justify-end gap-2">
                                                    <QuickActionBtn 
                                                        active={latest.isRankingPublished} 
                                                        label="Ranking" 
                                                        onClick={() => handleAction(latest._id, 'PUB_RANK')}
                                                        isLoading={loading === `${latest._id}-PUB_RANK`}
                                                    />
                                                    <QuickActionBtn 
                                                        active={latest.isMorningCallPublished} 
                                                        label="Call" 
                                                        disabled={!latest.content.morningCall}
                                                        onClick={() => handleAction(latest._id, 'PUB_MC')}
                                                        isLoading={loading === `${latest._id}-PUB_MC`}
                                                    />
                                                    <div className="w-px h-4 bg-slate-800 mx-1"></div>
                                                    <button 
                                                        onClick={() => handleAction(latest._id, 'PUB_BOTH')}
                                                        className="text-[9px] font-black text-slate-400 hover:text-white uppercase tracking-tighter"
                                                    >
                                                        Publicar Tudo
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Logs de Processamento */}
                <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-4">
                        <Clock size={16} className="text-slate-500" />
                        <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Logs de Processamento (Últimos 30 dias)</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {history.slice(0, 12).map((log) => (
                            <div 
                                key={log._id} 
                                onClick={() => openAudit(log._id)}
                                className="bg-[#0B101A] border border-slate-800/50 rounded-xl p-3 flex items-center justify-between hover:border-slate-700 transition-all group cursor-pointer"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="text-[10px] font-black text-slate-400 bg-slate-900 px-2 py-1 rounded border border-slate-800 group-hover:text-blue-400 group-hover:border-blue-500/50 transition-colors">
                                        {log.assetClass}
                                    </div>
                                    <div>
                                        <p className="text-[9px] text-slate-500 font-mono">
                                            {new Date(log.date).toLocaleString('pt-BR', { 
                                                day: '2-digit', month: '2-digit', 
                                                hour: '2-digit', minute: '2-digit' 
                                            })}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    {log.isRankingPublished && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Ranking Online"></div>}
                                    {log.isMorningCallPublished && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" title="MC Online"></div>}
                                </div>
                            </div>
                        ))}
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
        {isLoading ? '...' : active ? `${label} OK` : `Publ. ${label}`}
    </button>
);