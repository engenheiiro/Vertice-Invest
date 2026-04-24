
import React, { useState, useEffect } from 'react';
import { Header } from '../components/dashboard/Header';
import { researchService, ResearchReport, RankingItem } from '../services/research';
import { ResearchViewer } from '../components/research/ResearchViewer';
import { AssetDetailModal } from '../components/research/AssetDetailModal'; // Importado
import { Bot, Newspaper, Trophy, Loader2, Lock, Crown, Info, RefreshCcw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
// @ts-ignore
import { useNavigate, useLocation } from 'react-router-dom';

const ASSETS = [
    { id: 'BRASIL_10', label: 'Brasil 10 (Mix)', color: 'bg-emerald-600', minPlan: 'ESSENTIAL' },
    { id: 'STOCK', label: 'Ações BR', color: 'bg-blue-600', minPlan: 'PRO' },
    { id: 'FII', label: 'FIIs', color: 'bg-indigo-600', minPlan: 'PRO' },
    { id: 'CRYPTO', label: 'Cripto', color: 'bg-purple-600', minPlan: 'PRO' },
    { id: 'STOCK_US', label: 'Exterior', color: 'bg-slate-700', minPlan: 'BLACK' },
];

export const Research = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation(); // Hook de location para pegar state
    
    const [selectedAsset, setSelectedAsset] = useState('BRASIL_10');
    const [viewMode, setViewMode] = useState<'ANALYSIS' | 'RANKING'>('RANKING');
    const [report, setReport] = useState<ResearchReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    
    // Estado para controle do modal de asset direto
    const [directAsset, setDirectAsset] = useState<RankingItem | null>(null);

    const isAdmin = user?.role === 'ADMIN';

    const checkAccess = (assetId: string) => {
        if (isAdmin) return true;
        const asset = ASSETS.find(a => a.id === assetId);
        if (!asset || !user) return false;
        const planLevels: Record<string, number> = { 'GUEST': 0, 'ESSENTIAL': 1, 'PRO': 2, 'BLACK': 3 };
        const userLevel = planLevels[user.plan || 'GUEST'] || 0;
        const requiredLevel = planLevels[asset.minPlan];
        return userLevel >= requiredLevel;
    };

    const fetchReport = async () => {
        if (!checkAccess(selectedAsset)) {
            setIsLoading(false);
            setReport(null);
            return;
        }

        setIsLoading(true);
        try {
            const strategy = 'BUY_HOLD';
            try {
                const data = await researchService.getLatest(selectedAsset, strategy);
                setReport(data);

                // LÓGICA DE LINK DIRETO (DEEP LINKING VIA STATE)
                if (location.state && location.state.openTicker && data && data.content && data.content.ranking) {
                    const targetTicker = location.state.openTicker;
                    const found = data.content.ranking.find((item: RankingItem) => item.ticker === targetTicker);
                    if (found) {
                        setDirectAsset(found);
                        window.history.replaceState({}, document.title);
                    }
                }
            } catch (err: any) {
                console.error("Erro ao buscar análise:", err);
                setReport(null);
            }

        } catch (err: any) {
            console.error("Erro geral:", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchReport();
    }, [selectedAsset, viewMode]);

    const hasAccessToSelected = checkAccess(selectedAsset);
    const requiredPlanLabel = ASSETS.find(a => a.id === selectedAsset)?.minPlan || 'PRO';

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main className="max-w-[1600px] mx-auto p-4 md:p-8">
                
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 mb-12">
                    <div>
                        <h1 className="text-4xl font-black text-white tracking-tighter flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                                <Bot size={28} />
                            </div>
                            RESEARCH CENTER
                        </h1>
                        <p className="text-slate-500 text-sm font-medium mt-2">
                            {isAdmin ? 'ADMIN ACCESS: Todas as categorias liberadas' : `Plano Ativo: ${user?.plan || 'INICIANTE'}`}
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto items-center">
                        <div className="flex bg-[#080C14] border border-slate-800 p-1.5 rounded-2xl overflow-x-auto no-scrollbar gap-1 shadow-inner w-full sm:w-auto">
                            {ASSETS.map(asset => {
                                const allowed = checkAccess(asset.id);
                                return (
                                    <button
                                        key={asset.id}
                                        onClick={() => setSelectedAsset(asset.id)}
                                        className={`px-5 py-2.5 rounded-xl text-xs font-black whitespace-nowrap transition-all flex items-center gap-2 ${
                                            selectedAsset === asset.id 
                                                ? `${asset.color} text-white shadow-xl` 
                                                : 'text-slate-500 hover:text-slate-300'
                                        } ${!allowed ? 'opacity-50 grayscale' : ''}`}
                                    >
                                        {asset.label}
                                        {!allowed && <Lock size={12} />}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex gap-2">
                            <div className="flex bg-[#080C14] border border-slate-800 p-1.5 rounded-2xl gap-1 shadow-inner">
                                <button 
                                    onClick={() => setViewMode('RANKING')}
                                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all ${
                                        viewMode === 'RANKING' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500'
                                    }`}
                                >
                                    <Trophy size={16} /> Top 10
                                </button>
                                <button
                                    onClick={() => setViewMode('ANALYSIS')}
                                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all ${
                                        viewMode === 'ANALYSIS' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500'
                                    }`}
                                >
                                    <Newspaper size={16} /> Relatório Semanal
                                </button>
                            </div>

                            <button 
                                onClick={fetchReport}
                                disabled={isLoading || !hasAccessToSelected}
                                className="bg-[#080C14] border border-slate-800 p-3 rounded-2xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                                title="Atualizar Dados"
                            >
                                <RefreshCcw size={18} className={isLoading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="min-h-[400px]">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 size={40} className="text-blue-500 animate-spin mb-4" />
                            <p className="text-slate-500 text-sm font-bold uppercase tracking-widest text-center">Acessando Intel Vértice...</p>
                        </div>
                    ) : !hasAccessToSelected ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-[#080C14] border border-slate-800 rounded-3xl p-10 text-center">
                            <Crown size={40} className="text-blue-500 mb-6" />
                            <h2 className="text-2xl font-black text-white mb-3">Conteúdo Exclusivo {requiredPlanLabel}</h2>
                            <p className="text-slate-400 max-w-sm mb-8">
                                A análise estratégica de {ASSETS.find(a => a.id === selectedAsset)?.label} é reservada para assinantes do plano {requiredPlanLabel} ou superior.
                            </p>
                            <button onClick={() => navigate('/pricing')} className="px-8 py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/20">
                                Fazer Upgrade
                            </button>
                        </div>
                    ) : !report ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-[#080C14] border border-dashed border-slate-800 rounded-3xl text-center">
                            <Info size={48} className="text-slate-700 mb-4" />
                            <h3 className="text-xl font-black text-slate-500 uppercase">Análise não encontrada</h3>
                            <p className="text-slate-600 text-sm mt-2 max-w-sm">Use o painel admin para gerar o relatório inaugural desta categoria.</p>
                        </div>
                    ) : viewMode === 'ANALYSIS' ? (
                        <div className="animate-fade-in space-y-8 pb-20">
                            {/* Análise Explainable IA */}
                            {report.isExplainableAIPublished && report.generatedExplainableAI ? (
                                <div className="bg-[#080C14] border border-indigo-900/30 rounded-3xl overflow-hidden shadow-xl">
                                    <div className="p-6 border-b border-slate-800">
                                        <h2 className="text-lg font-black text-white flex items-center gap-3">
                                            <Bot size={20} className="text-indigo-400" />
                                            Análise Explainable IA
                                        </h2>
                                        <p className="text-slate-500 text-xs mt-1">Gerado por inteligência artificial com base nos dados quantitativos</p>
                                    </div>
                                    <div className="p-6">
                                        <ExplainableAIRenderer text={report.generatedExplainableAI} />
                                    </div>
                                </div>
                            ) : null}

                            {/* Sem conteúdo publicado ainda */}
                            {!report.isExplainableAIPublished && (
                                <div className="flex flex-col items-center justify-center py-20 bg-[#080C14] border border-dashed border-slate-800 rounded-3xl text-center">
                                    <Info size={48} className="text-slate-700 mb-4" />
                                    <h3 className="text-xl font-black text-slate-500 uppercase">Relatório ainda não publicado</h3>
                                    <p className="text-slate-600 text-sm mt-2 max-w-sm">O admin ainda não publicou o relatório semanal desta categoria.</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <ResearchViewer report={report!} view="RANKING" />
                    )}
                </div>
                
                {/* Modal de Link Direto (Renderizado se houver ativo selecionado via state) */}
                {directAsset && (
                    <AssetDetailModal 
                        isOpen={!!directAsset} 
                        onClose={() => setDirectAsset(null)} 
                        asset={directAsset} 
                    />
                )}

            </main>
        </div>
    );
};

// ── Renderer do texto Explainable IA ─────────────────────────────────────────

const SECTION_STYLES: Record<string, { label: string; color: string; border: string; bg: string }> = {
    '📊': { label: '📊', color: 'text-blue-400',    border: 'border-blue-900/40',    bg: 'bg-blue-900/10'    },
    '🏆': { label: '🏆', color: 'text-emerald-400', border: 'border-emerald-900/40', bg: 'bg-emerald-900/10' },
    '🔄': { label: '🔄', color: 'text-purple-400',  border: 'border-purple-900/40',  bg: 'bg-purple-900/10'  },
    '⚠️': { label: '⚠️', color: 'text-yellow-400',  border: 'border-yellow-900/40',  bg: 'bg-yellow-900/10'  },
    '💡': { label: '💡', color: 'text-indigo-400',  border: 'border-indigo-900/40',  bg: 'bg-indigo-900/10'  },
};

const getSectionStyle = (heading: string) => {
    for (const emoji of Object.keys(SECTION_STYLES)) {
        if (heading.includes(emoji)) return SECTION_STYLES[emoji];
    }
    return { color: 'text-slate-300', border: 'border-slate-700', bg: 'bg-slate-800/30' };
};

const parseBoldInline = (text: string): React.ReactNode[] => {
    return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
            ? <strong key={i} className="text-white font-bold">{part.slice(2, -2)}</strong>
            : <span key={i}>{part}</span>
    );
};

const ExplainableAIRenderer: React.FC<{ text: string }> = ({ text }) => {
    const lines = text.split('\n');

    return (
        <div className="space-y-1">
            {lines.map((line, i) => {
                const t = line.trim();
                if (!t) return <div key={i} className="h-2" />;

                // Cabeçalho de seção: ## 📊 Cenário Macro
                if (t.startsWith('## ')) {
                    const heading = t.replace(/^## /, '');
                    const style = getSectionStyle(heading);
                    return (
                        <div key={i} className={`flex items-center gap-2 mt-7 mb-3 px-3 py-2 rounded-xl border ${style.border} ${style.bg}`}>
                            <span className={`text-sm font-black tracking-tight ${style.color}`}>{heading}</span>
                        </div>
                    );
                }

                // Bullet COMPRAR: - 🟢 **TICKER** — …
                if (/^[-•]\s*🟢/.test(t)) {
                    const content = t.replace(/^[-•]\s*🟢\s*/, '');
                    return (
                        <div key={i} className="flex gap-2 items-start mb-2 ml-2">
                            <span className="text-[9px] font-black text-emerald-400 bg-emerald-900/20 border border-emerald-900/40 px-1.5 py-0.5 rounded mt-[3px] shrink-0 whitespace-nowrap">
                                COMPRAR
                            </span>
                            <p className="text-slate-300 text-sm leading-relaxed">{parseBoldInline(content)}</p>
                        </div>
                    );
                }

                // Bullet AGUARDAR: - 🟡 **TICKER** — …
                if (/^[-•]\s*🟡/.test(t)) {
                    const content = t.replace(/^[-•]\s*🟡\s*/, '');
                    return (
                        <div key={i} className="flex gap-2 items-start mb-2 ml-2">
                            <span className="text-[9px] font-black text-yellow-400 bg-yellow-900/20 border border-yellow-900/40 px-1.5 py-0.5 rounded mt-[3px] shrink-0 whitespace-nowrap">
                                AGUARDAR
                            </span>
                            <p className="text-slate-300 text-sm leading-relaxed">{parseBoldInline(content)}</p>
                        </div>
                    );
                }

                // Bullet genérico: - texto
                if (/^[-•]\s/.test(t)) {
                    const content = t.replace(/^[-•]\s/, '');
                    return (
                        <div key={i} className="flex gap-3 items-start mb-2 ml-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-500 mt-[7px] shrink-0" />
                            <p className="text-slate-300 text-sm leading-relaxed">{parseBoldInline(content)}</p>
                        </div>
                    );
                }

                // Parágrafo normal
                return (
                    <p key={i} className="text-slate-400 text-sm leading-relaxed mb-2 px-1">
                        {parseBoldInline(t)}
                    </p>
                );
            })}
        </div>
    );
};
