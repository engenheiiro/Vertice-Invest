import React from 'react';
import { Bot, RefreshCw, CheckCircle2, AlertCircle, BarChart3, Layers, Globe, Zap, Search, Play, Server, Share2, Send, Copy, X, MessageSquare, ShieldCheck } from 'lucide-react';
import type { ResearchReport, PublishStatus } from '../../services/research';
import { BuyAndHoldShadowCard } from '../../components/admin/BuyAndHoldShadowCard';

const ASSET_CLASSES = [
    { id: 'BRASIL_10', label: 'Brasil 10 (Mix)', icon: <ShieldCheck size={18} className="text-emerald-500" />, desc: 'Carteira Defensiva Top Picks' },
    { id: 'STOCK', label: 'Ações Brasil', icon: <BarChart3 size={18} className="text-blue-500" />, desc: 'B3: Ibovespa & Small Caps' },
    { id: 'FII', label: 'Fundos Imobiliários', icon: <Layers size={18} className="text-indigo-500" />, desc: 'IFIX: Tijolo, Papel & Fiagros' },
    { id: 'STOCK_US', label: 'Mercado Global', icon: <Globe size={18} className="text-cyan-500" />, desc: 'NYSE & NASDAQ (Stocks)' },
    { id: 'REIT', label: 'REITs (US)', icon: <Globe size={18} className="text-teal-500" />, desc: 'Imobiliário US (O, PLD, AMT...)' },
    { id: 'ETF', label: 'ETFs', icon: <Layers size={18} className="text-teal-400" />, desc: 'Cestas B3 + Internacionais' },
    { id: 'CRYPTO', label: 'Criptoativos', icon: <Zap size={18} className="text-purple-500" />, desc: 'Top Cap & Projetos DeFi' },
];

interface PromptModalState {
    open: boolean; id: string; prompt: string; generatedAI: string; assetClass: string;
}

interface Props {
    history: ResearchReport[];
    publishStatus: PublishStatus[];
    loadingKey: string | null;
    isGlobalRunning: boolean;
    isSyncing: boolean;
    isPublishingAll: boolean;
    promptModal: PromptModalState;
    isLoadingPrompt: boolean;
    localGeneratedText: string;
    userHasEdited: boolean;
    isGeneratingAI: boolean;
    onGlobalRun: () => void;
    onPublishAllPending: () => void;
    onPublishGranular: (id: string, type: 'RANKING' | 'REPORT' | 'EXPLAINABLE_AI' | 'ALL') => void;
    onOpenAudit: (id: string) => void;
    onViewPrompt: (id: string, assetClass: string) => void;
    onGenerateExplainableAI: () => void;
    onClosePromptModal: () => void;
    setLocalGeneratedText: (v: string) => void;
    setUserHasEdited: (v: boolean) => void;
}

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

export const AdminOperacoesTab: React.FC<Props> = ({
    history, publishStatus, loadingKey, isGlobalRunning, isSyncing, isPublishingAll,
    promptModal, isLoadingPrompt, localGeneratedText, userHasEdited, isGeneratingAI,
    onGlobalRun, onPublishAllPending, onPublishGranular, onOpenAudit, onViewPrompt,
    onGenerateExplainableAI, onClosePromptModal, setLocalGeneratedText, setUserHasEdited,
}) => {
    const getLatestForClass = (classId: string) => history.find(h => h.assetClass === classId && h.strategy === 'BUY_HOLD');
    const isUpdatedToday = (dateString?: string) => {
        if (!dateString) return false;
        return dateString.startsWith(new Date().toISOString().split('T')[0]);
    };

    const pendingCount = publishStatus.filter(s => s.readyToPublish).length;
    const lastPub = publishStatus.map(s => s.lastPublishedAt).filter(Boolean).sort().reverse()[0];
    const daysSinceLastPub = lastPub ? Math.floor((Date.now() - new Date(lastPub).getTime()) / 86400000) : null;

    return (
        <>
            {/* Protocolo V3 */}
            <div className="bg-base border border-blue-900/30 rounded-2xl p-6 mb-6 relative overflow-hidden shadow-lg">
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
                        onClick={onGlobalRun}
                        disabled={isGlobalRunning || isSyncing}
                        className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 shadow-xl ${isGlobalRunning ? 'bg-slate-800 text-slate-400 cursor-wait border border-slate-700' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105'}`}
                    >
                        {isGlobalRunning ? <><RefreshCw size={16} className="animate-spin" /> Rodando Full...</> : <><Play size={16} fill="currentColor" /> Executar Tudo</>}
                    </button>
                </div>
            </div>

            {/* Controle de Publicação */}
            {publishStatus.length > 0 && (
                <div className="bg-base border border-indigo-900/40 rounded-2xl p-5 mb-6 shadow-lg">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1"><Send size={16} className="text-indigo-400" />Controle de Publicação Semanal</h3>
                            <div className="flex items-center gap-4 text-[10px] text-slate-500 font-bold">
                                {pendingCount > 0 ? (
                                    <span className="text-yellow-400 flex items-center gap-1"><AlertCircle size={10} /> {pendingCount} classe(s) com draft pronto para publicar</span>
                                ) : (
                                    <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 size={10} /> Tudo publicado</span>
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
                            onClick={onPublishAllPending}
                            disabled={isPublishingAll || pendingCount === 0}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all border ${pendingCount > 0 ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-lg shadow-indigo-900/30' : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'}`}
                        >
                            {isPublishingAll ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                            Publicar Tudo Pendente
                        </button>
                    </div>
                </div>
            )}

            {/* Matriz de Geração */}
            <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-card">
                    <div className="flex items-center gap-2">
                        <Server size={18} className="text-slate-400" />
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider">Matriz de Geração & Refinamento</h3>
                    </div>
                    <p className="text-[10px] text-slate-500">Gerar → Visualizar → Publicar</p>
                </div>
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-card border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            <th scope="col" className="px-5 py-3">Ativo</th>
                            <th scope="col" className="px-5 py-3 text-center">Visualizar</th>
                            <th scope="col" className="px-5 py-3 text-center">Publicar</th>
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
                                                    {updatedToday ? <span className="text-[9px] text-emerald-500 font-bold flex items-center gap-1"><CheckCircle2 size={9} />Hoje</span> : <span className="text-[9px] text-slate-600 font-bold flex items-center gap-1"><AlertCircle size={9} />Pendente</span>}
                                                    {ps && <span className={`text-[9px] font-bold px-1 rounded ${ps.isRankingPublished ? 'text-emerald-500' : ps.readyToPublish ? 'text-yellow-500' : 'text-slate-600'}`}>{ps.isRankingPublished ? '● Pub.' : ps.readyToPublish ? '● Draft' : '○'}</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 text-center">
                                        {latestId ? (
                                            <div className="flex justify-center gap-1.5">
                                                <button onClick={() => onOpenAudit(latestId)} title="Ver Ranking Completo" className="p-1.5 bg-slate-800 border border-slate-700 text-slate-400 rounded hover:text-white hover:bg-slate-700 transition-colors"><Search size={11} /></button>
                                                <button onClick={() => onViewPrompt(latestId, asset.id)} disabled={!hasPrompt} title={hasPrompt ? "Ver Prompt Explainable IA" : "Prompt não gerado ainda"} className={`p-1.5 border rounded transition-colors ${hasPrompt ? 'bg-slate-800 border-slate-700 text-slate-400 hover:text-blue-400 hover:bg-blue-900/20 hover:border-blue-700' : 'bg-slate-800/40 border-slate-800 text-slate-700 cursor-not-allowed'}`}><MessageSquare size={11} /></button>
                                            </div>
                                        ) : <span className="text-[9px] text-slate-700 font-mono">—</span>}
                                    </td>
                                    <td className="px-5 py-3 text-center">
                                        {latestId ? (
                                            <div className="flex justify-center gap-1">
                                                <PubBtn icon={<Share2 size={9} />} label="Rank" active={!!(latest?.isRankingPublished)} isLoading={loadingKey === `${latestId}-PUBG_RANKING`} onClick={() => onPublishGranular(latestId, 'RANKING')} title="Publicar Ranking" />
                                                <PubBtn icon={<Zap size={9} />} label="IA" active={!!(latest as any)?.isExplainableAIPublished} disabled={!hasGeneratedAI} isLoading={loadingKey === `${latestId}-PUBG_EXPLAINABLE_AI`} onClick={() => onPublishGranular(latestId, 'EXPLAINABLE_AI')} title="Publicar Explainable IA" />
                                                <PubBtn icon={<Send size={9} />} label="Tudo" active={false} isLoading={loadingKey === `${latestId}-PUBG_ALL`} onClick={() => onPublishGranular(latestId, 'ALL')} title="Publicar Tudo" variant="all" />
                                            </div>
                                        ) : <span className="text-[9px] text-slate-700 font-mono">—</span>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Ranking Buy-and-Hold (shadow, admin-only) */}
            <div className="mt-6">
                <BuyAndHoldShadowCard />
            </div>

            {/* Modal — Prompt + Explainable IA */}
            {promptModal.open && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-card border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
                        <div className="flex items-center justify-between p-5 border-b border-slate-800">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2"><MessageSquare size={16} className="text-blue-400" />Explainable IA — {promptModal.assetClass}</h3>
                            <button onClick={onClosePromptModal} aria-label="Fechar" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-white"><X size={18} /></button>
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
                                            <button onClick={() => { navigator.clipboard.writeText(promptModal.prompt); }} className="flex items-center gap-1 text-[9px] font-bold text-blue-400 hover:text-white bg-blue-900/20 border border-blue-900/50 px-2 py-1 rounded transition-colors">
                                                <Copy size={10} /> Copiar
                                            </button>
                                        </div>
                                        <textarea readOnly value={promptModal.prompt || 'Prompt não disponível. Rode o sync:prod.'} className="w-full h-40 bg-slate-900 border border-slate-700 rounded-lg p-3 text-[10px] text-slate-400 font-mono resize-none focus:outline-none" />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                            Texto Explainable IA
                                            {userHasEdited && <span className="ml-2 text-yellow-400 normal-case font-normal">(editado — clique em Salvar para confirmar)</span>}
                                        </p>
                                        <button onClick={onGenerateExplainableAI} disabled={isGeneratingAI || (!promptModal.prompt && !userHasEdited)} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
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
        </>
    );
};
