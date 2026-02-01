
import React, { useState, useEffect } from 'react';
import { Header } from '../components/dashboard/Header';
import { researchService, ResearchReport } from '../services/research';
import { ResearchViewer } from '../components/research/ResearchViewer';
import { Bot, Newspaper, Trophy, Loader2, Lock, Crown, Info, RefreshCcw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
// @ts-ignore
import { useNavigate } from 'react-router-dom';

const ASSETS = [
    { id: 'BRASIL_10', label: 'Brasil 10 (Mix)', color: 'bg-emerald-600', minPlan: 'ESSENTIAL' },
    { id: 'STOCK', label: 'Ações BR', color: 'bg-blue-600', minPlan: 'PRO' },
    { id: 'FII', label: 'FIIs', color: 'bg-indigo-600', minPlan: 'PRO' },
    { id: 'STOCK_US', label: 'Exterior', color: 'bg-slate-700', minPlan: 'PRO' },
    { id: 'CRYPTO', label: 'Cripto', color: 'bg-purple-600', minPlan: 'PRO' },
];

export const Research = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [selectedAsset, setSelectedAsset] = useState('BRASIL_10');
    const [viewMode, setViewMode] = useState<'ANALYSIS' | 'RANKING'>('RANKING');
    const [report, setReport] = useState<ResearchReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const isAdmin = user?.role === 'ADMIN';

    const checkAccess = (assetId: string) => {
        if (isAdmin) return true;
        const asset = ASSETS.find(a => a.id === assetId);
        if (!asset || !user) return false;
        const planLevels: Record<string, number> = { 'GUEST': 0, 'ESSENTIAL': 1, 'PRO': 2, 'BLACK': 3 };
        const userLevel = planLevels[user.plan] || 0;
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
            const strategy = selectedAsset === 'CRYPTO' ? 'SWING' : 'BUY_HOLD';
            const data = await researchService.getLatest(selectedAsset, strategy);
            setReport(data);
        } catch (err: any) {
            console.error("Erro ao buscar análise:", err);
            setReport(null);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchReport();
    }, [selectedAsset]);

    const hasAccessToSelected = checkAccess(selectedAsset);

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
                            {isAdmin ? 'ADMIN ACCESS: Todas as categorias liberadas' : `Plano Ativo: ${user?.plan}`}
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto items-center">
                        {/* Container de Botões com Scroll Oculto (no-scrollbar) */}
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

                            {/* Botão de Refresh Manual */}
                            <button 
                                onClick={fetchReport}
                                disabled={isLoading}
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
                            <h2 className="text-2xl font-black text-white mb-3">Conteúdo Exclusivo Pro</h2>
                            <p className="text-slate-400 max-w-sm mb-8">A análise estratégica de {selectedAsset} é reservada para assinantes do plano Pro.</p>
                            <button onClick={() => navigate('/pricing')} className="px-8 py-3 bg-blue-600 text-white font-black rounded-xl">Fazer Upgrade</button>
                        </div>
                    ) : !report ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-[#080C14] border border-dashed border-slate-800 rounded-3xl text-center">
                            <Info size={48} className="text-slate-700 mb-4" />
                            <h3 className="text-xl font-black text-slate-500 uppercase">Análise não encontrada</h3>
                            <p className="text-slate-600 text-sm mt-2 max-w-sm">Use o painel admin para gerar o relatório inaugural desta categoria.</p>
                        </div>
                    ) : (
                        <ResearchViewer report={report} view={viewMode} />
                    )}
                </div>
            </main>
        </div>
    );
};