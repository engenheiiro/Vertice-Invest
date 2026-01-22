
import React, { useEffect, useState } from 'react';
import { Header } from '../../components/dashboard/Header';
import { researchService, ResearchReport } from '../../services/research';
import { Bot, RefreshCw, Activity, Play, CalendarCheck, ShieldAlert, History } from 'lucide-react';

export const AdminPanel = () => {
    const [history, setHistory] = useState<ResearchReport[]>([]);
    const [isRoutineRunning, setIsRoutineRunning] = useState(false);
    const [statusMsg, setStatusMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);

    const loadHistory = async () => {
        try {
            const data = await researchService.getHistory();
            setHistory(data);
        } catch (error) {
            console.error("Erro ao carregar histórico", error);
        }
    };

    useEffect(() => {
        loadHistory();
        // Polling automático do histórico a cada 15 segundos para ver progresso do batch
        const interval = setInterval(loadHistory, 15000);
        return () => clearInterval(interval);
    }, []);

    const handleRunRoutine = async () => {
        const confirmMsg = "Iniciar protocolo de ingestão? Isso irá processar todas as categorias em background.";
        if (!confirm(confirmMsg)) return;

        setIsRoutineRunning(true);
        setStatusMsg(null);

        try {
            // Backend agora responde imediatamente "202 Accepted"
            await researchService.triggerRoutine(true);
            setStatusMsg({ type: 'success', text: "Comando aceito! O Neural Engine está processando as filas." });
            
            // Libera o botão após 3 segundos visualmente
            setTimeout(() => setIsRoutineRunning(false), 3000);
            
            // Força um reload do histórico logo
            loadHistory();
        } catch (error: any) {
            setStatusMsg({ type: 'error', text: error.message || "Erro ao iniciar rotina." });
            setIsRoutineRunning(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans">
            <Header />

            <main className="max-w-[1200px] mx-auto p-6 animate-fade-in">
                
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/20">
                                <Bot size={24} className="text-white" />
                            </div>
                            Vértice AI Control Room
                        </h1>
                        <p className="text-slate-400 text-sm mt-1 ml-13">Controle soberano do Neural Engine e ingestão de Research.</p>
                    </div>
                    
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-green-900/20 border border-green-900/50 rounded-full">
                        <Activity size={12} className="text-green-500 animate-pulse" />
                        <span className="text-xs font-bold text-green-500 uppercase tracking-widest">Engine Online</span>
                    </div>
                </div>

                {statusMsg && (
                    <div className={`mb-6 p-4 rounded-xl border flex items-center gap-3 animate-fade-in ${
                        statusMsg.type === 'success' ? 'bg-emerald-900/10 border-emerald-900/30 text-emerald-400' : 'bg-red-900/10 border-red-900/30 text-red-400'
                    }`}>
                        <ShieldAlert size={20} />
                        <span className="text-sm font-bold">{statusMsg.text}</span>
                    </div>
                )}

                <div className="grid md:grid-cols-2 gap-6 mb-8">
                    <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center group transition-all hover:border-slate-700">
                        <div className="w-16 h-16 bg-blue-900/20 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <Play size={32} className="text-blue-500 ml-1" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Forçar Ingestão Total</h2>
                        <p className="text-slate-400 text-sm mb-6 max-w-sm">
                            Dispara a IA para analisar todas as categorias. O processo roda em segundo plano (~2 min).
                        </p>
                        <button 
                            onClick={handleRunRoutine}
                            disabled={isRoutineRunning}
                            className={`
                                px-8 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2
                                ${isRoutineRunning 
                                    ? 'bg-slate-800 text-slate-500 cursor-wait' 
                                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20'
                                }
                            `}
                        >
                            {isRoutineRunning ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />}
                            {isRoutineRunning ? "Iniciando..." : "Regerar Research Agora"}
                        </button>
                    </div>

                    <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-8">
                        <div className="flex items-center gap-2 mb-6">
                            <CalendarCheck size={20} className="text-slate-400" />
                            <h3 className="font-bold text-white text-sm uppercase tracking-wider">Status das Categorias (Hoje)</h3>
                        </div>

                        <div className="space-y-4">
                            {['BRASIL_10', 'STOCK', 'FII', 'CRYPTO', 'STOCK_US'].map(asset => {
                                const today = new Date().toISOString().split('T')[0];
                                const isDone = history.some(h => h.assetClass === asset && h.date.startsWith(today));

                                return (
                                    <div key={asset} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-800 transition-colors hover:bg-slate-900">
                                        <span className="text-sm font-medium text-slate-300">{asset}</span>
                                        {isDone ? (
                                            <span className="text-[10px] font-black text-emerald-500 flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                                                ATUALIZADO
                                            </span>
                                        ) : (
                                            <span className="text-[10px] font-black text-slate-500 bg-slate-800 px-2 py-1 rounded border border-slate-700">PENDENTE</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                    <div className="p-4 border-b border-slate-800 bg-[#0B101A] flex justify-between items-center">
                        <h3 className="font-bold text-white text-sm flex items-center gap-2 uppercase tracking-widest">
                            <History size={16} className="text-slate-500" />
                            Histórico de Inteligência
                        </h3>
                        <button onClick={loadHistory} className="p-2 hover:bg-slate-800 rounded-lg transition-colors" title="Sincronizar">
                            <RefreshCw size={14} className="text-slate-500" />
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-[#0B101A] text-slate-500">
                                <tr className="uppercase tracking-tighter">
                                    <th className="p-4 border-r border-slate-800">Timestamp</th>
                                    <th className="p-4 border-r border-slate-800">Classe Ativo</th>
                                    <th className="p-4 border-r border-slate-800">Estratégia</th>
                                    <th className="p-4">Operador</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {history.length === 0 ? (
                                    <tr><td colSpan={4} className="p-10 text-center text-slate-600 font-bold">NENHUMA ANÁLISE NO REGISTRO</td></tr>
                                ) : (
                                    history.slice(0, 20).map((h, i) => (
                                        <tr key={i} className="hover:bg-slate-900/30 transition-colors">
                                            <td className="p-4 text-slate-300 font-mono">{new Date(h.date || h.createdAt).toLocaleString()}</td>
                                            <td className="p-4">
                                                <span className="bg-blue-600/10 text-blue-400 px-2 py-0.5 rounded border border-blue-600/20 font-bold">
                                                    {h.assetClass}
                                                </span>
                                            </td>
                                            <td className="p-4 text-slate-400 font-medium">{h.strategy}</td>
                                            <td className="p-4 text-slate-500 font-mono text-[10px]">{h.generatedBy || 'Neural Engine (Auto)'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </main>
        </div>
    );
};
